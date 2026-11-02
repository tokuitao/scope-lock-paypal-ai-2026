import { AppError } from './domain.mjs';

// Intentionally fixed to sandbox. This project cannot switch to real-money mode.
const base = 'https://api-m.sandbox.paypal.com';
let token;
let tokenExpires = 0;
async function accessToken() {
  if (token && Date.now() < tokenExpires) return token;
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) throw new AppError('Configure PayPal sandbox credentials on the server.', 503);
  const response = await fetch(base + '/v1/oauth2/token', { method: 'POST', signal: AbortSignal.timeout(20000), headers: { Authorization: 'Basic ' + Buffer.from(process.env.PAYPAL_CLIENT_ID + ':' + process.env.PAYPAL_CLIENT_SECRET).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new AppError('PayPal sandbox authentication failed.', 502);
  token = data.access_token; tokenExpires = Date.now() + Math.max(0, data.expires_in - 60) * 1000;
  return token;
}
export async function paypal(path, { method = 'GET', body } = {}) {
  if (!path.startsWith('/v2/invoicing/')) throw new AppError('Unsupported sandbox API path.');
  const bearer = await accessToken();
  const response = await fetch(base + path, { method, signal: AbortSignal.timeout(30000), headers: { Authorization: 'Bearer ' + bearer, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const raw = await response.text(); let data;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
  if (!response.ok) {
    const details = (data.details || []).map(d => d.issue).join(', ');
    const e = new AppError('PayPal sandbox: ' + (data.name || response.status) + (details ? ' (' + details + ')' : ''), 502);
    e.paypalStatus = response.status; e.debugId = data.debug_id; throw e;
  }
  return data;
}
export const sandboxBase = base;
