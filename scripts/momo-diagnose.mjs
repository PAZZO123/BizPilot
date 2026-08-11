#!/usr/bin/env node
/**
 * Finds out why a Request to Pay was rejected.
 *
 * `momo:test-payment` proves the credentials work by sending a deliberately
 * minimal payment: 5 EUR, a known-good test number, no callback. The real
 * checkout sends more than that — the plan's actual price, whatever phone number
 * is on the account, and an X-Callback-Url header — and any one of those can be
 * the thing MTN objects to. The API only sees "not 202" and says so politely,
 * which is right for a shopkeeper and useless for debugging.
 *
 * So this sends the same request several times, changing one thing at a time,
 * and prints MTN's raw answer to each. The first probe that fails names the
 * culprit.
 *
 *   npm run momo:diagnose -- <subscription-key> <api-user> <api-key>
 *
 * Optionally pass the number and amount you actually tried:
 *
 *   npm run momo:diagnose -- <sub> <user> <key> 0788123456 7000
 *
 * Sandbox only. It moves no real money.
 */

import { randomUUID } from 'node:crypto';

const BASE = (process.env.MOMO_BASE_URL ?? 'https://sandbox.momodeveloper.mtn.com').replace(
  /\/$/,
  '',
);
const [argSubscription, argUser, argKey, argPhone, argAmount] = process.argv.slice(2);
const SUBSCRIPTION_KEY = argSubscription ?? process.env.MOMO_SUBSCRIPTION_KEY;
const API_USER = argUser ?? process.env.MOMO_API_USER;
const API_KEY = argKey ?? process.env.MOMO_API_KEY;
const TARGET = process.env.MOMO_TARGET_ENVIRONMENT ?? 'sandbox';
const CURRENCY = TARGET === 'sandbox' ? 'EUR' : 'RWF';

// Same host the API registered when the API user was created. If these two ever
// disagree MTN rejects the request outright, which is exactly the kind of thing
// this script exists to catch.
const CALLBACK_HOST = process.env.MOMO_CALLBACK_HOST ?? 'bizpilot-api-si8e.onrender.com';
const CALLBACK_URL = `https://${CALLBACK_HOST}/api/webhooks/momo/diagnostic-probe`;

// The number MTN's sandbox always approves, unless you name another.
const KNOWN_GOOD_PHONE = '250788123456';
const REAL_PHONE = normalise(argPhone) ?? KNOWN_GOOD_PHONE;
// The Starter plan, as the checkout would send it.
const REAL_AMOUNT = argAmount ?? '7000';

if (!SUBSCRIPTION_KEY || !API_USER || !API_KEY) {
  console.error(`
Missing credentials. Pass the three the provisioning script printed, in that
order — subscription key, api user, api key:

  npm run momo:diagnose -- <subscription-key> <api-user> <api-key>
`);
  process.exit(1);
}

/** Same conversion the API does, so the probe uses the number MTN will see. */
function normalise(input, countryCode = '250') {
  if (!input) return null;
  const digits = String(input).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith(countryCode)) return digits;
  if (digits.startsWith('0')) return countryCode + digits.slice(1);
  if (digits.length === 9) return countryCode + digits;
  return digits;
}

// --- Token ------------------------------------------------------------------
process.stdout.write('Requesting a token… ');
const basic = Buffer.from(`${API_USER}:${API_KEY}`).toString('base64');
const tokenResponse = await fetch(`${BASE}/collection/token/`, {
  method: 'POST',
  headers: { Authorization: `Basic ${basic}`, 'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY },
});
if (!tokenResponse.ok) {
  console.error(`\nThe token request failed: ${tokenResponse.status} ${await tokenResponse.text()}`);
  console.error('A 401 means the subscription key is for the wrong product — it must be Collections.');
  process.exit(1);
}
const { access_token: token } = await tokenResponse.json();
console.log('ok\n');

/** One Request to Pay. Returns MTN's status and body verbatim. */
async function probe({ label, phone, amount, callback }) {
  const reference = randomUUID();
  const response = await fetch(`${BASE}/collection/v1_0/requesttopay`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Reference-Id': reference,
      'X-Target-Environment': TARGET,
      'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY,
      'Content-Type': 'application/json',
      ...(callback ? { 'X-Callback-Url': CALLBACK_URL } : {}),
    },
    body: JSON.stringify({
      amount,
      currency: CURRENCY,
      externalId: reference,
      payer: { partyIdType: 'MSISDN', partyId: phone },
      payerMessage: 'BizPilot diagnostic',
      payeeNote: 'BizPilot diagnostic',
    }),
  });

  const body = await response.text().catch(() => '');
  const ok = response.status === 202;
  console.log(`${ok ? 'ACCEPTED' : 'REJECTED'}  ${label}`);
  console.log(`          ${amount} ${CURRENCY} to ${phone}${callback ? ' + callback url' : ''}`);
  if (!ok) console.log(`          MTN said: ${response.status} ${body.slice(0, 400) || '(empty body)'}`);
  console.log();
  return ok;
}

// Each probe changes exactly one thing from the one before it, so the first
// REJECTED line names what the checkout is doing that the passing test did not.
const results = [];
results.push([
  'baseline — what momo:test-payment sends',
  await probe({ label: 'baseline — what momo:test-payment sends', phone: KNOWN_GOOD_PHONE, amount: '5', callback: false }),
]);
results.push([
  'the real amount',
  await probe({ label: 'the real amount', phone: KNOWN_GOOD_PHONE, amount: REAL_AMOUNT, callback: false }),
]);
results.push([
  'the real phone number',
  await probe({ label: 'the real phone number', phone: REAL_PHONE, amount: REAL_AMOUNT, callback: false }),
]);
results.push([
  'with the callback url — the full checkout request',
  await probe({ label: 'with the callback url — the full checkout request', phone: REAL_PHONE, amount: REAL_AMOUNT, callback: true }),
]);

const firstFailure = results.find(([, ok]) => !ok);
console.log('---');
if (!firstFailure) {
  console.log('Every probe was accepted. MTN is not rejecting the request shape, so the');
  console.log('difference is in the environment — check MOMO_TARGET_ENVIRONMENT and');
  console.log('API_URL on the API service, and read the API log line beginning "MoMo".');
} else {
  console.log(`First rejection: ${firstFailure[0]}`);
  console.log('That is the change the checkout makes which MTN will not accept.');
}
