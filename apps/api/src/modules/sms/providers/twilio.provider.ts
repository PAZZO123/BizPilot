import type { SendSmsRequest, SendSmsResult, SmsProvider } from './sms-provider.interface';

/**
 * Twilio fallback — more expensive per message than a regional gateway, but
 * it works everywhere and is the pragmatic choice for customers outside
 * East Africa.
 */
export class TwilioProvider implements SmsProvider {
  readonly name = 'twilio';

  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly fromNumber: string,
  ) {}

  async send(request: SendSmsRequest): Promise<SendSmsResult> {
    const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;
    const credentials = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        To: request.to,
        From: this.fromNumber,
        Body: request.body,
      }),
    });

    const payload = (await response.json()) as { sid?: string; message?: string; price?: string };

    if (!response.ok) {
      throw new Error(`Twilio rejected the request: ${payload.message ?? response.status}`);
    }

    return {
      providerRef: payload.sid ?? null,
      // Twilio reports price as a negative string ("-0.0075") and only after
      // the message settles, so it is usually absent on the send response.
      cost: payload.price ? BigInt(Math.round(Math.abs(Number(payload.price)) * 100)) : null,
    };
  }
}
