import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { PaymentMethod } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
} from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

/** Suggested in the UI, but the field is free text so shops can use their own. */
export const COMMON_EXPENSE_CATEGORIES = [
  'Stock purchase',
  'Rent',
  'Salaries',
  'Transport',
  'Electricity',
  'Water',
  'Airtime & internet',
  'Licences & taxes',
  'Repairs',
  'Marketing',
  'Other',
] as const;

export class CreateExpenseDto {
  @ApiProperty({ example: 'Rent' })
  @IsString()
  @Length(1, 60)
  category!: string;

  @ApiProperty({ example: 15000000, description: 'Amount in minor units (150,000 RWF)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amount!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 500)
  note?: string;

  @ApiPropertyOptional({ example: 'Landlord' })
  @IsOptional()
  @IsString()
  @Length(0, 120)
  vendor?: string;

  @ApiPropertyOptional({ enum: PaymentMethod, default: PaymentMethod.CASH })
  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  spentAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  receiptUrl?: string;
}

export class UpdateExpenseDto extends PartialType(CreateExpenseDto) {}

export class QueryExpensesDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;
}
