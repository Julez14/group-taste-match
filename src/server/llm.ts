import type { z } from "zod";
import type { AiClient } from "./ai";
import { ProviderError } from "./ai";

export const LLM_MODEL = "@cf/openai/gpt-oss-120b";

export type ChatSettings = {
  model: string;
  reasoningEffort: "none" | "low" | "medium" | "high";
  maxTokens: number;
  temperature: number;
};

export const DEFAULT_LLM_SETTINGS: ChatSettings = {
  model: LLM_MODEL,
  reasoningEffort: "low",
  maxTokens: 4000,
  temperature: 0,
};

type ChatOutput = {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export class SchemaError extends Error {
  constructor(
    message: string,
    readonly raw: string,
  ) {
    super(message);
  }
}

function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("no JSON object found");
  return JSON.parse(trimmed.slice(start, end + 1));
}

/**
 * One chat call that must return JSON matching `schema`. Allows exactly one
 * bounded repair attempt that shows the model its validation errors.
 */
export async function chatJson<S extends z.ZodType>(
  ai: AiClient,
  args: {
    system: string;
    user: string;
    schema: S;
    purpose: string;
    settings?: Partial<ChatSettings>;
    timeoutMs?: number;
    /** Strict JSON Schema for constrained decoding; falls back to json_object when absent. */
    jsonSchema?: { name: string; schema: Record<string, unknown> };
  },
): Promise<{ value: z.infer<S>; raw: string; repaired: boolean }> {
  const s = { ...DEFAULT_LLM_SETTINGS, ...args.settings };
  const responseFormat = args.jsonSchema
    ? { type: "json_schema", json_schema: { name: args.jsonSchema.name, schema: args.jsonSchema.schema, strict: true } }
    : { type: "json_object" };
  const call = async (messages: { role: string; content: string }[], purpose: string) => {
    const out = await ai.run<ChatOutput>(
      s.model,
      {
        messages,
        max_tokens: s.maxTokens,
        temperature: s.temperature,
        reasoning_effort: s.reasoningEffort,
        response_format: responseFormat,
      },
      { purpose, timeoutMs: args.timeoutMs ?? 60_000 },
    );
    const content = out.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new ProviderError("empty completion", s.model);
    return content;
  };

  const messages = [
    { role: "system", content: args.system },
    { role: "user", content: args.user },
  ];
  const raw = await call(messages, args.purpose);
  let problem: string;
  try {
    const parsed = args.schema.safeParse(extractJson(raw));
    if (parsed.success) return { value: parsed.data, raw, repaired: false };
    problem = parsed.error.issues
      .slice(0, 8)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
  } catch (e) {
    problem = (e as Error).message;
  }

  const repairRaw = await call(
    [
      ...messages,
      { role: "assistant", content: raw },
      { role: "user", content: `Your JSON did not validate: ${problem}. Return only the corrected JSON object.` },
    ],
    `${args.purpose}:repair`,
  );
  try {
    const parsed = args.schema.safeParse(extractJson(repairRaw));
    if (parsed.success) return { value: parsed.data, raw: repairRaw, repaired: true };
    throw new SchemaError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), repairRaw);
  } catch (e) {
    if (e instanceof SchemaError) throw e;
    throw new SchemaError((e as Error).message, repairRaw);
  }
}
