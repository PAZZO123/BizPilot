import { Logger } from '@nestjs/common';
import type { SendSmsRequest, SendSmsResult, SmsProvider } from './sms-provider.interface';

interface AfricasTalkingRecipient {
  statusCode: number;
  number: string;
  status: string;
  cost: string;
  messageId: string;
}

/**
 * Africa's Talking is the cheapest route to Rwandan handsets and supports
 * alphanumeric sender ids once they are registered with the operator.
 * https://developers.africastalking.com/docs/sms/sending/bulk
 */
export class AfricasTalkingProvider implements SmsProvider {
  readonly name = 'africastalking';
  private readonly logger = new Logger(AfricasTalkingProvider.name);

  constructor(
    private readonly username: string,
    private readonly apiKey: string,
  ) {}

  async send(request: SendSmsRequest): Promise<SendSmsResult> {
    const endpoint =
      this.username === 'sandbox'
        ? 'https://api.sandbox.africastalking.com/version1/messaging'
        : 'https://api.africastalking.com/version1/messaging';

    const body = new URLSearchParams({
      username: this.username,
      to: request.to,
      message: request.body,
      from: request.senderId,
    });

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        apiKey: this.apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Africa's Talking rejected the request (${response.status}): ${text}`);
    }

    const payload = (await response.json()) as {
      SMSMessageData?: { Recipients?: AfricasTalkingRecipient[] };
    };
    const recipient = payload.SMSMessageData?.Recipients?.[0];

    // 100-102 are the success codes; anything else is a delivery failure the
    // caller needs to see rather than a silently swallowed "sent".
    if (!recipient || recipient.statusCode < 100 || recipient.statusCode > 102) {
      throw new Error(
        `Africa's Talking could not send: ${recipient?.status ?? 'no recipient in response'}`,
      );
    }

    return {
      providerRef: recipient.messageId,
      cost: parseCost(recipient.cost),
    };
  }
}

/** Parses "RWF 12.5000" into minor units. Returns null if the shape changes. */
function parseCost(cost: string | undefined): bigint | null {
  if (!cost) return null;
  const amount = Number.parseFloat(cost.replace(/[^\d.]/g, ''));
  return Number.isFinite(amount) ? BigInt(Math.round(amount * 100)) : null;
}
