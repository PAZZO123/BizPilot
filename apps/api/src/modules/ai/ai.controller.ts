import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { BusinessId, CurrentUser } from '../../common/decorators';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { AiService } from './ai.service';
import { AskDto } from './dto/ai.dto';

@ApiTags('assistant')
@ApiBearerAuth()
@Controller('assistant')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Post('ask')
  // Each question costs real money. The plan quota is the real limit; this stops
  // a stuck client from burning a month's allowance in a loop.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Ask the assistant a question about the business' })
  ask(
    @BusinessId() businessId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: AskDto,
  ) {
    return this.ai.ask(businessId, userId, dto);
  }

  @Get('status')
  @ApiOperation({ summary: 'Whether the assistant is configured, plus starter questions' })
  status() {
    return {
      enabled: this.ai.isConfigured,
      suggestions: this.ai.suggestions(),
    };
  }

  @Get('conversations')
  @ApiOperation({ summary: 'List past conversations' })
  list(@BusinessId() businessId: string, @Query() pagination: PaginationDto) {
    return this.ai.listConversations(businessId, pagination);
  }

  @Get('conversations/:id')
  @ApiOperation({ summary: 'Get one conversation with its messages' })
  get(@BusinessId() businessId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.ai.getConversation(businessId, id);
  }

  @Delete('conversations/:id')
  @ApiOperation({ summary: 'Delete a conversation' })
  remove(@BusinessId() businessId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.ai.deleteConversation(businessId, id);
  }
}
