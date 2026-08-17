import { Logger } from '@nestjs/common';
import type { MailProvider, SendMailRequest } from './mail-provider.interface';

/**
 * Resend (resend.com) over its plain REST API — one POST, no SDK. The free
 * tier sends 100 emails a day, which covers password resets for a long time.
 *
 * Until a sending domain is verified there, `from` must be
 * `onboarding@resend.dev` and Resend only delivers to the account owner's own
 * address — fine for trying it, useless in production. Verify a domain and set
 * MAIL_FROM before real shops depend on this.
 */
export class ResendMailProvider implements MailProvider {
  readonly name = 'resend';
  private readonly logger = new Logger('Mail');

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(request: SendMailRequest): Promise<void> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [request.to],
        subject: request.subject,
        text: request.text,
        ...(request.html ? { html: request.html } : {}),
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      // The caller decides whether a failed mail is fatal; here we only make
      // sure the reason is in the log rather than swallowed.
      this.logger.error(`Resend refused the mail (${response.status}): ${body.slice(0, 300)}`);
      throw new Error(`Mail provider refused the message (HTTP ${response.status}).`);
    }
  }
}
