import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type {
  CheckoutRequest,
  CheckoutResult,
  PaymentProvider,
  VerifiedPayment,
} from './payment-provider';

/**
 * MTN Mobile Money — Collections.
 *
 * Chosen because it is the one provider that can be integrated today at no cost:
 * the sandbox is self-service, needs no business verification, and MoMo is
 * roughly 90% of payments in Rwanda. Production needs MTN's approval, but the
 * code path is identical — different credentials and a different target
 * environment.
 *
 * This is a PUSH provider. There is no page to redirect anyone to: we send a
 * prompt to a phone number, the payer approves it on a USSD menu, and we find
 * out by callback or by polling. `createCheckout` therefore returns
 * `{ kind: 'push' }` and nothing is paid at that moment.
 *
 * ## The reference is the transaction id
 *
 * MTN does not mint an id. The `X-Reference-Id` UUID *we* generate is what the
 * payment is called forever after — it is how we poll status and how we
 * recognise a callback. So it is generated once, returned as our reference, and
 * stored. Losing it means losing the payment.
 *
 * ## Sandbox charges in EUR
 *
 * The sandbox rejects RWF; it only settles in EUR. Production for MTN Rwanda
 * uses RWF. Sending the wrong one is a 400 that reads like a malformed request,
 * so the currency is derived from the target environment rather than passed in.
 */
@Injectable()
export class MtnMomoService implements PaymentProvider {
  readonly name = 'mtn-momo';
  readonly channels: ('momo' | 'card' | 'bank')[] = ['momo'];

  private readonly logger = new Logger(MtnMomoService.name);
  private readonly baseUrl: string;
  private readonly subscriptionKey: string;
  private readonly apiUser: string;
  private readonly apiKey: string;
  private readonly targetEnvironment: string;
  private readonly callbackSecret: string;

  /** Cached bearer token — MTN's expire in an hour and re-minting each call is
   *  a wasted round trip on every payment. */
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config
      .get<string>('MOMO_BASE_URL', 'https://sandbox.momodeveloper.mtn.com')
      .replace(/\/$/, '');
    // Trimmed because these are pasted by hand into a hosting dashboard, and a
    // trailing space is invisible in every UI that shows them.
    this.subscriptionKey = this.config.get<string>('MOMO_SUBSCRIPTION_KEY', '').trim();
    this.apiUser = this.config.get<string>('MOMO_API_USER', '').trim();
    this.apiKey = this.config.get<string>('MOMO_API_KEY', '').trim();
    this.targetEnvironment = this.config
      .get<string>('MOMO_TARGET_ENVIRONMENT', 'sandbox')
      .trim()
      .toLowerCase();
    this.callbackSecret = this.config.get<string>('MOMO_CALLBACK_SECRET', '').trim();

