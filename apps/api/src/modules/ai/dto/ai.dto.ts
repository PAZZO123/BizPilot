import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class AskDto {
  @ApiProperty({ example: 'How much profit did I make this month?' })
  @IsString()
  @Length(1, 2000)
  message!: string;

  @ApiPropertyOptional({ description: 'Continue an existing conversation' })
  @IsOptional()
  @IsUUID()
  conversationId?: string;
}
