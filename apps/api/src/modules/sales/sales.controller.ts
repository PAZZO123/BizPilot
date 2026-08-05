import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { BusinessId, CurrentUser, Roles } from '../../common/decorators';
import { SalesService } from './sales.service';
import {
  CreateSaleDto,
  QuerySalesDto,
  RecordSalePaymentDto,
  VoidSaleDto,
} from './dto/sale.dto';

@ApiTags('sales')
@ApiBearerAuth()
@Controller('sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Post()
  @ApiOperation({ summary: 'Record a sale and move the stock' })
  create(
    @BusinessId() businessId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateSaleDto,
  ) {
    return this.sales.create(businessId, userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List sales' })
  findAll(@BusinessId() businessId: string, @Query() query: QuerySalesDto) {
    return this.sales.findAll(businessId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one sale with its lines and payments' })
  findOne(@BusinessId() businessId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.sales.findOne(businessId, id);
  }

  @Post(':id/payments')
  @ApiOperation({ summary: 'Record a payment against a credit sale' })
  recordPayment(
    @BusinessId() businessId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordSalePaymentDto,
  ) {
    return this.sales.recordPayment(businessId, id, dto);
  }

  @Post(':id/void')
  @Roles(UserRole.MANAGER)
  @ApiOperation({ summary: 'Cancel a sale and return the stock' })
  voidSale(
    @BusinessId() businessId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoidSaleDto,
  ) {
    return this.sales.voidSale(businessId, userId, id, dto);
  }
}
