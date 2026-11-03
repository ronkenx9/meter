// The one place METER talks to Claude. Everything above this sees a small interface, so tests run on a fake
// and a model failure is an ordinary error the caller can fall back from. The key never leaves this module.

import Anthropic from "@anthropic-ai/sdk";

export const PLANNER_MODEL = "claude-opus-5-5";
/** Provider tiers are real models, so paying more buys a real difference. */
export const TIER_MODELS: Record<string, string> = {
  basic: "claude-haiku-5-5",
  standard: "claude-sonnet-5-5",
  premium: "claude-opus-5-5",
};

export type Effort = "low" | "medium" | "high";

export interface CompleteRequest {
  model: string;
  system: string;
  user: string;
  effort: Effort;
  /** Includes room for thinking, which is on for these models. */
  maxTokens: number;
  /** A JSON schema the reply must match; the reply text is then JSON. */
  schema?: Record<string, unknown>;
  timeoutMs?: number;
}

export interface CompleteResult {
  text: string;
  /** Which model actually answered, which can differ if a fallback ran. */
  model: string;
}

export interface ModelClient {
  complete(req: CompleteRequest): Promise<CompleteResult>;
}

export class ModelRefused extends Error {
  override name = "ModelRefused";
}

// Refusals on these re-run server-side on Anthropic's recommended fallback. Haiku has no server-side fallback.
const HAS_FALLBACK = new Set(["claude-opus-5-5", "claude-sonnet-5-5"]);

export function createModelClient(env: NodeJS.ProcessEnv = process.env): ModelClient | null {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  const workspace = env.ANTHROPIC_WORKSPACE_ID?.trim();
  const client = new Anthropic({ apiKey, ...(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {}) });

  return {
    async complete(req) {
      const output_config = {
        effort: req.effort,
        ...(req.schema ? { format: { type: "json_schema" as const, schema: req.schema } } : {}),
      };
      const options = { timeout: req.timeoutMs ?? 60_000, maxRetries: 1 };
      const base = { model: req.model, max_tokens: req.maxTokens, system: req.system, messages: [{ role: "user" as const, content: req.user }], output_config };
      const response = HAS_FALLBACK.has(req.model)
        ? await client.beta.messages.create({ ...base, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }, options)
        : await client.messages.create(base, options);
      if (response.stop_reason === "refusal") throw new ModelRefused(`${req.model} declined this request`);
      if (response.stop_reason === "max_tokens") throw new Error(`${req.model} ran out of tokens before finishing`);
      const text = (response.content as Array<{ type: string; text?: string }>)
        .flatMap((b) => (b.type === "text" && b.text ? [b.text] : []))
        .join("")
        .trim();
      if (!text) throw new Error(`${req.model} returned no text`);
      return { text, model: response.model };
    },
  };
}

/** A cheap real call, so a bad key is found before a run spends anything. */
export async function pingModel(client: ModelClient): Promise<void> {
  await client.complete({ model: TIER_MODELS.basic!, system: "Reply with the single word OK.", user: "Ping", effort: "low", maxTokens: 200, timeoutMs: 30_000 });
}
