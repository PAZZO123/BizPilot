import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { BusinessId, Public, Roles } from '../../common/decorators';
import { InvoicesService } from './invoices.service';
import { InvoicePdfService } from './invoice-pdf.service';
import {
  CreateInvoiceDto,
  InvoiceFromSaleDto,
  QueryInvoicesDto,
  RecordInvoicePaymentDto,
  SendInvoiceDto,
} from './dto/invoice.dto';

@ApiTags('invoices')
@ApiBearerAuth()
@Controller('invoices')
export class InvoicesController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly pdf: InvoicePdfService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create an invoice' })
  create(@BusinessId() businessId: string, @Body() dto: CreateInvoiceDto) {
    return this.invoices.create(businessId, dto);
  }

  @Post('from-sale')
  @ApiOperation({ summary: 'Raise an invoice from an existing sale' })
  createFromSale(@BusinessId() businessId: string, @Body() dto: InvoiceFromSaleDto) {
    return this.invoices.createFromSale(businessId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List invoices with the outstanding total' })
  findAll(@BusinessId() businessId: string, @Query() query: QueryInvoicesDto) {
    return this.invoices.findAll(businessId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one invoice' })
  findOne(@BusinessId() businessId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.findOne(businessId, id);
  }

  @Get(':id/pdf')
  @ApiOperation({ summary: 'Download the invoice as a PDF' })
  async downloadPdf(
    @BusinessId() businessId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.pdf.render(businessId, id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Content-Length': buffer.length.toString(),
    });
    res.end(buffer);
  }

  @Post(':id/payments')
  @ApiOperation({ summary: 'Record a payment against an invoice' })
  recordPayment(
    @BusinessId() businessId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordInvoicePaymentDto,
  ) {
    return this.invoices.recordPayment(businessId, id, dto);
  }

  @Post(':id/send')
  @ApiOperation({ summary: 'Text the customer a link to pay' })
  send(
    @BusinessId() businessId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendInvoiceDto,
  ) {
    return this.invoices.send(businessId, id, dto);
  }

  @Post(':id/rotate-link')
  @Roles(UserRole.MANAGER)
  @ApiOperation({ summary: 'Invalidate the shared link and issue a new one' })
  rotateLink(@BusinessId() businessId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.rotatePublicToken(businessId, id);
  }

  @Post(':id/cancel')
  @Roles(UserRole.MANAGER)
  @ApiOperation({ summary: 'Cancel an unpaid invoice' })
  cancel(@BusinessId() businessId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.cancel(businessId, id);
  }
}

@ApiTags('public')
@Controller('public/invoices')
export class PublicInvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  /**
   * Reached from the SMS link. The token is the only credential — it is a
   * random UUID, unguessable, and the owner can rotate it if it leaks.
   */
  @Public()
  @Get(':token')
  @ApiOperation({ summary: 'View an invoice by its public link' })
  view(@Param('token', ParseUUIDPipe) token: string) {
    return this.invoices.findByPublicToken(token);
  }
}
