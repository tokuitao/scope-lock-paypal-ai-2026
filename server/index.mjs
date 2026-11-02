import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze } from './ai.mjs';
import { makeApproval, invoicePayload, validateInvoiceReadback, AppError } from './domain.mjs';
import { paypal, sandboxBase } from './paypal.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(resolve(root, 'data'), { recursive: true });
const db = new DatabaseSync(resolve(root, 'data/scopelock.sqlite'));
db.exec('CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, kind TEXT NOT NULL, content TEXT NOT NULL)');
const put = (kind, obj) => { db.prepare('INSERT INTO records(id,kind,content) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET content=excluded.content').run(obj.id, kind, JSON.stringify(obj)); return obj; };
const get = (id, kind) => { const row = db.prepare('SELECT content FROM records WHERE id=? AND kind=?').get(id, kind); if (!row) throw new AppError('Record not found.', 404); return JSON.parse(row.content); };
const list = kind => db.prepare('SELECT content FROM records WHERE kind=? ORDER BY rowid DESC').all(kind).map(r => JSON.parse(r.content));
const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); };
async function readBody(req) { let text = ''; for await (const chunk of req) { text += chunk; if (text.length > 50000) throw new AppError('Request too large.', 413); } try { return text ? JSON.parse(text) : {}; } catch { throw new AppError('Request must be valid JSON.'); } }
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const origin = req.headers.origin;
    const allowedOrigins = ['http://127.0.0.1:5160', 'http://localhost:5160', 'http://127.0.0.1:5159', 'http://localhost:5159'];
    if (origin && !allowedOrigins.includes(origin)) throw new AppError('Origin not allowed.', 403);
    if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }); return res.end(); }
    if (url.pathname === '/api/health') {
      const model = process.env.OLLAMA_MODEL || 'gemma4:e2b';
      let available = false;
      try { const r = await fetch((process.env.OLLAMA_URL || 'http://127.0.0.1:11434') + '/api/tags', { signal: AbortSignal.timeout(3000) }); const data = await r.json(); available = r.ok && data.models?.some(m => m.name === model); } catch {}
      return json(res, 200, { name: 'ScopeLock', mode: 'sandbox', paypalBase: sandboxBase, credentialsConfigured: !!process.env.PAYPAL_CLIENT_SECRET, sandboxBuyerEmail: process.env.PAYPAL_BUYER_EMAIL, ai: { provider: 'Ollama (local)', model, available } });
    }
    if (req.method === 'GET' && url.pathname === '/api/workspace') return json(res, 200, { analyses: list('analysis'), approvals: list('approval') });
    if (req.method === 'POST' && url.pathname === '/api/analyze') return json(res, 201, put('analysis', await analyze(await readBody(req))));
    if (req.method === 'POST' && url.pathname === '/api/approve') {
      const b = await readBody(req); const approval = makeApproval(get(b.analysisId, 'analysis'), b.selection, b.client || {});
      const prior = list('approval').find(a => a.hash === approval.hash);
      return json(res, prior ? 200 : 201, prior || put('approval', approval));
    }
    const match = url.pathname.match(/^\/api\/approvals\/([a-f0-9-]+)\/(invoice|publish|refresh)$/);
    if (req.method === 'POST' && match) {
      const [, id, action] = match; const a = get(id, 'approval');
      if (action === 'invoice') {
        if (a.invoice) return json(res, 200, { ...a, reused: true });
        if (a.state !== 'APPROVED') throw new AppError('Creation is pending or uncertain. Reconcile before retrying; no automatic duplicate invoice.', 409);
        a.state = 'CREATING'; put('approval', a);
        try {
          const created = await paypal('/v2/invoicing/invoices', { method: 'POST', body: invoicePayload(a, process.env.PAYPAL_MERCHANT_EMAIL) });
          const invoiceId = created.id || (Array.isArray(created) ? created : created.links || []).find(l => l.rel === 'self')?.href.split('/').at(-1);
          if (!invoiceId) throw new AppError('PayPal did not return an invoice ID.', 502);
          a.invoice = { id: invoiceId }; put('approval', a);
          const invoice = await paypal('/v2/invoicing/invoices/' + encodeURIComponent(invoiceId));
          validateInvoiceReadback(invoice, a); a.invoice = invoice; a.state = 'DRAFT'; a.verifiedAt = new Date().toISOString(); put('approval', a);
          return json(res, 201, a);
        } catch (e) { a.state = 'REVIEW_REQUIRED'; a.error = e.message; put('approval', a); throw e; }
      }
      if (!a.invoice?.id) throw new AppError('Create a matching sandbox draft first.', 409);
      const path = '/v2/invoicing/invoices/' + encodeURIComponent(a.invoice.id);
      const current = await paypal(path); validateInvoiceReadback(current, a);
      if (action === 'publish') {
        if (current.status === 'DRAFT') await paypal(path + '/send', { method: 'POST', body: { send_to_recipient: false, send_to_invoicer: false } });
        a.invoice = await paypal(path); validateInvoiceReadback(a.invoice, a);
      } else a.invoice = current;
      a.state = a.invoice.status; a.verifiedAt = new Date().toISOString(); delete a.error;
      put('approval', a); return json(res, 200, a);
    }
    const dist = resolve(root, 'dist'); const file = resolve(dist, '.' + decodeURIComponent(url.pathname));
    if (req.method === 'GET' && (file === dist || file.startsWith(dist + '/')) && existsSync(dist)) {
      const target = existsSync(file) && statSync(file).isFile() ? file : resolve(dist, 'index.html');
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
      res.writeHead(200, { 'Content-Type': types[extname(target)] || 'application/octet-stream' }); return res.end(readFileSync(target));
    }
    throw new AppError('Not found.', 404);
  } catch (e) { json(res, e.status || 500, { error: e.name === 'TimeoutError' ? 'Timed out. No automatic transaction retry was performed.' : (e.message || 'Request failed.'), paypalDebugId: e.debugId }); }
});
const port = Number(process.env.PORT || 5159);
server.listen(port, '127.0.0.1', () => console.log('ScopeLock sandbox server http://127.0.0.1:' + port));
