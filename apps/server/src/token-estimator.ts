import { getEncoding, type Tiktoken, type TiktokenEncoding } from "js-tiktoken";

import type { TokenUsage } from "@tooltrace/schema";

type TokenDirection = "input" | "output";

const encoders = new Map<TiktokenEncoding, Tiktoken>();

export function estimateTextTokenUsage(input: {
  text: string;
  direction: TokenDirection;
  model: string | undefined;
  source: string;
}): TokenUsage | undefined {
  const encodingName = getEncodingName(input.model);
  const encoder = getCachedEncoder(encodingName);
  const count = encoder.encode(input.text, "all").length;

  if (count === 0) {
    return undefined;
  }

  return {
    input: input.direction === "input" ? count : 0,
    output: input.direction === "output" ? count : 0,
    total: count,
    estimated: true,
    method: `tiktoken:${encodingName}`,
    source: `${input.source}-estimate`
  };
}

function getCachedEncoder(name: TiktokenEncoding) {
  const cached = encoders.get(name);

  if (cached !== undefined) {
    return cached;
  }

  const encoder = getEncoding(name);
  encoders.set(name, encoder);

  return encoder;
}

function getEncodingName(model: string | undefined): TiktokenEncoding {
  const normalized = model?.toLowerCase() ?? "";

  if (
    normalized.startsWith("gpt-3.5") ||
    normalized.startsWith("gpt-35") ||
    (normalized.startsWith("gpt-4") &&
      !normalized.startsWith("gpt-4o") &&
      !normalized.startsWith("gpt-4.1") &&
      !normalized.startsWith("gpt-4.5"))
  ) {
    return "cl100k_base";
  }

  return "o200k_base";
}
