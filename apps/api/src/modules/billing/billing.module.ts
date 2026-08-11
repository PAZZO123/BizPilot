import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BillingService } from './billing.service';
import { FlutterwaveService } from './flutterwave.service';
import { FlutterwaveProvider } from './flutterwave.provider';
import { MtnMomoService } from './mtn-momo.service';
import { PAYMENT_PROVIDER, type PaymentProvider } from './payment-provider';
import { BillingController, PaymentsWebhookController } from './billing.controller';

/**
 * One provider is active at a time, chosen by `PAYMENT_PROVIDER`.
 *
 * Both are constructed either way — they are cheap, and constructing only the
 * chosen one would mean the webhook route for the other could not exist, which
 * matters during a switch when payments started under the old provider are
 * still settling.
 */
@Module({
  providers: [
    BillingService,
    FlutterwaveService,
    FlutterwaveProvider,
    MtnMomoService,
    {
      provide: PAYMENT_PROVIDER,
      inject: [ConfigService, FlutterwaveProvider, MtnMomoService],
      useFactory: (
        config: ConfigService,
        flutterwave: FlutterwaveProvider,
        momo: MtnMomoService,
      ): PaymentProvider => {
        const choice = config.get<string>('PAYMENT_PROVIDER', 'flutterwave');
        const provider = choice === 'mtn-momo' ? momo : flutterwave;

        const logger = new Logger('BillingModule');
        if (provider.isConfigured) {
          logger.log(`Payments: ${provider.name} (${provider.channels.join(', ')})`);
        } else {
          // Not fatal. Everything except taking money works without it, and the
          // billing screen says so rather than failing at the moment of payment.
          logger.warn(`Payments: ${provider.name} selected but not configured — checkout is off.`);
        }
        return provider;
      },
    },
  ],
  controllers: [BillingController, PaymentsWebhookController],
  exports: [BillingService, FlutterwaveService, PAYMENT_PROVIDER],
})
export class BillingModule {}
