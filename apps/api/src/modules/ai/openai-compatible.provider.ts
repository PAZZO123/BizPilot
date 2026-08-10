import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

/**
 * Runs the assistant against any provider that speaks OpenAI's
 * `/chat/completions` shape with tool calling.
 *
 * Written deliberately as one adapter rather than one per vendor, because the
 * point is not to support a particular company — it is to run the assistant on
 * whatever is free this month and move to Claude when the product earns enough
 * to pay for it. Groq, Google's Gemini compatibility endpoint, OpenRouter,
 * Mistral and Together all fit behind this with nothing but a different base
 * URL, key and model name.
 *
 * The Claude path is untouched and remains the default. This is the fallback,
 * not the replacement.
 *
 * Uses `fetch` rather than the `openai` package: the surface we need is one
 * endpoint, and a dependency that exists to describe an API we call three times
 * is a dependency to keep updated for no benefit.
 */

/** The subset of a `betaTool` we need. The same objects serve both providers. */
export interface RunnableTool {
  name: string;
  description?: string;
  input_schema: unknown;
  run: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ProviderResult {
  answer: string;
  toolsUsed: string[];
  inputTokens: number;
  outputTokens: number;
}

interface ToolCall {
  id: string;
  function: { name: string; arguments: string };
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface OpenAiCompatibleConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxIterations: number;
}

@Injectable()
export class OpenAiCompatibleProvider {
  private readonly logger = new Logger(OpenAiCompatibleProvider.name);

  async run(
    config: OpenAiCompatibleConfig,
    system: string,
    history: ChatTurn[],
    tools: RunnableTool[],
  ): Promise<ProviderResult> {
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    const messages: ChatMessage[] = [
      { role: 'system', content: system },
      ...history.map((turn) => ({ role: turn.role, content: turn.content })),
    ];

    const toolSpec = tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description ?? '',
        parameters: tool.input_schema,
      },
    }));

    const toolsUsed = new Set<string>();
    let inputTokens = 0;
    let outputTokens = 0;

    // Same cap as the Claude path: a well-formed question needs two or three
    // tool calls, and a model that loops is a rate limit burned for nothing.
    for (let iteration = 0; iteration < config.maxIterations; iteration += 1) {
      const response = await this.complete(config, messages, toolSpec);

      inputTokens += response.usage?.prompt_tokens ?? 0;
      outputTokens += response.usage?.completion_tokens ?? 0;

      const message = response.choices?.[0]?.message;
      if (!message) {
        throw new ServiceUnavailableException('The assistant returned an empty response.');
      }

      const calls = message.tool_calls ?? [];
      if (!calls.length) {
        return {
          answer: (message.content ?? '').trim(),
          toolsUsed: [...toolsUsed],
          inputTokens,
          outputTokens,
        };
      }

      // The assistant's own turn has to go back in before the results, or the
      // provider rejects tool messages that answer nothing.
      messages.push({
        role: 'assistant',
        content: message.content ?? null,
        tool_calls: calls,
      });

      for (const call of calls) {
        toolsUsed.add(call.function.name);
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: await this.runTool(byName, call),
        });
      }
    }

    // Out of iterations with no final answer. Say so rather than returning
    // an empty bubble that looks like the assistant ignored the question.
    this.logger.warn(`Assistant hit the ${config.maxIterations}-step limit without answering.`);
    throw new ServiceUnavailableException(
      'The assistant could not work that out. Try asking it more simply.',
    );
  }

  /**
   * Executes one tool call and returns whatever the model should see.
   *
   * A failure here is reported *to the model*, not thrown: a smaller model will
   * sometimes call a tool with a malformed argument, and telling it so lets it
   * correct itself on the next turn. Throwing would lose the whole question.
   */
  private async runTool(byName: Map<string, RunnableTool>, call: ToolCall): Promise<string> {
    const tool = byName.get(call.function.name);
    if (!tool) return `Error: there is no tool called ${call.function.name}.`;

    let args: Record<string, unknown> = {};
    if (call.function.arguments?.trim()) {
      try {
        args = JSON.parse(call.function.arguments) as Record<string, unknown>;
      } catch {
        return 'Error: the arguments were not valid JSON. Call the tool again with valid JSON.';
      }
    }

    try {
      const result = await tool.run(args);
      return typeof result === 'string' ? result : JSON.stringify(result);
    } catch (error) {
      this.logger.error(`Tool ${call.function.name} failed: ${(error as Error).message}`);
      return `Error: ${call.function.name} could not be run.`;
    }
  }

  private async complete(
    config: OpenAiCompatibleConfig,
    messages: ChatMessage[],
    tools: unknown[],
  ): Promise<{
    choices?: { message?: ChatMessage }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  }> {
    let response: Response;
    try {
      response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          tools,
          tool_choice: 'auto',
          max_tokens: 2048,
        }),
        // Free tiers queue. Generous, but not forever — a shopkeeper is waiting.
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      throw new Error(`AI provider unreachable: ${(error as Error).message}`);
    }

    const payload = (await response.json().catch(() => null)) as
      | { error?: { message?: string }; choices?: { message?: ChatMessage }[] }
      | null;

    if (!response.ok) {
      // Rethrown as a plain Error so ai.service's describeFailure can classify
      // it — the status is preserved for the rate-limit and billing branches.
      const error = new Error(
        `${response.status} ${payload?.error?.message ?? 'request failed'}`,
      ) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }

    return payload ?? {};
  }
}
