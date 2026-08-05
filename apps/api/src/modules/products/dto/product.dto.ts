import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { StockMovementType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

/**
 * Every money field on the wire is an integer in minor units (RWF x100).
 * Nothing fractional ever crosses the API boundary, so no float rounding can
 * creep into a shopkeeper's till.
 */
export class CreateProductDto {
  @ApiProperty({ example: 'Inyange Milk 1L' })
  @IsString()
  @Length(1, 160)
  name!: string;

  @ApiPropertyOptional({ example: 'MILK-1L' })
  @IsOptional()
  @IsString()
  @Length(1, 60)
  sku?: string;

  @ApiPropertyOptional({ example: '6009510800012' })
  @IsOptional()
  @IsString()
  @Length(1, 60)
  barcode?: string;

  @ApiPropertyOptional({ example: 'Drinks' })
  @IsOptional()
  @IsString()
  @Length(1, 60)
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  description?: string;

  @ApiPropertyOptional({ example: 'piece', default: 'piece' })
  @IsOptional()
  @IsString()
  @Length(1, 20)
  unit?: string;

  @ApiProperty({ example: 80000, description: 'Cost per unit in minor units (800 RWF)' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  costPrice!: number;

  @ApiProperty({ example: 100000, description: 'Selling price per unit in minor units' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sellPrice!: number;

  @ApiPropertyOptional({ example: 24, description: 'Opening stock' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stockQty?: number;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  reorderLevel?: number;

  @ApiPropertyOptional({ default: true, description: 'False for services with no stock' })
  @IsOptional()
  @IsBoolean()
  trackStock?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  imageUrl?: string;
}

export class UpdateProductDto extends PartialType(CreateProductDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class QueryProductsDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'Only products at or below their reorder level' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  lowStockOnly?: boolean;

  @ApiPropertyOptional({ description: 'Include archived products' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeInactive?: boolean;
}

export class AdjustStockDto {
  @ApiProperty({
    enum: StockMovementType,
    description: 'PURCHASE adds stock, DAMAGE removes it, ADJUSTMENT sets a correction.',
  })
  @IsEnum(StockMovementType)
  type!: StockMovementType;

  @ApiProperty({
    example: 12,
    description: 'Signed change. Positive adds, negative removes.',
  })
  @Type(() => Number)
  @IsInt()
  quantity!: number;

  @ApiPropertyOptional({ description: 'Unit cost in minor units, for PURCHASE movements' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  unitCost?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 240)
  note?: string;

  @ApiPropertyOptional({ description: 'Supplier invoice or delivery note reference' })
  @IsOptional()
  @IsString()
  reference?: string;
}
