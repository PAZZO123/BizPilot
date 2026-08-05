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
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { BusinessId, CurrentUser, Roles } from '../../common/decorators';
import { ExpensesService } from './expenses.service';
import {
  CreateExpenseDto,
  QueryExpensesDto,
  UpdateExpenseDto,
} from './dto/expense.dto';

@ApiTags('expenses')
@ApiBearerAuth()
@Controller('expenses')
// Cashiers ring up sales; what the business spends is not their business.
@Roles(UserRole.MANAGER)
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Post()
  @ApiOperation({ summary: 'Record an expense' })
  create(
    @BusinessId() businessId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateExpenseDto,
  ) {
    return this.expenses.create(businessId, userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List expenses with a running total' })
  findAll(@BusinessId() businessId: string, @Query() query: QueryExpensesDto) {
    return this.expenses.findAll(businessId, query);
  }

  @Get('categories')
  @ApiOperation({ summary: 'Categories in use, plus suggestions' })
  categories(@BusinessId() businessId: string) {
    return this.expenses.categories(businessId);
  }

  @Get('by-category')
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiOperation({ summary: 'Spend grouped by category' })
  byCategory(
    @BusinessId() businessId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.expenses.byCategory(businessId, from, to);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one expense' })
  findOne(@BusinessId() businessId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.expenses.findOne(businessId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an expense' })
  update(
    @BusinessId() businessId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExpenseDto,
  ) {
    return this.expenses.update(businessId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an expense' })
  remove(@BusinessId() businessId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.expenses.remove(businessId, id);
  }
}
