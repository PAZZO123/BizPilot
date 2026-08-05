import { Logger } from '@nestjs/common';
import type { SendSmsRequest, SendSmsResult, SmsProvider } from './sms-provider.interface';

/**
 * Development provider: prints the message and reports success. Lets the whole
 * reminder flow be exercised without spending money or needing a gateway
 * account on day one.
 */
export class LogSmsProvider implements SmsProvider {
  readonly name = 'log';
  private readonly logger = new Logger('SMS');

  async send(request: SendSmsRequest): Promise<SendSmsResult> {
    this.logger.log(`[${request.senderId} → ${request.to}] ${request.body}`);
    return { providerRef: `log-${Date.now()}`, cost: 0n };
  }
}
