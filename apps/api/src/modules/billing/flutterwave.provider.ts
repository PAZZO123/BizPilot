import { Injectable } from '@nestjs/common';
import { FlutterwaveService } from './flutterwave.service';
import type {
  CheckoutRequest,
  CheckoutResult,
  PaymentProvider,
  VerifiedPayment,
} from './payment-provider';

/**
 * Fits the existing Flutterwave client to the `PaymentProvider` interface.
 *
 * Written as a wrapper rather than by changing `flutterwave.service.ts`, because
 * that file is the only payment code that has ever been exercised end to end and
 * there is no reason to disturb its HTTP handling to satisfy a type. This maps
 * names and shapes; everything that talks to Flutterwave stays where it was.
 */
@Injectable()
export class FlutterwaveProvider implements PaymentProvider {
  readonly name = 'flutterwave';
  readonly channels: ('momo' | 'card' | 'bank')[] = ['card', 'momo', 'bank'];
  /** Flutterwave's test mode charges the currency it was asked for, so the
   *  strict settlement checks work there unchanged. */
  readonly isSandbox = false;

  constructor(private readonly flutterwave: FlutterwaveService) {}

  get isConfigured(): boolean {
    return this.flutterwave.isConfigured;
  }

  buildReference(prefix: string): string {
    return this.flutterwave.buildReference(prefix);
  }

  async createCheckout(request: CheckoutRequest): Promise<CheckoutResult> {
    const { link } = await this.flutterwave.createCheckout({
      txRef: request.reference,
      amount: request.amount,
      currency: request.currency,
      redirectUrl: request.returnUrl,
      customer: {
        email: request.customer.email ?? 'customer@bizpilot.app',
        name: request.customer.name,
        phone: request.customer.phone,
      },
      title: request.title ?? 'BizPilot',
      description: request.description,
      logo: request.logoUrl,
      meta: request.meta,
      // Mobile money and bank transfer are only offered where Flutterwave
      // supports them; elsewhere the hosted page would show a dead option.
      paymentOptions:
        request.currency === 'RWF' ? 'card,mobilemoneyrwanda,banktransfer' : 'card',
    });

    return { kind: 'redirect', url: link };
  }

  async verifyPayment(providerTransactionId: string): Promise<VerifiedPayment> {
    const verified = await this.flutterwave.verifyTransaction(providerTransactionId);
    return {
      providerRef: verified.id,
      reference: verified.txRef,
      status: verified.status,
      // Flutterwave reports both; the charged figure is what actually left the
      // payer, and it is the one the amount check must use.
      amount: verified.chargedAmount || verified.amount,
      currency: verified.currency,
      meta: verified.meta,
      raw: verified.raw,
    };
  }

  verifyWebhookSignature(signature: string | undefined): boolean {
    return this.flutterwave.verifyWebhookSignature(signature);
  }

  extractTransactionId(payload: Record<string, unknown>): string | null {
    const data = payload.data as { id?: number | string } | undefined;
    return data?.id !== undefined ? String(data.id) : null;
  }
}
