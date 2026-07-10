import type { DashboardModelUsage, DashboardRunSummary, TokenUsage } from "@agent-trace/schema";

type CostSummary = Partial<
  Pick<DashboardRunSummary, "costUsd" | "modelUsage" | "models" | "tokenUsage">
>;

type ModelPricing = {
  provider: string;
  input: number;
  output: number;
  cachedInput?: number;
  cacheWrite5m?: number;
  cacheRead?: number;
};

export type ExchangeRate = {
  rate: number;
  updatedAt?: string;
  source: "env" | "open.er-api.com";
};

export type RunCost = {
  usd?: number;
  cny?: number;
  exchangeRate?: number;
  exchangeRateUpdatedAt?: string;
  estimated: boolean;
  unpricedModels: string[];
};

const defaultExchangeRateUrl = "https://open.er-api.com/v6/latest/USD";

export async function getUsdCnyRate(): Promise<ExchangeRate | undefined> {
  const envRate = Number(process.env.AGENT_TRACE_USD_CNY_RATE ?? process.env.TOOLTRACE_USD_CNY_RATE);

  if (Number.isFinite(envRate) && envRate > 0) {
    return {
      rate: envRate,
      source: "env"
    };
  }

  try {
    const response = await fetch(
      process.env.AGENT_TRACE_EXCHANGE_RATE_URL ??
        process.env.TOOLTRACE_EXCHANGE_RATE_URL ??
        defaultExchangeRateUrl,
      {
        next: { revalidate: 3600 }
      }
    );

    if (!response.ok) {
      return undefined;
    }

    const payload = (await response.json()) as {
      rates?: { CNY?: number };
      time_last_update_utc?: string;
    };
    const rate = payload.rates?.CNY;

    return typeof rate === "number" && Number.isFinite(rate) && rate > 0
      ? {
          rate,
          updatedAt: payload.time_last_update_utc,
          source: "open.er-api.com"
        }
      : undefined;
  } catch {
    return undefined;
  }
}

export function calculateRunCost(summary: CostSummary | undefined, exchangeRate?: ExchangeRate): RunCost {
  const usages = getCostUsages(summary);
  const storedUsd = getStoredCostUsd(summary);
  const unpricedModels: string[] = [];
  let usd = 0;
  let estimated = Boolean(summary?.tokenUsage?.estimated);

  if (storedUsd !== undefined) {
    return {
      usd: storedUsd,
      cny: exchangeRate ? storedUsd * exchangeRate.rate : undefined,
      exchangeRate: exchangeRate?.rate,
      exchangeRateUpdatedAt: exchangeRate?.updatedAt,
      estimated,
      unpricedModels
    };
  }

  for (const usage of usages) {
    const pricing = getModelPricing(usage.model, usage.provider);

    estimated = estimated || Boolean(usage.tokenUsage.estimated);

    if (!pricing) {
      pushUnique(unpricedModels, usage.model);
      continue;
    }

    usd += calculateUsageCost(usage.tokenUsage, pricing);
  }

  const roundedUsd = usd > 0 ? usd : undefined;

  return {
    usd: roundedUsd,
    cny: roundedUsd !== undefined && exchangeRate ? roundedUsd * exchangeRate.rate : undefined,
    exchangeRate: exchangeRate?.rate,
    exchangeRateUpdatedAt: exchangeRate?.updatedAt,
    estimated,
    unpricedModels
  };
}

function getStoredCostUsd(summary: CostSummary | undefined) {
  if (!summary) {
    return undefined;
  }

  if (isPositiveNumber(summary.costUsd)) {
    return summary.costUsd;
  }

  const modelCosts =
    summary.modelUsage
      ?.map((usage) => usage.costUsd)
      .filter(isPositiveNumber) ?? [];

  if (modelCosts.length === 0) {
    return undefined;
  }

  return modelCosts.reduce((sum, cost) => sum + cost, 0);
}

function getCostUsages(summary: CostSummary | undefined): DashboardModelUsage[] {
  if (!summary) {
    return [];
  }

  if (summary.modelUsage && summary.modelUsage.length > 0) {
    return summary.modelUsage;
  }

  const onlyModel = summary.models?.length === 1 ? summary.models[0] : undefined;

  if (onlyModel && summary.tokenUsage?.total) {
    return [
      {
        model: onlyModel,
        tokenUsage: summary.tokenUsage
      }
    ];
  }

  return [];
}

function calculateUsageCost(usage: TokenUsage, pricing: ModelPricing) {
  const input = usage.input ?? 0;
  const cachedInput = usage.cachedInput ?? usage.cacheReadInput ?? 0;
  const cacheCreationInput = usage.cacheCreationInput ?? 0;
  const cacheReadInput = usage.cacheReadInput ?? usage.cachedInput ?? 0;

  if (pricing.provider === "anthropic") {
    const output = getBillableOutputTokens(usage, input + cacheCreationInput + cacheReadInput);

    return (
      (input * pricing.input +
        output * pricing.output +
        cacheCreationInput * (pricing.cacheWrite5m ?? pricing.input) +
        cacheReadInput * (pricing.cacheRead ?? pricing.cachedInput ?? pricing.input)) /
      1_000_000
    );
  }

  const isScanUsage = usage.sourceKind === "scan";
  const uncachedInput = isScanUsage ? input : Math.max(0, input - cachedInput);
  const regularInput = uncachedInput + (isScanUsage ? cacheCreationInput : 0);
  const nonOutputTokens = isScanUsage
    ? input + cachedInput + cacheCreationInput
    : input;
  const output = getBillableOutputTokens(usage, nonOutputTokens);

  return (
    (regularInput * pricing.input +
      cachedInput * (pricing.cachedInput ?? pricing.input) +
      output * pricing.output) /
    1_000_000
  );
}

function getBillableOutputTokens(usage: TokenUsage, nonOutputTokens: number) {
  const output = usage.output ?? 0;
  const total = usage.total;

  if (typeof total === "number") {
    const generatedFromTotal = total - nonOutputTokens;

    if (Number.isFinite(generatedFromTotal) && generatedFromTotal >= 0) {
      return Math.max(output, generatedFromTotal);
    }
  }

  return output + (usage.reasoningOutput ?? 0);
}

function getModelPricing(model: string, _provider: string | undefined) {
  return getConfiguredPricing()[normalizeModel(model)];
}

let configuredPricing: Record<string, ModelPricing> | undefined;

function getConfiguredPricing() {
  if (configuredPricing !== undefined) {
    return configuredPricing;
  }

  configuredPricing = parsePricingOverrides(
    process.env.AGENT_TRACE_MODEL_PRICES_JSON ?? process.env.TOOLTRACE_MODEL_PRICES_JSON
  );

  return configuredPricing;
}

function parsePricingOverrides(value: string | undefined): Record<string, ModelPricing> {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as Record<string, ModelPricing>;

    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([, pricing]) => isValidPricing(pricing))
        .map(([model, pricing]) => [normalizeModel(model), pricing])
    );
  } catch {
    return {};
  }
}

function isValidPricing(value: ModelPricing) {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.provider === "string" &&
    value.provider.length > 0 &&
    isNonnegativeNumber(value.input) &&
    isNonnegativeNumber(value.output)
  );
}

function normalizeModel(model: string) {
  return model.trim().toLowerCase();
}

function isNonnegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isPositiveNumber(value: unknown): value is number {
  return isNonnegativeNumber(value) && value > 0;
}

function pushUnique(values: string[], value: string) {
  if (!values.includes(value)) {
    values.push(value);
  }
}
