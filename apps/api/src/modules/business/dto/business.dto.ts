import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { BusinessType, UserRole } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

export class UpdateBusinessDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @ApiPropertyOptional({ enum: BusinessType })
  @IsOptional()
  @IsEnum(BusinessType)
  type?: BusinessType;

  @ApiPropertyOptional({ example: 'RWF' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @ApiPropertyOptional({ example: 'Africa/Kigali' })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 20)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 240)
  address?: string;

  @ApiPropertyOptional({ description: 'Public URL of the logo shown on invoices' })
  @IsOptional()
  @IsString()
  logoUrl?: string;

  @ApiPropertyOptional({ description: 'Tax identification number printed on invoices' })
  @IsOptional()
  @IsString()
  @Length(0, 40)
  taxId?: string;

  @ApiPropertyOptional({ description: 'Default tax rate in basis points (1800 = 18%)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  defaultTaxBps?: number;

  @ApiPropertyOptional({ example: 'INV' })
  @IsOptional()
  @IsString()
  @Length(1, 8)
  invoicePrefix?: string;

  @ApiPropertyOptional({ example: 'RCP' })
  @IsOptional()
  @IsString()
  @Length(1, 8)
  receiptPrefix?: string;
}

export class CreateLocationDto {
  @ApiPropertyOptional()
  @IsString()
  @Length(1, 80)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 240)
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 20)
  phone?: string;
}

export class UpdateLocationDto extends PartialType(CreateLocationDto) {}

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 80)
  name?: string;

  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;
}
