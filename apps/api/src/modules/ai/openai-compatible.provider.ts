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

/**
 * Nudges argument values to the types the schema declares.
 *
 * Smaller models send `{"limit": "10"}` where the schema says number, and the
 * provider rejects the whole call before it reaches us — the question is lost
 * over a pair of quotes. Coercing is safe here because the schemas are ours and
 * describe scalars only; anything that does not convert cleanly is left alone
 * for the tool to reject on its own terms.
 */
function coerceToSchema(args: Record<string, unknown>, schema: unknown): Record<string, unknown> {
  const properties = (schema as { properties?: Record<string, { type?: string }> })?.properties;
  if (!properties) return args;

  const out: Record<string, unknown> = { ...args };
  for (const [key, spec] of Object.entries(properties)) {
    const value = out[key];
    if (typeof value !== 'string') continue;

    if (spec?.type === 'number' || spec?.type === 'integer') {
      const asNumber = Number(value);
      if (value.trim() !== '' && Number.isFinite(asNumber)) out[key] = asNumber;
    } else if (spec?.type === 'boolean') {
      if (value === 'true') out[key] = true;
      if (value === 'false') out[key] = false;
    }
  }
  return out;
}

/** Longest we will silently hold a shopkeeper waiting before telling them. */
const MAX_RETRY_WAIT_MS = 12_000;

/**
 * How long to wait before retrying, or null if retrying is pointless.
 *
 * Prefers the `retry-after` header; falls back to the wait the provider quotes
 * in its message ("Please try again in 845ms"), which Groq gives and the header
 * sometimes rounds up to a whole second.
 */
function retryDelayMs(error: unknown): number | null {
  const { status, retryAfter, message } = error as {
    status?: number;
    retryAfter?: string | null;
    message?: string;
  };
  if (status !== 429) return null;

  const fromMessage = /try again in ([\d.]+)\s*(ms|s)\b/i.exec(message ?? '');
  if (fromMessage) {
    const value = Number(fromMessage[1]);
    const ms = fromMessage[2].toLowerCase() === 'ms' ? value : value * 1000;
    // A little headroom: the quoted figure is when the window clears, exactly.
    return ms <= MAX_RETRY_WAIT_MS ? Math.ceil(ms) + 250 : null;
  }

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds * 1000 <= MAX_RETRY_WAIT_MS) {
    return Math.ceil(seconds * 1000) + 250;
  }
  return null;
}

/**
 * Widens numeric parameters to accept a string as well.
 *
 * Coercing on our side is not enough on its own: Groq validates the model's
 * generated call against the schema we sent and rejects it before we ever see
 * it — "expected number, but got string" loses the whole question over a pair
 * of quotes a small model added. Declaring both types lets the call through,
 * and `coerceToSchema` then turns it into the number the tool expects.
 *
 * Only applied on this path. The schema Claude receives stays strict.
 */
function relaxSchema(schema: unknown): unknown {
  const source = schema as { properties?: Record<string, { type?: string }> } | null;
  if (!source?.properties) return schema;

  const properties: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(source.properties)) {
    properties[key] =
      spec?.type === 'number' || spec?.type === 'integer'
        ? { ...spec, type: [spec.type, 'string'] }
        : spec;
  }
  return { ...source, properties };
}

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
        parameters: relaxSchema(tool.input_schema),
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
      let parsed: unknown;
      try {
        parsed = JSON.parse(call.function.arguments);
      } catch {
        return 'Error: the arguments were not valid JSON. Call the tool again with valid JSON.';
      }
      // A tool taking no arguments is often called with the literal `null`,
      // which parses fine and then explodes the moment the tool destructures
      // it. An absent argument object means an empty one, not a null one.
      args =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {};
    }

    try {
      const result = await tool.run(coerceToSchema(args, tool.input_schema));
      return typeof result === 'string' ? result : JSON.stringify(result);
    } catch (error) {
      this.logger.error(`Tool ${call.function.name} failed: ${(error as Error).message}`);
      return `Error: ${call.function.name} could not be run.`;
    }
  }

  /**
   * One request, with a single retry when the provider says to wait.
   *
   * A rate-limited provider tells you exactly how long to hold off — often
   * under a second. Surfacing that to a shopkeeper as a failure they have to
   * retry by hand, when the fix is to pause for 900ms, is throwing away an
   * answer we could simply have waited for. Only once, and only for a short
   * wait: past that they should be told, not left watching a spinner.
   */
  private async complete(
    config: OpenAiCompatibleConfig,
    messages: ChatMessage[],
    tools: unknown[],
  ): Promise<{
    choices?: { message?: ChatMessage }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  }> {
    try {
      return await this.attempt(config, messages, tools);
    } catch (error) {
      const wait = retryDelayMs(error);
      if (wait === null) throw error;

      this.logger.warn(`Rate limited; waiting ${wait}ms and retrying once.`);
      await new Promise((resolve) => setTimeout(resolve, wait));
      return this.attempt(config, messages, tools);
    }
  }

  private async attempt(
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
          // Deliberately small. Providers reserve max_tokens against your
          // tokens-per-minute budget whether the model uses them or not, so
          // 2048 was booking 2048 tokens per call to write three sentences —
          // and rate-limiting the user out of their second question. The
          // answers here are short by design; the tools do the summarising.
          max_tokens: 700,
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
      ) as Error & { status?: number; retryAfter?: string | null };
      error.status = response.status;
      error.retryAfter = response.headers.get('retry-after');
      throw error;
    }

    return payload ?? {};
  }
}