    // Printed at boot because the pairing of environment and currency is the
    // thing that goes wrong, and it is otherwise invisible until a shopkeeper
    // is standing in front of a failed upgrade.
    if (this.isConfigured) {
      // The host — never the path, which carries the callback secret. MTN
      // checks this against the providerCallbackHost registered when the API
      // user was created, so a mismatch here breaks every payment while every
      // local test passes.
      const callbackHost = (() => {
        try {
          return new URL(this.config.get<string>('API_URL', '')).host;
        } catch {
          return 'unset';
        }
      })();

      this.logger.log(
        `Target environment "${this.targetEnvironment}", settling in ${this.currency}, ` +
          `callbacks to ${callbackHost}` +
          `${this.callbackSecret ? '' : ' (no callback secret set)'}.`,
      );
    }
  }

  get isConfigured(): boolean {
    return Boolean(this.subscriptionKey && this.apiUser && this.apiKey);
  }

  /**
   * Sandbox settles in EUR whatever you ask for; production uses the local
   * currency. Getting this wrong is a 400 that looks like a bad request body.
   *
   * Derived from `isSandbox` rather than testing the raw string again. When
   * these were two separate comparisons — `=== 'sandbox'` here and
   * `!== 'production'` there — any third value split them apart: "Sandbox" with
   * a capital S, or a trailing space, meant the request went to the sandbox
   * asking to be settled in francs, which the sandbox does not do. Every
   * checkout was rejected and the two lines that caused it each looked correct
   * on its own.
   */
  private get currency(): string {
    return this.isSandbox ? 'EUR' : 'RWF';
  }

  /** Anything that is not literally MTN's production environment. Deliberately
   *  a whitelist: a typo in the variable errs towards test, never towards
   *  treating a sandbox payment as real money. */
  get isSandbox(): boolean {
    return this.targetEnvironment !== 'production';
  }

  buildReference(): string {
    // MTN requires a UUID, and this same value is the transaction id.
    return randomUUID();
  }

  async createCheckout(request: CheckoutRequest): Promise<CheckoutResult> {
    this.assertConfigured();

    const phone = normaliseMsisdn(request.customer.phone);
    if (!phone) {
      throw new ServiceUnavailableException(
        'A mobile money number is needed to take this payment.',
      );
    }

    await this.post('/collection/v1_0/requesttopay', {
      // The reference doubles as X-Reference-Id, so status lookups find it.
      referenceId: request.reference,
      body: {
        // MTN wants the amount as a string, and rejects trailing decimals on
        // zero-decimal currencies.
        amount:
          this.currency === 'RWF' ? String(Math.round(request.amount)) : request.amount.toFixed(2),
        currency: this.currency,
        externalId: request.reference,
        payer: { partyIdType: 'MSISDN', partyId: phone },
        // Both of these are shown to the payer on their handset. Keep them
        // short — long strings are truncated by the USSD menu.
        payerMessage: request.description.slice(0, 60),
        payeeNote: request.description.slice(0, 60),
      },
    });

    return {
      kind: 'push',
      sentTo: phone,
      // Nobody approves a USSD prompt in under a couple of seconds.
      pollAfterMs: 4000,
    };
  }

  async verifyPayment(referenceId: string): Promise<VerifiedPayment> {
    this.assertConfigured();

    const data = (await this.get(`/collection/v1_0/requesttopay/${referenceId}`)) as {
      status?: string;
      amount?: string;
      currency?: string;
      externalId?: string;
      financialTransactionId?: string;
      reason?: string;
    };

    const status =
      data.status === 'SUCCESSFUL' ? 'successful' : data.status === 'FAILED' ? 'failed' : 'pending';

    if (status === 'failed') {
      this.logger.warn(`MoMo payment ${referenceId} failed: ${data.reason ?? 'no reason given'}`);
    }

    return {
      // MTN's own id appears only once the payment succeeds; before that our
      // reference is all there is.
      providerRef: data.financialTransactionId ?? referenceId,
      reference: data.externalId ?? referenceId,
      status,
      amount: Number(data.amount ?? 0),
      currency: String(data.currency ?? this.currency),
      meta: {},
      raw: data,
    };
  }

  /**
   * MTN's callbacks are not signed.
   *
   * There is no HMAC and no shared secret in the protocol, so the callback body
   * cannot be authenticated the way Flutterwave's `verif-hash` can. Two things
   * make that survivable, and both are load-bearing:
   *
   *  - a shared secret in the callback URL path, so an attacker has to guess it
   *    before they can even reach the handler;
   *  - and, far more importantly, the callback is treated purely as a nudge.
   *    Nothing is credited from its contents — the handler calls `verifyPayment`
   *    and believes only that. A forged callback for a payment that did not
   *    happen therefore achieves nothing beyond a wasted lookup.
   */
  verifyWebhookSignature(signature: string | undefined): boolean {
    if (!this.callbackSecret) {
      this.logger.error('MOMO_CALLBACK_SECRET is not set — rejecting callback.');
      return false;
    }
    if (!signature) return false;

    const expected = Buffer.from(this.callbackSecret);
    const received = Buffer.from(signature);
    if (expected.length !== received.length) return false;

    let diff = 0;
    for (let index = 0; index < expected.length; index += 1) {
      diff |= expected[index] ^ received[index];
    }
    return diff === 0;
  }

  extractTransactionId(payload: Record<string, unknown>): string | null {
    // MTN echoes our own reference back as externalId; referenceId appears on
    // some callback shapes.
    const value = payload.externalId ?? payload.referenceId;
    return typeof value === 'string' ? value : null;
  }

  // -------------------------------------------------------------------------

  private assertConfigured(): void {
    if (!this.isConfigured) {
      throw new ServiceUnavailableException(
        'Mobile money is not set up yet. Add the MTN MoMo credentials to enable it.',
      );
    }
  }

  /**
   * Bearer token, cached until shortly before it expires.
   *
   * Minted with HTTP Basic over the API user and key — which are themselves
   * created once, out of band, against the developer portal.
   */
  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) return this.token.value;

    const basic = Buffer.from(`${this.apiUser}:${this.apiKey}`).toString('base64');
    const response = await fetch(`${this.baseUrl}/collection/token/`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Ocp-Apim-Subscription-Key': this.subscriptionKey,
      },
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      this.logger.error(`MoMo token request failed: ${response.status} ${detail.slice(0, 200)}`);
      throw new ServiceUnavailableException('Could not reach mobile money. Please try again.');
    }

    const payload = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!payload.access_token) {
      throw new ServiceUnavailableException('Mobile money did not return a token.');
    }

    // Expire a minute early so a token cannot lapse mid-request.
    const ttl = (payload.expires_in ?? 3600) * 1000 - 60_000;
    this.token = { value: payload.access_token, expiresAt: Date.now() + ttl };
    return payload.access_token;
  }

  private async post(
    path: string,
    options: { referenceId: string; body: unknown },
  ): Promise<void> {
    const token = await this.accessToken();
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Reference-Id': options.referenceId,
        'X-Target-Environment': this.targetEnvironment,
        'Ocp-Apim-Subscription-Key': this.subscriptionKey,
        'Content-Type': 'application/json',
        ...(this.callbackSecret && this.config.get<string>('API_URL')
          ? {
              'X-Callback-Url': `${this.config.get<string>('API_URL')}/api/webhooks/momo/${this.callbackSecret}`,
            }
          : {}),
      },
      body: JSON.stringify(options.body),
      signal: AbortSignal.timeout(30_000),
    });

    // A request to pay is accepted, not completed — 202 with an empty body is
    // success. Anything else is a real failure.
    if (response.status !== 202) {
      const detail = await response.text().catch(() => '');
      this.logger.error(`MoMo ${path} failed: ${response.status} ${detail.slice(0, 300)}`);

      if (response.status === 409) {
        throw new ServiceUnavailableException('That payment has already been requested.');
      }

      // MTN's reason is a machine code — NOT_ENOUGH_FUNDS, PAYER_NOT_FOUND,
      // INVALID_CURRENCY and so on. "Check the number and try again" is wrong
      // advice for most of them and sends the payer chasing a fault that is not
      // theirs, so say which one it was. Nothing in these bodies is secret.
      throw new ServiceUnavailableException(explainMomoRejection(detail));
    }
  }

  private async get(path: string): Promise<unknown> {
    const token = await this.accessToken();
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Target-Environment': this.targetEnvironment,
        'Ocp-Apim-Subscription-Key': this.subscriptionKey,
      },
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      this.logger.error(`MoMo ${path} failed: ${response.status} ${detail.slice(0, 200)}`);
      throw new ServiceUnavailableException('Could not check the payment. Please try again.');
    }
    return response.json();
  }
}

