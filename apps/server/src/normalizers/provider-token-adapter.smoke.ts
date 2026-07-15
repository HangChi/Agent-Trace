import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { providerTokenAdapter, type AgentHookSource, type UsageContext } from "./provider-token-adapter.js";

type Fixture = {
  name: string;
  source: AgentHookSource;
  context: UsageContext;
  value: unknown;
  expected: Record<string, unknown>;
};

const fixtures = JSON.parse(
  readFileSync(new URL("./fixtures/provider-token.golden.json", import.meta.url), "utf8")
) as Fixture[];

for (const fixture of fixtures) {
  const actual = providerTokenAdapter.extractTokenUsage(fixture.source, fixture.value, fixture.context);
  assert.ok(actual, `${fixture.name}: expected token usage`);
  assert.deepEqual(
    Object.fromEntries(Object.keys(fixture.expected).map((key) => [key, actual[key as keyof typeof actual]])),
    fixture.expected,
    fixture.name
  );
  assert.equal(actual.sourceKind, "official", fixture.name);
  assert.equal(actual.scope, "event", fixture.name);
}

assert.equal(providerTokenAdapter.inferProviderFromModel("gpt-5.4"), "openai");
assert.equal(providerTokenAdapter.inferProviderFromModel("claude-sonnet-4-6"), "anthropic");
assert.equal(providerTokenAdapter.normalizeProviderName("AWS"), "bedrock");

console.log("Agent-Trace provider token adapter golden fixtures passed.");
