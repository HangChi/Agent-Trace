process.env.AGENT_TRACE_MODEL_PRICES_JSON = JSON.stringify({
  "explicit-model": {
    provider: "openai",
    input: 2,
    cachedInput: 1,
    output: 4
  }
});

export {};

const { calculateRunCost } = await import("./cost");

const storedScanCost = calculateRunCost(
  {
    costUsd: 0.1234,
    modelUsage: [
      {
        model: "custom-scanned-model",
        provider: "local",
        costUsd: 0.1234,
        tokenUsage: {
          input: 900,
          output: 100,
          total: 1000,
          sourceKind: "scan",
          scope: "session"
        }
      }
    ]
  },
  { rate: 7.2, source: "env" }
);

expectClose(storedScanCost.usd, 0.1234, "stored scan cost");
expectClose(storedScanCost.cny, 0.88848, "stored scan CNY conversion");

const explicitOverrideCost = calculateRunCost({
  models: ["explicit-model"],
  tokenUsage: {
    input: 100,
    output: 20,
    total: 120,
    cachedInput: 60
  }
});

expectClose(explicitOverrideCost.usd, 0.00022, "explicit pricing override cost");

const explicitScanOverrideCost = calculateRunCost({
  models: ["explicit-model"],
  tokenUsage: {
    input: 100,
    output: 20,
    total: 180,
    cachedInput: 60,
    sourceKind: "scan",
    scope: "session"
  }
});

expectClose(explicitScanOverrideCost.usd, 0.00034, "scan pricing override cost");

const unknownCost = calculateRunCost({
  models: ["gpt-5.4"],
  tokenUsage: {
    input: 1,
    output: 1,
    total: 2,
    estimated: true
  }
});

if (unknownCost.usd !== undefined || !unknownCost.estimated) {
  throw new Error("Expected models without stored cost or explicit pricing to be unpriced but estimated.");
}

if (!unknownCost.unpricedModels.includes("gpt-5.4")) {
  throw new Error("Expected unpriced model name to be reported.");
}

console.log("Agent-Trace cost smoke test passed.");

function expectClose(actual: number | undefined, expected: number, label: string) {
  if (actual === undefined || Math.abs(actual - expected) > 0.0000001) {
    throw new Error(`Expected ${label} to be ${expected}, got ${actual ?? "undefined"}.`);
  }
}
