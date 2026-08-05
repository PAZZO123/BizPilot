import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { BusinessId, Roles } from '../../common/decorators';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { SmsService } from './sms.service';

export class SendSmsDto {
  @ApiProperty({ example: '+250788123456' })
  @IsString()
  @Length(6, 20)
  to!: string;

  @ApiProperty({ example: 'Your order is ready for collection.' })
  @IsString()
  @Length(1, 480)
  body!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  customerId?: string;
}

@ApiTags('sms')
@ApiBearerAuth()
@Controller('sms')
export class SmsController {
  constructor(private readonly sms: SmsService) {}

  @Post()
  @Roles(UserRole.MANAGER)
  @ApiOperation({ summary: 'Queue an SMS to a customer' })
  send(@BusinessId() businessId: string, @Body() dto: SendSmsDto) {
    return this.sms.queueMessage({
      businessId,
      to: dto.to,
      body: dto.body,
      customerId: dto.customerId,
      kind: 'manual',
    });
  }

  @Get()
  @ApiOperation({ summary: 'Message history and delivery status' })
  findAll(@BusinessId() businessId: string, @Query() pagination: PaginationDto) {
    return this.sms.findAll(businessId, pagination);
  }
}
