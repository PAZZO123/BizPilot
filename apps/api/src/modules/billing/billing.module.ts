import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { FlutterwaveService } from './flutterwave.service';
import { BillingController, PaymentsWebhookController } from './billing.controller';

@Module({
  providers: [BillingService, FlutterwaveService],
  controllers: [BillingController, PaymentsWebhookController],
  exports: [BillingService, FlutterwaveService],
})
export class BillingModule {}
