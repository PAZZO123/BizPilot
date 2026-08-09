import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { paginated, type PaginationDto } from '../../common/dto/pagination.dto';
import { AiToolsService } from './ai-tools.service';
import type { AskDto } from './dto/ai.dto';

/** How many previous turns to replay. Enough for follow-ups, bounded for cost. */
const HISTORY_TURNS = 12;

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly client: Anthropic | null;
  private readonly model: string;
  private readonly effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly entitlements: EntitlementsService,
    private readonly tools: AiToolsService,
  ) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY', '');
    // No key is a valid configuration — the rest of BizPilot works without AI,
    // and `ask` returns a clear message instead of a 500.
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
    this.model = this.config.get<string>('ANTHROPIC_MODEL', 'claude-opus-5');
    this.effort = this.config.get<'low'>('ANTHROPIC_EFFORT', 'low');
  }

  get isConfigured(): boolean {
    return this.client !== null;
  }

  async ask(businessId: string, userId: string, dto: AskDto) {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'The AI assistant is not switched on yet. Add an Anthropic API key to enable it.',
      );
    }

    await this.entitlements.assertWithinMonthlyLimit(businessId, 'ai_messages');

    const conversation = dto.conversationId
      ? await this.loadConversation(businessId, dto.conversationId)
      : await this.prisma.aiConversation.create({
          data: {
            businessId,
            userId,
            // The first question makes a better title than "New conversation".
            title: dto.message.slice(0, 60),
          },
        });

    const history = await this.prisma.aiMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_TURNS,
      select: { role: true, content: true },
    });

    const messages: Anthropic.Beta.BetaMessageParam[] = [
      ...history.reverse().map((entry) => ({
        role: entry.role as 'user' | 'assistant',
        content: entry.content,
      })),
      { role: 'user' as const, content: dto.message },
    ];

    await this.prisma.aiMessage.create({
      data: { conversationId: conversation.id, role: 'user', content: dto.message },
    });

    const tools = await this.tools.buildTools(businessId);
    const system = await this.buildSystemPrompt(businessId);

    const toolsUsed = new Set<string>();
    let inputTokens = 0;
    let outputTokens = 0;
    let answer = '';

    try {
      const runner = this.client.beta.messages.toolRunner({
        model: this.model,
        max_tokens: 16000,
        system,
        tools,
        messages,
        // The assistant reads small, already-summarised tool results and answers
        // in plain language; deep reasoning is not what makes it good, and every
        // thinking token is billed to a shop paying a few dollars a month.
        output_config: { effort: this.effort },
        // Cap the loop: a well-formed question needs two or three tool calls,
        // and a runaway loop is a bill nobody authorised.
        max_iterations: 8,
      });

      for await (const message of runner) {
        inputTokens += message.usage?.input_tokens ?? 0;
        outputTokens += message.usage?.output_tokens ?? 0;

        for (const block of message.content) {
          if (block.type === 'tool_use') toolsUsed.add(block.name);
          if (block.type === 'text') answer = block.text;
        }

        if (message.stop_reason === 'refusal') {
          throw new BadRequestException(
            'The assistant could not answer that question. Try rephrasing it.',
          );
        }
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error(`AI request failed: ${(error as Error).message}`);
      throw new ServiceUnavailableException(describeFailure(error));
    }

    if (!answer.trim()) {
      answer = 'I could not find an answer to that in your records.';
    }

    const saved = await this.prisma.aiMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'assistant',
        content: answer,
        toolsUsed: [...toolsUsed],
        inputTokens,
        outputTokens,
      },
    });

    await this.prisma.aiConversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date() },
    });

    // Charged after success, so a failed request does not eat the shop's quota.
    await this.entitlements.consume(businessId, 'ai_messages');

    return {
      conversationId: conversation.id,
      message: saved,
      toolsUsed: [...toolsUsed],
    };
  }

  /**
   * Grounds the model in this specific business: its name, currency and today's
   * date. Without the date it cannot resolve "last month"; without the currency
   * it guesses dollars.
   */
  private async buildSystemPrompt(businessId: string): Promise<string> {
    const business = await this.prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { name: true, type: true, currency: true, country: true, timezone: true },
    });

    const today = new Date().toLocaleDateString('en-CA', { timeZone: business.timezone });

    return [
      `You are the business assistant inside BizPilot, helping the owner of "${business.name}",`,
      `a ${business.type.toLowerCase()} business in ${business.country}. Today is ${today}.`,
      `All money is in ${business.currency}.`,
      '',
      'You are talking to a shop owner, not an accountant. Answer in plain language, in the',
      'language they wrote to you in — many will write in Kinyarwanda or a mix of Kinyarwanda',
      'and English, and you should reply in kind.',
      '',
      'Use the tools to look at their real records before answering anything factual. Never',
      'invent a number: if a tool returns nothing, say so plainly. Quote figures exactly as the',
      'tools give them, including the currency.',
      '',
      'Lead with the answer, then one or two sentences of useful context. When you spot',
      'something that costs them money — stock about to run out, a customer who has owed for',
      'weeks, a product selling below cost, expenses climbing faster than sales — say so and',
      'suggest one concrete next step. Keep it short: a few sentences, not a report. Do not use',
      'markdown tables or headings; this is read on a phone.',
    ].join('\n');
  }

  private async loadConversation(businessId: string, id: string) {
    const conversation = await this.prisma.aiConversation.findFirst({
      where: { id, businessId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found.');
    return conversation;
  }

  async listConversations(businessId: string, pagination: PaginationDto) {
    const where = { businessId };
    const [items, total] = await Promise.all([
      this.prisma.aiConversation.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: pagination.skip,
        take: pagination.pageSize,
        include: {
          user: { select: { id: true, name: true } },
          _count: { select: { messages: true } },
        },
      }),
      this.prisma.aiConversation.count({ where }),
    ]);
    return paginated(items, total, pagination);
  }

  async getConversation(businessId: string, id: string) {
    const conversation = await this.loadConversation(businessId, id);
    const messages = await this.prisma.aiMessage.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'asc' },
    });
    return { ...conversation, messages };
  }

  async deleteConversation(businessId: string, id: string) {
    await this.loadConversation(businessId, id);
    await this.prisma.aiConversation.delete({ where: { id } });
    return { success: true };
  }

  /** Starter questions shown on an empty assistant screen. */
  suggestions(): string[] {
    return [
      'How much profit did I make this month?',
      'What are my best selling products?',
      'What should I restock?',
      'Who owes me money?',
      'Where is my money going?',
      'Which products are not selling?',
    ];
  }
}

