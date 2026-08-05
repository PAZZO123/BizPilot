export interface SendSmsRequest {
  /** E.164 destination, e.g. +250788123456. */
  to: string;
  body: string;
  /** Alphanumeric sender id, where the gateway supports one. */
  senderId: string;
}

export interface SendSmsResult {
  /** The gateway's message id, for delivery-report reconciliation. */
  providerRef: string | null;
  /** Cost charged by the gateway, in minor units, when it reports one. */
  cost: bigint | null;
}

/**
 * Every SMS gateway looks the same from the app's side. Swapping Africa's
 * Talking for Twilio should be an env var, not a code change.
 */
export interface SmsProvider {
  readonly name: string;
  send(request: SendSmsRequest): Promise<SendSmsResult>;
}
