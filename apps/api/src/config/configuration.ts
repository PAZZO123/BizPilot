import { z } from 'zod';

/**
 * A URL that tolerates being given a bare hostname.
 *
 * Render's blueprint can wire a service's own address in with
 * `fromService: { property: host }`, but that yields "bizpilot-api.onrender.com"
 * — a hostname, with no scheme. Demanding a full URL means the app refuses to
 * boot on a value the platform generated for it, which is a silly way to fail.
 * Prefix https:// when the scheme is missing and leave anything else alone.
 */
function hostOrUrl(fallback: string) {
  return z.preprocess(
    (value) =>
      typeof value === 'string' && value !== '' && !/^https?:\/\//i.test(value)
        ? `https://${value}`
        : value,
    z.string().url().default(fallback),
  );
}

/**
 * Environment contract. The app refuses to boot if anything required is
 * missing or malformed — a misconfigured deploy should fail loudly at startup,
 * not silently at 2am when a webhook arrives.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  WEB_URL: hostOrUrl('http://localhost:5173'),
  API_URL: hostOrUrl('http://localhost:4000'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  /**
   * A direct (unpooled) connection, used only by `prisma migrate` — which runs
   * in the start command, so it has to be present at runtime. On a database
   * with no pooler in front of it, set this to the same value as DATABASE_URL.
   */
  DIRECT_URL: z.string().min(1, 'DIRECT_URL is required (same as DATABASE_URL if there is no pooler)'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),

  /**
   * Who may see the platform dashboard — the view of BizPilot's own revenue,
   * not any one shop's. Comma-separated emails. Deliberately an env var rather
   * than a database flag: the list of people who can read every customer's
   * turnover should not be editable from inside the product.
   */
  PLATFORM_ADMIN_EMAILS: z.string().optional().default(''),

  /** Estimated cost of one assistant question, in RWF minor units, used only
   *  to show gross margin on the platform dashboard. */
  AI_COST_PER_MESSAGE_RWF: z.coerce.number().nonnegative().default(1500),

  /**
   * Which service answers assistant questions.
   *
   * `anthropic` is the intended home. `openai-compatible` exists so the
   * assistant can run on a free tier while the product has no revenue — it
   * speaks the /chat/completions shape, which Groq, Google's Gemini
   * compatibility endpoint, OpenRouter and Mistral all serve. Moving to Claude
   * later is this one variable.
   */
  AI_PROVIDER: z.enum(['anthropic', 'openai-compatible']).default('anthropic'),
  /** e.g. https://api.groq.com/openai/v1 */
  AI_BASE_URL: z.string().optional().default(''),
  AI_API_KEY: z.string().optional().default(''),
  AI_MODEL: z.string().optional().default(''),

  ANTHROPIC_API_KEY: z.string().optional().default(''),
  ANTHROPIC_MODEL: z.string().default('claude-opus-5'),
  ANTHROPIC_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('low'),

  FLUTTERWAVE_PUBLIC_KEY: z.string().optional().default(''),
  FLUTTERWAVE_SECRET_KEY: z.string().optional().default(''),
  FLUTTERWAVE_WEBHOOK_HASH: z.string().optional().default(''),

  SMS_PROVIDER: z.enum(['log', 'africastalking', 'twilio']).default('log'),
  SMS_SENDER_ID: z.string().default('BizPilot'),
  AFRICASTALKING_USERNAME: z.string().optional().default(''),
  AFRICASTALKING_API_KEY: z.string().optional().default(''),
  TWILIO_ACCOUNT_SID: z.string().optional().default(''),
  TWILIO_AUTH_TOKEN: z.string().optional().default(''),
  TWILIO_FROM_NUMBER: z.string().optional().default(''),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  // Treat an empty value as "not set".
  //
  // Zod applies `.default()` only when a key is `undefined`, never when it is
  // an empty string. Hosting dashboards do not make that distinction: leaving a
  // field blank in Render's blueprint form creates the variable with an empty
  // value. Without this, a blank WEB_URL reaches `.url()` as "" and the whole
  // API refuses to boot — on a field that has a perfectly good default.
  const cleaned = Object.fromEntries(
    Object.entries(raw).filter(([, value]) => value !== ''),
  );

  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  const env = result.data;

  // Refusing dev placeholders in production is cheap insurance against
  // shipping a signing key that is public in the repo's .env.example.
  if (env.NODE_ENV === 'production') {
    for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET'] as const) {
      if (env[key].includes('change-me') || env[key].startsWith('dev-only')) {
        throw new Error(`${key} still holds a development placeholder — set a real secret.`);
      }
    }
  }

  return env;
}

export interface AppConfig {
  env: Env;
  isProduction: boolean;
  corsOrigins: string[];
}

export function buildConfig(env: Env): AppConfig {
  return {
    env,
    isProduction: env.NODE_ENV === 'production',
    corsOrigins: env.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  };
}
