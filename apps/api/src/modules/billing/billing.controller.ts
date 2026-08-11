import {
  Inject,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { IsEmail, IsIn, IsOptional, IsString, Length } from 'class-validator';
import { PLAN_ORDER, type PlanId } from '@bizpilot/shared';
import { BusinessId, CurrentUser, Public, Roles } from '../../common/decorators';
import { BillingService } from './billing.service';
import { PAYMENT_PROVIDER, type PaymentProvider } from './payment-provider';
import { FlutterwaveService } from './flutterwave.service';

export class StartCheckoutDto {
  @ApiProperty({ enum: PLAN_ORDER, example: 'starter' })
  @IsIn(PLAN_ORDER)
  plan!: PlanId;
}

export class PayInvoiceDto {
  @ApiProperty({ description: 'Where the receipt goes' })
  @IsEmail()
  email!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(6, 20)
  phone?: string;
}

@ApiTags('billing')
@ApiBearerAuth()
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  @ApiOperation({ summary: 'Plan, usage, subscription and payment history' })
  overview(@BusinessId() businessId: string) {
    return this.billing.overview(businessId);
  }

  @Post('checkout')
  @Roles(UserRole.OWNER)
  @ApiOperation({ summary: 'Start an upgrade and get a checkout link' })
  checkout(
    @BusinessId() businessId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: StartCheckoutDto,
  ) {
    return this.billing.startSubscriptionCheckout(businessId, userId, dto.plan);
  }

  @Post('cancel')
  @Roles(UserRole.OWNER)
  @ApiOperation({ summary: 'Cancel at the end of the paid period' })
  cancel(@BusinessId() businessId: string) {
    return this.billing.cancelSubscription(businessId);
  }

  @Post('resume')
  @Roles(UserRole.OWNER)
  @ApiOperation({ summary: 'Undo a scheduled cancellation' })
  resume(@BusinessId() businessId: string) {
    return this.billing.resumeSubscription(businessId);
  }

  /**
   * Called by the page the payer lands on after checkout. It confirms with
   * Flutterwave immediately rather than waiting for the webhook, so the owner
   * sees their new plan straight away. Idempotent — the webhook doing the same
   * work a second later changes nothing.
   */
  @Public()
  @Get('confirm')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Confirm a payment after the checkout redirect' })
  confirm(@Query('transaction_id') transactionId: string) {
    return this.billing.settleTransaction(transactionId);
  }
}

@ApiTags('public')
@Controller()
export class PaymentsWebhookController {
  private readonly logger = new Logger(PaymentsWebhookController.name);

  constructor(
    private readonly billing: BillingService,
    private readonly flutterwave: FlutterwaveService,
    @Inject(PAYMENT_PROVIDER) private readonly payments: PaymentProvider,
  ) {}

  /**
   * Flutterwave calls this on every transaction. It is unauthenticated by
   * definition, so the shared secret in `verif-hash` is the only thing standing
   * between the internet and a free subscription — reject first, ask later.
   */
  @Public()
  @Post('webhooks/flutterwave')
  @HttpCode(HttpStatus.OK)
  // Webhooks come from one source and can retry in bursts; the global throttle
  // is too tight for that.
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @ApiOperation({ summary: 'Flutterwave payment webhook' })
  async handleWebhook(
    @Headers('verif-hash') signature: string | undefined,
    @Body() payload: Record<string, unknown>,
  ) {
    if (!this.flutterwave.verifyWebhookSignature(signature)) {
      this.logger.warn('Rejected a Flutterwave webhook with a bad or missing verif-hash header.');
      throw new ForbiddenException('Invalid signature.');
    }

    const data = payload.data as { id?: number | string } | undefined;
    const transactionId = data?.id;
    if (!transactionId) {
      // Acknowledge anyway: a 4xx makes Flutterwave retry a payload we will
      // never be able to process.
      this.logger.warn('Flutterwave webhook had no transaction id; ignoring.');
      return { received: true };
    }

    // The body is treated purely as a notification — every figure that matters
    // comes from verifying the transaction against Flutterwave directly.
    const result = await this.billing.settleTransaction(transactionId);
    return { received: true, ...result };
  }

  /**
   * MTN's callback for a Request to Pay.
   *
   * The secret is in the path because MTN does not sign callbacks — there is no
   * header to check. That raises the bar but is not the real defence: as with
   * Flutterwave, nothing here is trusted. The body is a nudge to go and ask MTN
   * what happened, and only MTN's answer is acted on.
   */
  @Public()
  @Post('webhooks/momo/:secret')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @ApiOperation({ summary: 'MTN MoMo payment callback' })
  async handleMomoCallback(
    @Param('secret') secret: string,
    @Body() payload: Record<string, unknown>,
  ) {
    if (!this.payments.verifyWebhookSignature(secret)) {
      this.logger.warn('Rejected a MoMo callback with a bad or missing secret.');
      throw new ForbiddenException('Invalid signature.');
    }

    const reference = this.payments.extractTransactionId(payload);
    if (!reference) {
      this.logger.warn('MoMo callback had no reference; ignoring.');
      return { received: true };
    }

    const result = await this.billing.settleTransaction(reference);
    return { received: true, ...result };
  }

  /**
   * Polled by the payer's browser while a phone prompt is outstanding.
   *
   * A push payment has no redirect to come back on, so the screen asks here
   * until the answer stops being "pending". Public, because the payer of an
   * invoice has no account — the reference is an unguessable UUID and this
   * settles idempotently, so asking about someone else's payment requires
   * already knowing its id, and tells you nothing but a status word.
   */
  @Public()
  @Get('payments/:reference/status')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'Check whether a pushed payment has been approved' })
  async paymentStatus(@Param('reference') reference: string) {
    const result = await this.billing.settleTransaction(reference);
    // `settled` is true once the money is confirmed and credited; anything else
    // means keep waiting or give up. Spread first so the explicit boolean wins.
    return { ...result, settled: result.settled === true };
  }

  @Public()
  @Post('public/invoices/:token/pay')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Start an online payment for an invoice' })
  payInvoice(@Param('token') token: string, @Body() dto: PayInvoiceDto) {
    return this.billing.startInvoiceCheckout(token, dto);
  }
}
