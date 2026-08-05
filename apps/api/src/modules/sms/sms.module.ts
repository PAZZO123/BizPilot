import { Logger, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { SmsService, SMS_QUEUE } from './sms.service';
import { SmsProcessor } from './sms.processor';
import { SmsController } from './sms.controller';
import { SMS_PROVIDER } from './sms.tokens';
import { LogSmsProvider } from './providers/log.provider';
import { AfricasTalkingProvider } from './providers/africastalking.provider';
import { TwilioProvider } from './providers/twilio.provider';
import type { SmsProvider } from './providers/sms-provider.interface';

const smsProviderFactory = {
  provide: SMS_PROVIDER,
  inject: [ConfigService],
  useFactory: (config: ConfigService): SmsProvider => {
    const logger = new Logger('SmsProvider');
    const choice = config.get<string>('SMS_PROVIDER', 'log');

    switch (choice) {
      case 'africastalking': {
        const username = config.get<string>('AFRICASTALKING_USERNAME', '');
        const apiKey = config.get<string>('AFRICASTALKING_API_KEY', '');
        if (!username || !apiKey) {
          // Falling back beats crashing the whole API over a messaging
          // credential, and the log makes the misconfiguration obvious.
          logger.warn(
            "SMS_PROVIDER=africastalking but credentials are missing; using the log provider.",
          );
          return new LogSmsProvider();
        }
        return new AfricasTalkingProvider(username, apiKey);
      }
      case 'twilio': {
        const sid = config.get<string>('TWILIO_ACCOUNT_SID', '');
        const token = config.get<string>('TWILIO_AUTH_TOKEN', '');
        const from = config.get<string>('TWILIO_FROM_NUMBER', '');
        if (!sid || !token || !from) {
          logger.warn('SMS_PROVIDER=twilio but credentials are missing; using the log provider.');
          return new LogSmsProvider();
        }
        return new TwilioProvider(sid, token, from);
      }
      default:
        return new LogSmsProvider();
    }
  },
};

@Module({
  imports: [BullModule.registerQueue({ name: SMS_QUEUE })],
  providers: [SmsService, SmsProcessor, smsProviderFactory],
  controllers: [SmsController],
  exports: [SmsService],
})
export class SmsModule {}
