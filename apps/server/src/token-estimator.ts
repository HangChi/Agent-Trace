import { Tiktoken, type TiktokenBPE } from "js-tiktoken/lite";
import cl100kBase from "js-tiktoken/ranks/cl100k_base";
import o200kBase from "js-tiktoken/ranks/o200k_base";

import type { TokenUsage } from "@agent-trace/schema";

type TokenDirection = "input" | "output";
type SupportedEncoding = "cl100k_base" | "o200k_base";

const ranksByEncoding: Record<SupportedEncoding, TiktokenBPE> = {
  cl100k_base: cl100kBase,
  o200k_base: o200kBase
};

const encoders = new Map<SupportedEncoding, Tiktoken>();

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
    source: `${input.source}-estimate`,
    sourceKind: "estimate",
    scope: "event"
  };
}

function getCachedEncoder(name: SupportedEncoding) {
  const cached = encoders.get(name);

  if (cached !== undefined) {
    return cached;
  }

  const encoder = new Tiktoken(ranksByEncoding[name]);
  encoders.set(name, encoder);

  return encoder;
}

function getEncodingName(model: string | undefined): SupportedEncoding {
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
