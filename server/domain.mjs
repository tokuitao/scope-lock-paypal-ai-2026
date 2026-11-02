import { createHash, randomUUID } from 'node:crypto';

export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function boundedText(value, name, max = 12000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new AppError(name + ' is required (max ' + max + ' characters).');
  return value.trim();
}
export const schema = {
  type: 'object', additionalProperties: false, required: ['summary', 'changes'],
  properties: {
    summary: { type: 'string' },
    changes: { type: 'array', minItems: 1, maxItems: 12, items: {
      type: 'object', additionalProperties: false,
      required: ['title', 'classification', 'request_quote', 'contract_quote', 'reason'],
      properties: {
        title: { type: 'string' }, classification: { type: 'string', enum: ['included', 'change', 'unclear'] },
        request_quote: { type: 'string' }, contract_quote: { type: ['string', 'null'] }, reason: { type: 'string' }
      }
    } }
  }
};
export function validateAnalysis(output, input) {
  if (!output || typeof output.summary !== 'string' || !Array.isArray(output.changes) || !output.changes.length || output.changes.length > 12) throw new AppError('AI returned an invalid analysis. No invoice was created.', 502);
  const changes = output.changes.map((c, i) => {
    if (!['included', 'change', 'unclear'].includes(c.classification)) throw new AppError('AI classification is invalid.', 502);
    const title = boundedText(c.title, 'AI item title', 127);
    const reason = boundedText(c.reason, 'AI item explanation', 1200);
    const quote = boundedText(c.request_quote, 'AI request quote', 2000);
    if (!input.request.includes(quote)) throw new AppError('AI quoted text that does not exist in the request. Review manually; no billing action occurred.', 502);
    if (c.contract_quote !== null && (typeof c.contract_quote !== 'string' || !c.contract_quote || !input.contract.includes(c.contract_quote))) throw new AppError('AI contract quote is not grounded in the supplied agreement.', 502);
    if (c.classification === 'included' && !c.contract_quote) throw new AppError('Included work requires a supporting agreement quote.', 502);
    return { id: 'item-' + (i + 1), title, classification: c.classification, request_quote: quote, contract_quote: c.contract_quote, reason };
  });
  return { summary: output.summary.slice(0, 2000), changes };
}
export function decimalUnits(value, name) {
  if (typeof value !== 'string' || !/^\d{1,5}(\.\d{1,2})?$/.test(value)) throw new AppError(name + ' must be a positive decimal with up to 2 decimal places.');
  const [whole, fraction = ''] = value.split('.');
  const n = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (n <= 0 || n > 1000000) throw new AppError(name + ' is outside the supported range.');
  return n;
}
export const money = cents => (cents / 100).toFixed(2);
export function makeApproval(analysis, selection, client) {
  if (!Array.isArray(selection) || !selection.length || selection.length > 12) throw new AppError('Select at least one additional-scope item.');
  const email = boundedText(client.email, 'Sandbox customer email', 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError('Enter a valid sandbox customer email.');
  // This prototype accepts fictional sandbox recipients only. It never emails them.
  if (!/@(personal|business)\.example\.com$/i.test(email)) throw new AppError('Use a PayPal sandbox account ending in @personal.example.com or @business.example.com.');
  const seen = new Set();
  const items = selection.map(s => {
    if (seen.has(s.id)) throw new AppError('A work item can only appear once.');
    seen.add(s.id);
    const item = analysis.changes.find(c => c.id === s.id);
    if (!item || item.classification !== 'change') throw new AppError('Only reviewed additional-scope items can be invoiced. Included or unclear work stays out.');
    const quantityUnits = decimalUnits(s.quantity, 'Hours');
    const rateCents = decimalUnits(s.rate, 'Hourly rate');
    const amountCents = Math.round(quantityUnits * rateCents / 100);
    return { id: item.id, title: item.title, request_quote: item.request_quote, quantity: (quantityUnits / 100).toFixed(2), rate: money(rateCents), amountCents };
  });
  const totalCents = items.reduce((sum, i) => sum + i.amountCents, 0);
  if (totalCents > 10000000) throw new AppError('This sandbox prototype supports up to USD 100,000 per invoice.');
  const content = { analysisId: analysis.id, currency: 'USD', recipient: email, items, totalCents };
  const hash = createHash('sha256').update(JSON.stringify(content)).digest('hex');
  const id = randomUUID();
  return { ...content, id, hash, invoiceNumber: 'SL-' + id.replaceAll('-', '').slice(0, 18), createdAt: new Date().toISOString(), state: 'APPROVED', invoice: null };
}
export function invoicePayload(approval, merchantEmail) {
  return {
    detail: { invoice_number: approval.invoiceNumber, currency_code: approval.currency, invoice_date: new Date().toISOString().slice(0, 10), reference: 'SL review ' + approval.hash.slice(0, 20), note: 'Fictional Sandbox change request. No real money. Operator-reviewed scope only.', payment_term: { term_type: 'DUE_ON_RECEIPT' } },
    invoicer: { name: { given_name: 'ScopeLock', surname: 'Studio' }, email_address: merchantEmail },
    primary_recipients: [{ billing_info: { email_address: approval.recipient } }],
    items: approval.items.map(i => ({ name: i.title, description: i.request_quote.slice(0, 1000), quantity: i.quantity, unit_amount: { currency_code: approval.currency, value: i.rate }, unit_of_measure: 'HOURS' })),
    configuration: { partial_payment: { allow_partial_payment: false }, tax_inclusive: false, tax_calculated_after_discount: true }
  };
}
export function validateInvoiceReadback(invoice, approval) {
  if (!invoice?.id || invoice.detail?.invoice_number !== approval.invoiceNumber || invoice.amount?.currency_code !== approval.currency || invoice.amount?.value !== money(approval.totalCents)) throw new AppError('PayPal invoice does not match the approved amount, currency and invoice number. Review before making payable.', 502);
  const recipient = invoice.primary_recipients?.[0]?.billing_info?.email_address;
  if (recipient !== approval.recipient || invoice.items?.length !== approval.items.length) throw new AppError('PayPal invoice recipient or line items differ from approval.', 502);
  invoice.items.forEach((item, i) => {
    const a = approval.items[i];
    if (item.name !== a.title || Number(item.quantity) !== Number(a.quantity) || item.unit_amount?.value !== a.rate || item.unit_amount?.currency_code !== approval.currency) throw new AppError('PayPal line item differs from the approved scope.', 502);
  });
  return invoice;
}
export function reconciliationCandidate(items, approval) {
  const matches = (items || []).filter(i => i.detail?.invoice_number === approval.invoiceNumber);
  if (matches.length !== 1 || !matches[0].id) throw new AppError(matches.length ? 'Multiple matching PayPal invoices need manual review. No invoice was created.' : 'No matching invoice was found yet. This review remains blocked to avoid a duplicate; check again or inspect the sandbox dashboard.', 409);
  return matches[0].id;
}
