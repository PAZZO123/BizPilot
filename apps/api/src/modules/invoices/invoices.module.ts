import { Module } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { InvoicesController, PublicInvoicesController } from './invoices.controller';
import { SmsModule } from '../sms/sms.module';

@Module({
  imports: [SmsModule],
  providers: [InvoicesService, InvoicePdfService],
  controllers: [InvoicesController, PublicInvoicesController],
  exports: [InvoicesService],
})
export class InvoicesModule {}
