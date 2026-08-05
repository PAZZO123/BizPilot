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
import { BusinessId, CurrentUser, Roles } from '../../common/decorators';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { ProductsService } from './products.service';
import {
  AdjustStockDto,
  CreateProductDto,
  QueryProductsDto,
  UpdateProductDto,
} from './dto/product.dto';

@ApiTags('products')
@ApiBearerAuth()
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Post()
  @Roles(UserRole.MANAGER)
  @ApiOperation({ summary: 'Add a product to the catalogue' })
  create(
    @BusinessId() businessId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateProductDto,
  ) {
    return this.products.create(businessId, userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List products' })
  findAll(@BusinessId() businessId: string, @Query() query: QueryProductsDto) {
    return this.products.findAll(businessId, query);
  }

  @Get('categories')
  @ApiOperation({ summary: 'Distinct categories in use' })
  categories(@BusinessId() businessId: string) {
    return this.products.categories(businessId);
  }

  @Get('low-stock')
  @ApiOperation({ summary: 'Products at or below their reorder level' })
  lowStock(@BusinessId() businessId: string) {
    return this.products.lowStock(businessId);
  }

  @Get('inventory-value')
  @Roles(UserRole.MANAGER)
  @ApiOperation({ summary: 'Value of stock on hand, at cost and at retail' })
  inventoryValue(@BusinessId() businessId: string) {
    return this.products.inventoryValue(businessId);
  }

  @Get('barcode/:barcode')
  @ApiOperation({ summary: 'Look up a product by barcode, for the till' })
  findByBarcode(@BusinessId() businessId: string, @Param('barcode') barcode: string) {
    return this.products.findByBarcode(businessId, barcode);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one product' })
  findOne(@BusinessId() businessId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.products.findOne(businessId, id);
  }

  @Get(':id/movements')
  @ApiOperation({ summary: 'Stock movement history for a product' })
  movements(
    @BusinessId() businessId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() pagination: PaginationDto,
  ) {
    return this.products.stockMovements(businessId, id, pagination);
  }

  @Patch(':id')
  @Roles(UserRole.MANAGER)
  @ApiOperation({ summary: 'Update a product' })
  update(
    @BusinessId() businessId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.products.update(businessId, id, dto);
  }

  @Post(':id/stock')
  @Roles(UserRole.MANAGER)
  @ApiOperation({ summary: 'Record a stock movement (restock, damage, correction)' })
  adjustStock(
    @BusinessId() businessId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdjustStockDto,
  ) {
    return this.products.adjustStock(businessId, userId, id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.MANAGER)
  @ApiOperation({ summary: 'Archive a product' })
  remove(@BusinessId() businessId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.products.remove(businessId, id);
  }
}
