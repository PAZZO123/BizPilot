import { Logger } from '@nestjs/common';
import type { MailProvider, SendMailRequest } from './mail-provider.interface';

/**
 * The default when no mail credentials exist. Prints the whole message to the
 * server log so the flow can be exercised end to end in development — the
 * password-reset link lands in the log instead of an inbox.
 */
export class LogMailProvider implements MailProvider {
  readonly name = 'log';
  private readonly logger = new Logger('Mail');

  async send(request: SendMailRequest): Promise<void> {
    this.logger.log(`[mail:log] To: ${request.to}`);
    this.logger.log(`[mail:log] Subject: ${request.subject}`);
    for (const line of request.text.split('\n')) {
      this.logger.log(`[mail:log] ${line}`);
    }
  }
}
