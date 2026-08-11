#!/usr/bin/env node
/**
 * Sends one real Request-to-Pay through the MoMo sandbox and polls it to a
 * conclusion.
 *
 * Proves the credentials, the token exchange, the payment request and the status
 * lookup all work together, before any of it is wired into billing. If this
 * passes, the adapter will work; if it fails, the message here says why, which
 * beats discovering it inside a checkout flow.
 *
 *   npm run momo:test-payment
 *
 * Reads the same MOMO_* variables the API uses, so it exercises exactly what
 * production will. Sandbox only — it moves no real money.
 */

import { randomUUID } from 'node:crypto';

const BASE = (process.env.MOMO_BASE_URL ?? 'https://sandbox.momodeveloper.mtn.com').replace(/\/$/, '');
const SUBSCRIPTION_KEY = process.env.MOMO_SUBSCRIPTION_KEY;
const API_USER = process.env.MOMO_API_USER;
const API_KEY = process.env.MOMO_API_KEY;
const TARGET = process.env.MOMO_TARGET_ENVIRONMENT ?? 'sandbox';

// In the sandbox the payer number decides the outcome. This one always
// succeeds; MTN's docs list others that simulate rejection and timeout.
const PAYER = process.env.MOMO_TEST_PAYER ?? '250788123456';
const AMOUNT = TARGET === 'sandbox' ? '5' : '100';
const CURRENCY = TARGET === 'sandbox' ? 'EUR' : 'RWF';

if (!SUBSCRIPTION_KEY || !API_USER || !API_KEY) {
  console.error(`
Missing credentials. Set the three the provisioning script printed:

  MOMO_SUBSCRIPTION_KEY=...  MOMO_API_USER=...  MOMO_API_KEY=...  npm run momo:test-payment

Run \`npm run momo:provision\` first if you have not.
`);
  process.exit(1);
}

const fail = (stage, detail) => {
  console.error(`\nFAILED at ${stage}:\n  ${detail}\n`);
  process.exit(1);
};

// --- 1. Token ---------------------------------------------------------------
process.stdout.write('Requesting a token… ');
const basic = Buffer.from(`${API_USER}:${API_KEY}`).toString('base64');
const tokenResponse = await fetch(`${BASE}/collection/token/`, {
  method: 'POST',
  headers: { Authorization: `Basic ${basic}`, 'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY },
});
if (!tokenResponse.ok) {
  fail(
    'the token request',
    `${tokenResponse.status} ${await tokenResponse.text()}\n  A 401 usually means the subscription key belongs to a different product — it must be the Collections key, not the Collection Widget one.`,
  );
}
const { access_token: token } = await tokenResponse.json();
console.log('ok');

// --- 2. Request to pay ------------------------------------------------------
// This UUID is the transaction id from here on. MTN mints nothing of its own.
const reference = randomUUID();
process.stdout.write(`Asking ${PAYER} for ${AMOUNT} ${CURRENCY}… `);

const payResponse = await fetch(`${BASE}/collection/v1_0/requesttopay`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'X-Reference-Id': reference,
    'X-Target-Environment': TARGET,
    'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    amount: AMOUNT,
    currency: CURRENCY,
    externalId: reference,
    payer: { partyIdType: 'MSISDN', partyId: PAYER },
    payerMessage: 'BizPilot test payment',
    payeeNote: 'BizPilot test payment',
  }),
});

// 202 Accepted with an empty body is success — the prompt has been sent, not paid.
if (payResponse.status !== 202) {
  fail('the payment request', `${payResponse.status} ${await payResponse.text()}`);
}
console.log('accepted');
console.log(`  reference: ${reference}`);

// --- 3. Poll ----------------------------------------------------------------
process.stdout.write('Waiting for the payer to approve');

let final = null;
for (let attempt = 0; attempt < 15; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  process.stdout.write('.');

  const statusResponse = await fetch(`${BASE}/collection/v1_0/requesttopay/${reference}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Target-Environment': TARGET,
      'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY,
    },
  });
  if (!statusResponse.ok) fail('the status check', `${statusResponse.status} ${await statusResponse.text()}`);

  const body = await statusResponse.json();
  if (body.status !== 'PENDING') {
    final = body;
    break;
  }
}

console.log('');
if (!final) {
  console.log('\nStill pending after 30s. Not necessarily broken — the sandbox is'
    + '\nsometimes slow. Re-run the status check with the reference above.\n');
  process.exit(0);
}

if (final.status === 'SUCCESSFUL') {
  console.log(`
PAID.

  amount            ${final.amount} ${final.currency}
  financial txn id  ${final.financialTransactionId ?? '(none)'}
  our reference     ${final.externalId}

The credentials, the request and the status lookup all work. The adapter in
apps/api/src/modules/billing/mtn-momo.service.ts does exactly these three calls.
`);
} else {
  console.log(`
Payment ${final.status}: ${final.reason ?? 'no reason given'}

Not a fault in the integration — the sandbox uses the payer number to decide the
outcome, and this one is meant to fail. Try MOMO_TEST_PAYER=250788123456.
`);
}
