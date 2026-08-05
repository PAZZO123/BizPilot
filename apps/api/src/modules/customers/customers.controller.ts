import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { BusinessId, Roles } from '../../common/decorators';
import { CustomersService } from './customers.service';
import {
  CreateCustomerDto,
  QueryCustomersDto,
  UpdateCustomerDto,
} from './dto/customer.dto';

@ApiTags('customers')
@ApiBearerAuth()
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Post()
  @ApiOperation({ summary: 'Add a customer' })
  create(@BusinessId() businessId: string, @Body() dto: CreateCustomerDto) {
    return this.customers.create(businessId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List customers' })
  findAll(@BusinessId() businessId: string, @Query() query: QueryCustomersDto) {
    return this.customers.findAll(businessId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one customer' })
  findOne(@BusinessId() businessId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.customers.findOne(businessId, id);
  }

  @Get(':id/statement')
  @ApiOperation({ summary: 'Sales, invoices and payments for a customer' })
  statement(@BusinessId() businessId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.customers.statement(businessId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a customer' })
  update(
    @BusinessId() businessId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customers.update(businessId, id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.MANAGER)
  @ApiOperation({ summary: 'Archive a customer' })
  remove(@BusinessId() businessId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.customers.remove(businessId, id);
  }
}
