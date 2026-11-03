import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sandboxConfiguration, localAiStatus } from '../server/setup.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checks = [];
const check = (name, pass, message) => checks.push({ name, pass, message });
const supported = Number(process.versions.node.split('.')[0]) >= 24;
check('Node.js', supported, supported ? process.versions.node : 'Install Node.js 24 or newer.');

const envPath = resolve(root, '.env');
let envLoaded = false;
if (supported && existsSync(envPath)) {
  try { process.loadEnvFile(envPath); envLoaded = true; } catch {}
}
check('.env', envLoaded, envLoaded ? 'Project configuration loaded; values are not displayed.' :
  'Copy .env.example to .env, edit its sandbox settings, and check the file syntax.');

const paypal = sandboxConfiguration();
check('PayPal settings', paypal.configured, paypal.configured ?
  'Required values are present. Authentication with PayPal has not been tested.' :
  'Replace the missing/example values in .env: ' + paypal.missing.join(', '));

if (supported) {
  const ai = await localAiStatus();
  check('Local AI', ai.available, ai.available ? 'Configured model is installed: ' + ai.model :
    ai.reason === 'model_missing' ? 'Install the configured model: ollama pull ' + ai.model :
      'Start Ollama and check OLLAMA_URL. The service must expose its model list.');
}
const built = existsSync(resolve(root, 'dist/index.html'));
check('Production build', built, built ? 'dist/index.html is present.' : 'Run npm ci, then npm run build.');

console.log('ScopeLock setup check — sandbox only\n');
for (const item of checks) console.log((item.pass ? 'PASS ' : 'FAIL ') + item.name + ': ' + item.message);
const ready = checks.every(item => item.pass);
console.log('\n' + (ready ? 'Local prerequisites are ready. Run npm run server and open http://127.0.0.1:' +
  (process.env.PORT || 5159) + '.' : 'Resolve the FAIL items, then run npm run doctor again.'));
console.log('This check reads the local model list. It does not run inference, authenticate with PayPal, or create an invoice.');
process.exitCode = ready ? 0 : 1;