/**
 * Turns MTN's rejection into something the person staring at the screen can act
 * on.
 *
 * The API returns a code in the body — the useful part — and the generic
 * "check the number" message was wrong for most of them: a payer with an empty
 * wallet, a currency the environment does not settle, and a number that is not
 * on MTN all got the same advice, and only one of them involves the number.
 * Unrecognised codes are passed through rather than flattened, because the next
 * unfamiliar one should still say something true.
 */
export function explainMomoRejection(body: string): string {
  let code = '';
  try {
    code = String((JSON.parse(body) as { code?: string }).code ?? '');
  } catch {
    // Some errors come back as bare text, or as an empty body on a 500.
    code = /[A-Z_]{6,}/.exec(body)?.[0] ?? '';
  }

  switch (code) {
    case 'PAYER_NOT_FOUND':
    case 'PAYEE_NOT_FOUND':
      return 'That number is not registered for mobile money. Check it and try again.';
    case 'NOT_ENOUGH_FUNDS':
      return 'There is not enough money in that mobile money account.';
    case 'PAYER_LIMIT_REACHED':
      return 'That mobile money account has reached its limit for now.';
    case 'INVALID_CURRENCY':
      return 'Mobile money cannot take a payment in this currency. Tell the shop owner.';
    case 'RESOURCE_ALREADY_EXIST':
      return 'That payment has already been requested.';
    case 'SERVICE_UNAVAILABLE':
    case 'INTERNAL_PROCESSING_ERROR':
      return 'Mobile money is not responding right now. Please try again in a moment.';
    case '':
      return 'Mobile money could not take that payment. Please try again.';
    default:
      // Readable enough to search for, and it is the only clue an operator has.
      return `Mobile money refused the payment (${code}).`;
  }
}

/**
 * Rwandan mobile numbers into the international form MTN expects: no plus, no
 * spaces, country code included.
 *
 * Shopkeepers type these every way imaginable — 0788…, +250 788…, 250-788… —
 * and MTN rejects anything but the bare digits.
 */
export function normaliseMsisdn(input: string | undefined, countryCode = '250'): string | null {
  if (!input) return null;
  const digits = input.replace(/\D/g, '');
  if (!digits) return null;

  if (digits.startsWith(countryCode)) return digits;
  // A local number written with its trunk zero: 0788… -> 250788…
  if (digits.startsWith('0')) return countryCode + digits.slice(1);
  // Bare subscriber number: 788… -> 250788…
  if (digits.length === 9) return countryCode + digits;
  return digits;
}