/**
 * Turns a failed Claude call into something worth showing a shopkeeper.
 *
 * The distinction that matters is *will waiting help*. "Try again in a moment"
 * is fine for an overloaded API and a lie for an unpaid account — and a lie the
 * person reading it cannot act on, so they retry forever while the real problem
 * sits in someone else's billing page. Anything needing an operator says so.
 *
 * Deliberately vague about the specifics: which Anthropic plan the platform is
 * on is nobody's business but the operator's, and the exact upstream error is
 * already in the log with a request id.
 */
function describeFailure(error: unknown): string {
  const status = (error as { status?: number }).status;
  const raw = (error as Error)?.message ?? '';

  // No credit / spend cap. The single most likely failure on a new key, and the
  // one that never resolves on its own.
  if (/credit balance|billing|quota|payment required/i.test(raw) || status === 402) {
    return 'The assistant is switched off because the BizPilot account that pays for it needs topping up. Everything else keeps working — please let whoever runs BizPilot know.';
  }

  if (status === 401 || status === 403 || /authentication|api key|permission/i.test(raw)) {
    return 'The assistant is not configured correctly. Everything else keeps working — please let whoever runs BizPilot know.';
  }

  // These genuinely do clear on their own.
  if (status === 429 || /rate limit/i.test(raw)) {
    return 'The assistant is busy right now. Wait a minute and ask again.';
  }
  if (status === 529 || (typeof status === 'number' && status >= 500)) {
    return 'The assistant is temporarily unavailable. Please try again in a moment.';
  }

  if (/model/i.test(raw) && status === 404) {
    return 'The assistant is set up with a model this account cannot use. Everything else keeps working — please let whoever runs BizPilot know.';
  }

  return 'The assistant could not answer that just now. Please try again in a moment.';
}
