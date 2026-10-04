import type { AiClient } from "./ai";

export const STT_MODEL = "@cf/deepgram/nova-3";
export const MAX_AUDIO_BYTES = 2_500_000;

export const FIXTURE_TRANSCRIPT = "Fixture transcript: something cozy, not too far, around thirty dollars.";

type NovaOutput = {
  results?: { channels?: { alternatives?: { transcript?: string }[] }[] };
};

export async function transcribe(
  ai: AiClient,
  audio: ArrayBuffer,
  contentType: string,
  timeoutMs: number,
): Promise<string> {
  const out = await ai.run<NovaOutput>(
    STT_MODEL,
    {
      audio: { body: new Blob([audio]).stream(), contentType },
      smart_format: true,
      punctuate: true,
      language: "en",
    },
    { purpose: "transcription", timeoutMs },
  );
  return out.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? "";
}
