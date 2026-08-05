import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsOptional, IsString, Length } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class CreateCustomerDto {
  @ApiProperty({ example: 'Jean Baptiste' })
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiPropertyOptional({ example: '+250788123456' })
  @IsOptional()
  @IsString()
  @Length(6, 20)
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 500)
  note?: string;
}

export class UpdateCustomerDto extends PartialType(CreateCustomerDto) {}

export class QueryCustomersDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Only customers who currently owe money' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  owingOnly?: boolean;
}
