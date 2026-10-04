export type AiUsage = { promptTokens?: number; completionTokens?: number; audioSeconds?: number };

export type AiCallRecord = {
  model: string;
  ms: number;
  ok: boolean;
  usage: AiUsage;
  error?: string;
  purpose: string;
};

/**
 * Minimal provider interface shared by the Worker (binding) and the Node
 * experiment runner (REST through the same AI Gateway).
 */
export interface AiClient {
  run<T = unknown>(model: string, input: unknown, opts: { purpose: string; timeoutMs?: number }): Promise<T>;
  readonly calls: AiCallRecord[];
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly model: string,
  ) {
    super(message);
  }
}

export function extractUsage(output: unknown): AiUsage {
  const u = (output as { usage?: Record<string, number> } | null)?.usage;
  if (!u) return {};
  return { promptTokens: u.prompt_tokens ?? u.input_tokens, completionTokens: u.completion_tokens ?? u.output_tokens };
}

export async function withTimeout<T>(p: Promise<T>, ms: number, model: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ProviderError(`Timed out after ${ms} ms`, model)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function bindingClient(env: Pick<Env, "AI" | "AI_GATEWAY_ID">, metadata: Record<string, string> = {}): AiClient {
  const calls: AiCallRecord[] = [];
  return {
    calls,
    async run<T>(model: string, input: unknown, opts: { purpose: string; timeoutMs?: number }) {
      const started = Date.now();
      try {
        const out = await withTimeout(
          env.AI.run(model as Parameters<Ai["run"]>[0], input as never, {
            gateway: { id: env.AI_GATEWAY_ID, skipCache: true, metadata: { ...metadata, purpose: opts.purpose } },
          }) as Promise<T>,
          opts.timeoutMs ?? 60_000,
          model,
        );
        calls.push({ model, ms: Date.now() - started, ok: true, usage: extractUsage(out), purpose: opts.purpose });
        return out;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        calls.push({ model, ms: Date.now() - started, ok: false, usage: {}, error: message, purpose: opts.purpose });
        throw e instanceof ProviderError ? e : new ProviderError(message, model);
      }
    },
  };
}
