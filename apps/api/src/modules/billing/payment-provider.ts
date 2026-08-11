/**
 * What BizPilot needs from a payment provider.
 *
 * This interface exists because the provider has been wrong twice. Stripe does
 * not onboard Rwandan merchants; Flutterwave was chosen instead and may not
 * either. Billing was welded to one vendor's SDK both times, so each discovery
 * meant surgery on the settlement path — the code that activates plans and
 * clears customer debts, which is the last code you want to keep rewriting.
 *
 * Everything above this line is provider-agnostic: BillingService creates a
 * pending row, hands off, and settles on confirmation. Swapping providers should
 * mean writing one adapter, not touching settlement.
 *
 *
 * ## Two shapes of payment, not one
 *
 * The mistake worth not repeating is assuming every provider redirects to a
 * hosted page. Mobile money does not:
 *
 *   REDIRECT   — Flutterwave, Paystack, Pesapal, most card gateways.
 *                We return a URL. The payer leaves, pays, comes back.
 *
 *   PUSH       — MTN MoMo, Airtel Money, direct telco APIs.
 *                There is no page. We send a request to a phone number, the
 *                payer approves it on a USSD prompt, and we learn the outcome
 *                from a callback or by polling. The browser never leaves.
 *
 * These need different interfaces AND different screens — a PUSH provider needs
 * a phone-number field and a "check your phone" state, which a redirect flow has
 * no use for. `CheckoutResult` is a discriminated union so the front end is
 * forced to handle whichever it is given rather than assuming a URL exists.
 *
 * In Rwanda, PUSH is the important one: mobile money penetration is around 90%,
 * and a shopkeeper paying RWF 7,000 a month is far more likely to have MoMo than
 * a card.
 */

export interface CheckoutRequest {
  /** Our reference. Unique, and how we recognise the payment coming back. */
  reference: string;
  /** Major units, already rounded for the currency. */
  amount: number;
  currency: string;
  description: string;
  customer: { email?: string; name?: string; phone?: string };
  /** Where a REDIRECT provider should return the payer. */
  returnUrl: string;
  /** Shown on a hosted checkout page. Ignored by PUSH providers. */
  title?: string;
  logoUrl?: string;
  /** Echoed back on confirmation; used to route the settlement. */
  meta: Record<string, string>;
}

export type CheckoutResult =
  | { kind: 'redirect'; url: string }
  /**
   * The payer has been sent a prompt. Nothing is paid yet — the front end shows
   * "approve it on your phone" and waits for the callback or polls `status`.
   */
  | { kind: 'push'; sentTo: string; pollAfterMs: number };

export interface VerifiedPayment {
  /** The provider's own id, stored for reconciliation. */
  providerRef: string;
  reference: string;
  status: 'successful' | 'failed' | 'pending';
  /** Major units, as actually charged — checked against what we asked for. */
  amount: number;
  currency: string;
  meta: Record<string, unknown>;
  raw: unknown;
}

export interface PaymentProvider {
  /** Shown in logs and stored on transactions. */
  readonly name: string;

  /** False when keys are missing, so the UI can say payments are not set up. */
  readonly isConfigured: boolean;

  /** Which channels this provider actually offers, for the payment screen. */
  readonly channels: ('momo' | 'card' | 'bank')[];

  /**
   * True when pointed at the provider's test environment.
   *
   * Settlement uses this to relax exactly one check — see `checkAmount` in
   * BillingService. MTN's sandbox settles every payment in EUR no matter what
   * currency was asked for, so a strict currency comparison makes a sandbox
   * payment unsettleable and the feature untestable before MTN grant production
   * access. Nothing else changes, and a provider pointed at production must
   * report false so the strict path is the only one that can ever run there.
   */
  readonly isSandbox: boolean;

  /** A reference that is unique, readable in the provider's dashboard, and
   *  not guessable. */
  buildReference(prefix: string): string;

  /** Starts a payment. See `CheckoutResult` — do not assume a URL. */
  createCheckout(request: CheckoutRequest): Promise<CheckoutResult>;

  /**
   * Asks the provider what really happened.
   *
   * The only source of truth. Never trust a webhook body or a browser redirect
   * on its own — both are attacker-controllable. Every adapter must call the
   * provider back before anything is credited.
   */
  verifyPayment(providerTransactionId: string): Promise<VerifiedPayment>;

  /**
   * Authenticates an incoming webhook.
   *
   * Must fail closed: no configured secret means reject everything, because an
   * unauthenticated webhook can activate a paid plan for nothing.
   */
  verifyWebhookSignature(signature: string | undefined, rawBody?: Buffer): boolean;

  /** Pulls the provider's transaction id out of a webhook body. */
  extractTransactionId(payload: Record<string, unknown>): string | null;
}

/** Nest injection token — `@Inject(PAYMENT_PROVIDER)`. */
export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
