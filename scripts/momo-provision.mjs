#!/usr/bin/env node
/**
 * Creates an MTN MoMo sandbox API user and prints the credentials to set.
 *
 * MTN's sandbox does not hand you a key pair on the website. You subscribe to
 * Collections to get a subscription key, then call two endpoints to mint an API
 * user and its key — a UUID you generate yourself, then a POST that turns it
 * into a secret. It is a fiddly one-off, easy to get subtly wrong by hand, and
 * the failure mode is a 401 hours later.
 *
 *   MOMO_SUBSCRIPTION_KEY=xxxx npm run momo:provision
 *
 * Prints the three values to paste into Render. Run it once; the API user is
 * permanent. Sandbox only — production credentials come from MTN directly.
 */

import { randomUUID } from 'node:crypto';

const BASE = process.env.MOMO_BASE_URL ?? 'https://sandbox.momodeveloper.mtn.com';
const SUBSCRIPTION_KEY = process.env.MOMO_SUBSCRIPTION_KEY;
// Only used so MTN has somewhere to call back; it is not contacted during setup.
const CALLBACK_HOST = process.env.MOMO_CALLBACK_HOST ?? 'bizpilot-api-si8e.onrender.com';

if (!SUBSCRIPTION_KEY) {
  console.error(`
Missing MOMO_SUBSCRIPTION_KEY.

  1. Sign up at https://momodeveloper.mtn.com (free, no verification)
  2. Products -> Collections -> Subscribe
  3. Your profile shows a "Primary Key" — that is the subscription key

Then run:

  MOMO_SUBSCRIPTION_KEY=your-primary-key npm run momo:provision
`);
  process.exit(1);
}

const apiUser = randomUUID();

async function call(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  const text = await response.text();
  return { status: response.status, text };
}

console.log(`Creating sandbox API user ${apiUser}…`);

// 1. Create the user. The UUID we generate becomes its identifier.
const created = await call('/v1_0/apiuser', {
  method: 'POST',
  headers: { 'X-Reference-Id': apiUser },
  body: JSON.stringify({ providerCallbackHost: CALLBACK_HOST }),
});

if (created.status !== 201) {
  console.error(`\nFailed to create the API user: ${created.status} ${created.text}`);
  console.error('A 401 here means the subscription key is wrong or not yet active.');
  process.exit(1);
}

// 2. Turn it into a key. This is the only time the secret is shown.
const key = await call(`/v1_0/apiuser/${apiUser}/apikey`, { method: 'POST' });
if (key.status !== 201) {
  console.error(`\nFailed to create the API key: ${key.status} ${key.text}`);
  process.exit(1);
}

const { apiKey } = JSON.parse(key.text);

// 3. Prove the pair works before printing it, so a bad credential is caught
//    here rather than on the first real payment.
const basic = Buffer.from(`${apiUser}:${apiKey}`).toString('base64');
const token = await fetch(`${BASE}/collection/token/`, {
  method: 'POST',
  headers: {
    Authorization: `Basic ${basic}`,
    'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY,
  },
});

console.log(
  token.ok
    ? '\nCredentials verified — a token was issued.\n'
    : `\nWARNING: created, but the token request returned ${token.status}.\n`,
);

console.log('Set these on bizpilot-api:\n');
console.log(`  PAYMENT_PROVIDER        mtn-momo`);
console.log(`  MOMO_SUBSCRIPTION_KEY   ${SUBSCRIPTION_KEY}`);
console.log(`  MOMO_API_USER           ${apiUser}`);
console.log(`  MOMO_API_KEY            ${apiKey}`);
console.log(`  MOMO_TARGET_ENVIRONMENT sandbox`);
console.log(`  MOMO_CALLBACK_SECRET    ${randomUUID().replace(/-/g, '')}`);
console.log(`
Keep MOMO_API_KEY somewhere safe — MTN will not show it again.
In the sandbox, a payer number ending 46733664 always succeeds; other numbers
can be used to simulate failures. Sandbox settles in EUR, production in RWF —
the adapter picks the right one from MOMO_TARGET_ENVIRONMENT.
`);
