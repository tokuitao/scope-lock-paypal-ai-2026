import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAnalysis, makeApproval, invoicePayload, validateInvoiceReadback, reconciliationCandidate, decimalUnits } from '../server/domain.mjs';

const input = { contract: 'Three responsive pages. One revision included.', request: 'Keep responsive pages. Add two portfolio pages.' };
const output = { summary: 'One included item and a new page request.', changes: [
  { title: 'Responsive layout', classification: 'included', request_quote: 'Keep responsive pages.', contract_quote: 'Three responsive pages.', reason: 'Already agreed.' },
  { title: 'Two portfolio pages', classification: 'change', request_quote: 'Add two portfolio pages.', contract_quote: null, reason: 'Beyond the three agreed pages.' }
] };
const a = { id: 'analysis-1', ...validateAnalysis(output, input) };
const client = { email: 'sb-buyer@personal.example.com' };
test('Grounding rejects invented evidence and unsupported included claims', () => {
  assert.throws(() => validateAnalysis({ ...output, changes: [{ ...output.changes[1], request_quote: 'Add a payment system.' }] }, input), /does not exist/);
  assert.throws(() => validateAnalysis({ ...output, changes: [{ ...output.changes[0], contract_quote: null }] }, input), /supporting agreement/);
});
test('Included or duplicate work cannot enter an approval', () => {
  assert.throws(() => makeApproval(a, [{ id: 'item-1', quantity: '1', rate: '80' }], client), /Only reviewed/);
  const s = { id: 'item-2', quantity: '1', rate: '80' };
  assert.throws(() => makeApproval(a, [s, s], client), /only appear once/);
});
test('Money uses bounded decimal inputs and per-line cent rounding', () => {
  const approved = makeApproval(a, [{ id: 'item-2', quantity: '1.25', rate: '79.99' }], client);
  assert.equal(approved.totalCents, 9999);
  for (const v of ['1e3', '-1', '0', '1.001', 'Infinity']) assert.throws(() => decimalUnits(v, 'Value'));
  assert.notEqual(approved.hash, makeApproval(a, [{ id: 'item-2', quantity: '2', rate: '79.99' }], client).hash);
});
test('PayPal readback must match recipient, currency, total and all approved lines', () => {
  const approved = makeApproval(a, [{ id: 'item-2', quantity: '2', rate: '80' }], client);
  const invoice = { ...invoicePayload(approved, 'seller@business.example.com'), id: 'INV2-TEST', amount: { currency_code: 'USD', value: '160.00' } };
  assert.equal(validateInvoiceReadback(invoice, approved), invoice);
  assert.throws(() => validateInvoiceReadback({ ...invoice, amount: { currency_code: 'USD', value: '161.00' } }, approved), /does not match/);
  const tampered = structuredClone(invoice); tampered.items[0].unit_amount.value = '81.00';
  assert.throws(() => validateInvoiceReadback(tampered, approved), /line item/);
});
test('Recovery requires exactly one exact invoice-number match and never guesses', () => {
  const approval = { invoiceNumber: 'SL-EXACT' };
  assert.equal(reconciliationCandidate([{ id: 'INV2-A', detail: { invoice_number: 'SL-EXACT' } }, { id: 'INV2-B', detail: { invoice_number: 'SL-EXACT-prefix' } }], approval), 'INV2-A');
  assert.throws(() => reconciliationCandidate([], approval), /No matching invoice/);
  assert.throws(() => reconciliationCandidate([{ id: 'INV2-A', detail: { invoice_number: 'SL-EXACT' } }, { id: 'INV2-B', detail: { invoice_number: 'SL-EXACT' } }], approval), /Multiple matching/);
});
