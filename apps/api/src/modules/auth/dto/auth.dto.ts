import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BusinessType, UserRole } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'Alice Uwase' })
  @IsString()
  @Length(2, 80)
  name!: string;

  @ApiProperty({ example: 'alice@shop.rw' })
  @IsEmail()
  email!: string;

  @ApiProperty({ minLength: 8, description: 'At least 8 characters, with a letter and a number.' })
  @IsString()
  @MinLength(8)
  @Matches(/[A-Za-z]/, { message: 'Password must contain a letter' })
  @Matches(/[0-9]/, { message: 'Password must contain a number' })
  password!: string;

  @ApiProperty({ example: 'Uwase Mini Market' })
  @IsString()
  @Length(2, 120)
  businessName!: string;

  @ApiPropertyOptional({ enum: BusinessType, default: BusinessType.SHOP })
  @IsOptional()
  @IsEnum(BusinessType)
  businessType?: BusinessType;

  @ApiPropertyOptional({ example: '+250788123456' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 'RWF', default: 'RWF' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @ApiPropertyOptional({ example: 'RW', default: 'RW' })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  country?: string;
}

export class LoginDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  password!: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  refreshToken!: string;
}

export class InviteUserDto {
  @ApiProperty()
  @IsString()
  @Length(2, 80)
  name!: string;

  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty({ enum: UserRole, default: UserRole.CASHIER })
  @IsEnum(UserRole)
  role!: UserRole;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  currentPassword!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  @Matches(/[A-Za-z]/, { message: 'Password must contain a letter' })
  @Matches(/[0-9]/, { message: 'Password must contain a number' })
  newPassword!: string;
}
