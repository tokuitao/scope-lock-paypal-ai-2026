# ScopeLock

Compare an agreed brief with a new client request, review additional scope, and
create an itemized PayPal **sandbox** invoice that matches the recorded review.
Built for the PayPal AI Hackathon 2026.

This is an early working prototype. [Watch the 2:26 English-captioned demo](https://www.youtube.com/watch?v=SEdduEA55tE).
The video shows real app operations, an earlier paid sandbox example, and a new
unpaid invoice. Waiting time is shortened; there is no audio.
All transactions use fictional sandbox accounts; live payments are intentionally
unsupported. An operator's review is permission to prepare a payment request,
not proof that the customer agreed or paid.

## Run

Requires Node.js 24+, Ollama, a local model supporting structured JSON output,
and a free PayPal Developer sandbox application with Invoicing enabled.
Install [Node.js](https://nodejs.org/en/download) and
[Ollama](https://ollama.com/download), then create your own sandbox REST app at
[PayPal Developer](https://developer.paypal.com/dashboard/applications/sandbox).
Use its sandbox client ID and secret, sandbox business email, and a sandbox
personal account for the customer. Do not use live credentials.

The verified `gemma4:e2b` download is approximately 7.2 GB. Comparisons took
about 19–41 seconds in the development environment; your hardware may differ.
Model files and credentials are not bundled. There is no hosted public backend;
the instructions below run the actual build locally.

```sh
npm ci
cp .env.example .env
# Fill .env with your sandbox client ID, secret, and business email.
# Optionally set PAYPAL_BUYER_EMAIL to your sandbox personal account email.
ollama pull gemma4:e2b
npm run server
```

In another terminal:

```sh
npm run dev
```

Open http://127.0.0.1:5160. For a production build, run `npm run build` and serve
the result with `npm run server` at http://127.0.0.1:5159.

Secrets stay on the server, in the git-ignored `.env`. SQLite records are in
`data/scopelock.sqlite`, also ignored. Never publish those files. The server
binds to localhost and checks browser origins. Public hosting requires its own
access controls, quotas and deployment configuration.

## Walkthrough

1. The initial agreement and new request are fictional examples. Choose
   **Find the changes** to call the actual local model.
2. Read the source quotes and reasons. The model suggests `included`, `change`
   or `unclear`. Exact quotes are validated against the original documents;
   this verifies their source, not the correctness of every classification.
3. Only additional-scope rows can be selected. Enter your own hours and hourly
   rate, and your PayPal sandbox customer's email. AI never chooses prices.
4. Choose **Approve this quote** to record those exact items, quantities, rate,
   currency and recipient. Included and unclear items stay out.
5. Choose **Create PayPal draft**. The server creates an actual Invoicing v2
   draft and reads it back, comparing amount, currency, recipient and lines.
6. Choose **Make sandbox payment link**. PayPal email notifications are disabled.
   Open the sandbox invoice with a sandbox buyer account, then refresh its
   actual PayPal state. A draft, payable invoice, and paid invoice are different
   states; no simulated payment is reported as actual.

Repeated approval of the same analysis and terms returns the existing review.
Repeated invoice creation for that review returns its existing invoice. If a
network outcome is uncertain, the app stops for reconciliation instead of
automatically creating another invoice.

If the server restarts during creation, the persisted review becomes
`REVIEW_REQUIRED`. **Reconcile with PayPal** searches by the recorded invoice
number and accepts exactly one matching invoice only after verifying its full
contents. Zero or multiple matches remain blocked for manual review. This
recovery path never creates a replacement invoice.

## Technology and attribution

Original application code by Codex at the entrant's direction. Runtime AI uses
Ollama with `gemma4:e2b` in the verified local environment. AI is used to compare
scope, not merely to write this app. React and AG Grid Community provide the
interactive review and invoice workspaces. The PayPal Invoicing REST API is
central to draft creation, validation, payable links and status readback.

The sponsor boilerplate was reviewed for inspiration; its source was not copied.
AG Grid Community is used. AG Studio, Studio Agent Framework, enterprise-only
modules, and the PayPal AI Toolkit are not used. Sponsor eligibility and awards
are determined by the organizers.

`npm test` covers quote grounding, excluded/duplicate work, decimal amounts and
approval-versus-PayPal readback mismatches. It does not certify model judgment,
production security, adoption or prize eligibility.

Project source: MIT. Dependencies retain their own licenses; model weights are
not distributed in this repository. Google Fonts are loaded by the stylesheet.
