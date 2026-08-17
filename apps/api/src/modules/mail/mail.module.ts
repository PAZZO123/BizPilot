import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MAIL_PROVIDER } from './mail.tokens';
import { LogMailProvider } from './log.provider';
import { ResendMailProvider } from './resend.provider';
import type { MailProvider } from './mail-provider.interface';

const mailProviderFactory = {
  provide: MAIL_PROVIDER,
  inject: [ConfigService],
  useFactory: (config: ConfigService): MailProvider => {
    const logger = new Logger('MailProvider');
    const choice = config.get<string>('MAIL_PROVIDER', 'log');

    switch (choice) {
      case 'resend': {
        const apiKey = config.get<string>('RESEND_API_KEY', '');
        const from = config.get<string>('MAIL_FROM', '');
        if (!apiKey || !from) {
          // Same rule as SMS: falling back beats crashing the whole API over
          // a mail credential, and the log makes the misconfiguration obvious.
          logger.warn('MAIL_PROVIDER=resend but RESEND_API_KEY or MAIL_FROM is missing; using the log provider.');
          return new LogMailProvider();
        }
        return new ResendMailProvider(apiKey, from);
      }
      default:
        return new LogMailProvider();
    }
  },
};

@Module({
  providers: [mailProviderFactory],
  exports: [MAIL_PROVIDER],
})
export class MailModule {}
