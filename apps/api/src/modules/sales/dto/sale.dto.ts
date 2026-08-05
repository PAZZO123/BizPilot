import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod, SaleStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';
import { DateRangeDto, PaginationDto } from '../../../common/dto/pagination.dto';

export class SaleItemDto {
  @ApiPropertyOptional({ description: 'Omit for an ad-hoc line not in the catalogue' })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({ description: 'Required when productId is omitted' })
  @IsOptional()
  @IsString()
  @Length(1, 160)
  name?: string;

  @ApiProperty({ example: 2 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiPropertyOptional({
    description: "Overrides the product's price, in minor units — for haggling.",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  unitPrice?: number;

  @ApiPropertyOptional({ description: 'Discount on this line, in minor units' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  discount?: number;
}

export class CreateSaleDto {
  @ApiProperty({ type: [SaleItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SaleItemDto)
  items!: SaleItemDto[];

  @ApiPropertyOptional({ description: 'Required when the sale is not paid in full' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({ description: 'Discount on the whole sale, in minor units' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  discount?: number;

  @ApiPropertyOptional({
    description: "Tax rate in basis points (1800 = 18%). Defaults to the business's rate.",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  taxBps?: number;

  @ApiPropertyOptional({ enum: PaymentMethod, default: PaymentMethod.CASH })
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @ApiPropertyOptional({
    description: 'Amount handed over, in minor units. Defaults to the full total.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  amountPaid?: number;

  @ApiPropertyOptional({ description: 'Backdate a sale that was written in the notebook' })
  @IsOptional()
  @IsDateString()
  soldAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 500)
  note?: string;
}

export class QuerySalesDto extends PaginationDto {
  @ApiPropertyOptional({ enum: SaleStatus })
  @IsOptional()
  @IsEnum(SaleStatus)
  status?: SaleStatus;

  @ApiPropertyOptional({ enum: PaymentMethod })
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ description: 'Only sales that are not fully paid' })
  @IsOptional()
  @Type(() => Boolean)
  unpaidOnly?: boolean;
}

export class RecordSalePaymentDto {
  @ApiProperty({ description: 'Amount received, in minor units' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amount!: number;

  @ApiPropertyOptional({ enum: PaymentMethod, default: PaymentMethod.CASH })
  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reference?: string;
}

export class VoidSaleDto {
  @ApiProperty({ example: 'Customer returned everything' })
  @IsString()
  @Length(3, 240)
  reason!: string;
}

export class SalesRangeDto extends DateRangeDto {}
