const required = ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_MERCHANT_EMAIL'];
const exampleValues = new Set(['your_sandbox_client_id', 'your_sandbox_secret', 'your_sandbox_business_email']);

// Report names and readiness only; never return credential values.
export function sandboxConfiguration(env = process.env) {
  const missing = required.filter(name => {
    const value = (env[name] || '').trim();
    return !value || exampleValues.has(value) ||
      (name === 'PAYPAL_MERCHANT_EMAIL' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
  });
  return { configured: missing.length === 0, missing };
}

export async function localAiStatus(env = process.env) {
  const model = env.OLLAMA_MODEL || 'gemma4:e2b';
  const result = { provider: 'Ollama (local)', model, available: false };
  try {
    const url = (env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '') + '/api/tags';
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return { ...result, reason: 'unavailable' };
    const data = await response.json();
    if (!Array.isArray(data.models)) return { ...result, reason: 'invalid_response' };
    const available = data.models.some(m => [m.name, m.model].some(name =>
      typeof name === 'string' && (name === model || name === model + ':latest')));
    return { ...result, available, reason: available ? null : 'model_missing' };
  } catch { return { ...result, reason: 'unavailable' }; }
}
