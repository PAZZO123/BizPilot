import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';

const API_BASE = 'https://api.flutterwave.com/v3';

export interface CheckoutRequest {
  /** Our own reference. Must be unique — it is how we recognise the payment. */
  txRef: string;
  /** Amount in major units, already rounded for the currency. */
  amount: number;
  currency: string;
  redirectUrl: string;
  customer: { email: string; name?: string; phone?: string };
  title: string;
  description: string;
  logo?: string;
  /** Echoed back on the webhook — we use it to route the payment. */
  meta: Record<string, string>;
  /** Restricts the channels offered, e.g. ['card', 'mobilemoneyrwanda']. */
  paymentOptions?: string;
}

export interface VerifiedTransaction {
  id: string;
  txRef: string;
  status: 'successful' | 'failed' | 'pending';
  amount: number;
  currency: string;
  chargedAmount: number;
  paymentType: string | null;
  customerEmail: string | null;
  meta: Record<string, unknown>;
  raw: unknown;
}

/**
 * Thin client over Flutterwave's Standard checkout.
 *
 * Flutterwave is the gateway that actually works in Rwanda: MTN and Airtel
 * mobile money, cards, and settlement to a local bank account in RWF. Stripe
 * does not onboard Rwandan merchants, so it is not an option for collecting
 * subscription revenue here.
 */
@Injectable()
export class FlutterwaveService {
  private readonly logger = new Logger(FlutterwaveService.name);
  private readonly secretKey: string;
  private readonly webhookHash: string;

  constructor(private readonly config: ConfigService) {
    this.secretKey = this.config.get<string>('FLUTTERWAVE_SECRET_KEY', '');
    this.webhookHash = this.config.get<string>('FLUTTERWAVE_WEBHOOK_HASH', '');
  }

  get isConfigured(): boolean {
    return Boolean(this.secretKey);
  }

  /** A tx_ref that is unique, readable in the dashboard, and not guessable. */
  buildReference(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}-${randomBytes(6).toString('hex')}`;
  }

  /**
   * Creates a hosted checkout and returns the URL to send the payer to.
   * We never touch card details — they are entered on Flutterwave's page,
   * which keeps PCI scope off this application entirely.
   */
  async createCheckout(request: CheckoutRequest): Promise<{ link: string }> {
    this.assertConfigured();

    const response = await this.post('/payments', {
      tx_ref: request.txRef,
      amount: request.amount,
      currency: request.currency,
      redirect_url: request.redirectUrl,
      payment_options: request.paymentOptions,
      customer: {
        email: request.customer.email,
        name: request.customer.name,
        phonenumber: request.customer.phone,
      },
      customizations: {
        title: request.title,
        description: request.description,
        logo: request.logo,
      },
      meta: request.meta,
    });

    const link = (response as { data?: { link?: string } }).data?.link;
    if (!link) {
      throw new ServiceUnavailableException('The payment provider did not return a checkout link.');
    }
    return { link };
  }

  /**
   * Confirms a transaction with Flutterwave directly.
   *
   * Never trust the redirect back from the checkout page or the webhook body
   * on its own — both are attacker-controllable. The only source of truth for
   * "this was really paid" is this call.
   */
  async verifyTransaction(transactionId: string | number): Promise<VerifiedTransaction> {
    this.assertConfigured();

    const response = await this.get(`/transactions/${transactionId}/verify`);
    const data = (response as { data?: Record<string, unknown> }).data;
    if (!data) {
      throw new ServiceUnavailableException('The payment provider returned no transaction data.');
    }

    return {
      id: String(data.id),
      txRef: String(data.tx_ref ?? ''),
      status: (data.status as VerifiedTransaction['status']) ?? 'pending',
      amount: Number(data.amount ?? 0),
      currency: String(data.currency ?? ''),
      chargedAmount: Number(data.charged_amount ?? data.amount ?? 0),
      paymentType: (data.payment_type as string) ?? null,
      customerEmail:
        ((data.customer as { email?: string } | undefined)?.email as string) ?? null,
      meta: (data.meta as Record<string, unknown>) ?? {},
      raw: data,
    };
  }

  /**
   * Validates the `verif-hash` header Flutterwave sends with every webhook.
   *
   * Uses a length-safe comparison so the check cannot be probed a character at
   * a time. If no hash is configured we reject everything rather than accepting
   * everything — an unauthenticated webhook can credit a subscription.
   */
  verifyWebhookSignature(signature: string | undefined): boolean {
    if (!this.webhookHash) {
      this.logger.error(
        'FLUTTERWAVE_WEBHOOK_HASH is not set — rejecting webhook. Set it in the dashboard and in the environment.',
      );
      return false;
    }
    if (!signature) return false;

    // Constant-time compare over equal-length buffers.
    const expected = Buffer.from(this.webhookHash);
    const received = Buffer.from(signature);
    if (expected.length !== received.length) return false;

    let diff = 0;
    for (let index = 0; index < expected.length; index += 1) {
      diff |= expected[index] ^ received[index];
    }
    return diff === 0;
  }

  // -------------------------------------------------------------------------

  private assertConfigured(): void {
    if (!this.isConfigured) {
      throw new ServiceUnavailableException(
        'Online payments are not set up yet. Add your Flutterwave keys to enable them.',
      );
    }
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    return this.request(path, { method: 'POST', body: JSON.stringify(body) });
  }

  private async get(path: string): Promise<unknown> {
    return this.request(path, { method: 'GET' });
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json',
        },
        // A gateway that has not answered in 30s is not going to.
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      this.logger.error(`Flutterwave request to ${path} failed: ${(error as Error).message}`);
      throw new ServiceUnavailableException(
        'Could not reach the payment provider. Please try again.',
      );
    }

    const payload = (await response.json().catch(() => null)) as {
      status?: string;
      message?: string;
    } | null;

    if (!response.ok || payload?.status === 'error') {
      const message = payload?.message ?? `HTTP ${response.status}`;
      this.logger.error(`Flutterwave rejected ${path}: ${message}`);
      throw new ServiceUnavailableException(`Payment provider error: ${message}`);
    }

    return payload;
  }
}
