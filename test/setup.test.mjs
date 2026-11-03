import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { sandboxConfiguration } from '../server/setup.mjs';

test('example credentials and a secret without the other settings are not ready', () => {
  const example = sandboxConfiguration({ PAYPAL_CLIENT_ID: 'your_sandbox_client_id',
    PAYPAL_CLIENT_SECRET: 'your_sandbox_secret', PAYPAL_MERCHANT_EMAIL: 'your_sandbox_business_email' });
  assert.equal(example.configured, false);
  assert.equal(example.missing.length, 3);
  assert.deepEqual(sandboxConfiguration({ PAYPAL_CLIENT_SECRET: 'private-value' }).missing,
    ['PAYPAL_CLIENT_ID', 'PAYPAL_MERCHANT_EMAIL']);
  const present = sandboxConfiguration({ PAYPAL_CLIENT_ID: 'sample-id',
    PAYPAL_CLIENT_SECRET: 'private-value', PAYPAL_MERCHANT_EMAIL: 'merchant@example.com' });
  assert.deepEqual(present, { configured: true, missing: [] });
  assert.equal(JSON.stringify(present).includes('private-value'), false);
});

test('doctor diagnoses fresh-clone settings, installed/missing model, and unavailable service without PayPal calls', async () => {
  const source = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const root = await mkdtemp(resolve(tmpdir(), 'scopelock-doctor-'));
  let models = [{ name: 'fixture-model:latest' }];
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ method: req.method, url: req.url });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ models }));
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  const env = { ...process.env };
  for (const name of ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_MERCHANT_EMAIL', 'OLLAMA_MODEL', 'OLLAMA_URL']) delete env[name];
  const run = () => new Promise((done, reject) => {
    const child = spawn(process.execPath, ['scripts/doctor.mjs'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', x => { output += x; });
    child.stderr.on('data', x => { output += x; });
    child.once('error', reject);
    child.once('close', code => done({ code, output }));
  });
  try {
    await mkdir(resolve(root, 'server')); await mkdir(resolve(root, 'scripts'));
    await copyFile(resolve(source, 'server/setup.mjs'), resolve(root, 'server/setup.mjs'));
    await copyFile(resolve(source, 'scripts/doctor.mjs'), resolve(root, 'scripts/doctor.mjs'));
    const config = extra => 'OLLAMA_URL=http://127.0.0.1:' + port + '\nOLLAMA_MODEL=fixture-model\n' + extra;
    await writeFile(resolve(root, '.env'), config('PAYPAL_CLIENT_ID=your_sandbox_client_id\nPAYPAL_CLIENT_SECRET=your_sandbox_secret\nPAYPAL_MERCHANT_EMAIL=your_sandbox_business_email\n'));
    const fresh = await run();
    assert.equal(fresh.code, 1);
    assert.match(fresh.output, /FAIL PayPal settings/);
    assert.match(fresh.output, /FAIL Production build/);
    assert.equal(fresh.output.includes('your_sandbox_secret'), false);
    await mkdir(resolve(root, 'dist')); await writeFile(resolve(root, 'dist/index.html'), '<!doctype html>');
    await writeFile(resolve(root, '.env'), config('PAYPAL_CLIENT_ID=fixture-id\nPAYPAL_CLIENT_SECRET=fixture-private-secret\nPAYPAL_MERCHANT_EMAIL=merchant@example.com\n'));
    const ready = await run();
    assert.equal(ready.code, 0, ready.output);
    assert.match(ready.output, /Local prerequisites are ready/);
    for (const value of ['fixture-id', 'fixture-private-secret', 'merchant@example.com']) assert.equal(ready.output.includes(value), false);
    models = [];
    const missing = await run();
    assert.equal(missing.code, 1);
    assert.match(missing.output, /ollama pull fixture-model/);
    await new Promise(done => server.close(done));
    const unavailable = await run();
    assert.equal(unavailable.code, 1);
    assert.match(unavailable.output, /Start Ollama/);
    assert.deepEqual(requests, Array(3).fill({ method: 'GET', url: '/api/tags' }));
  } finally {
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});
