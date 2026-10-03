/**
 * What the Assistant spends, worked out (B3, 4 Oct 2026). The figures are
 * the providers' own, read from their pages the day this was built; these
 * hold the arithmetic to them: exact, by date, by prompt length, and never
 * $0 for a model with no price.
 */
import { dollars, picoCost, picoOf, priceOn, type TokenSums } from "./ai-cost";
import { geminiUsage } from "./gemini";
import { claudeUsage } from "./model-turn";

const group = (more: Partial<TokenSums>): TokenSums => ({
  model: "claude-opus-5",
  provider: "anthropic",
  day: "2026-10-04",
  long: false,
  calls: 1,
  inputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  thinkingTokens: 0,
  ...more,
});
const cost = (more: Partial<TokenSums>) => {
  const pico = picoCost(group(more));
  return pico === null ? null : dollars(pico);
};

describe("Claude Opus 5, as Anthropic prices it", () => {
  it("is $5 in, $6.25 a cache write, $0.50 a cache read, $25 out, per million", () => {
    expect(cost({ inputTokens: 1_000_000 })).toBe("5.0000");
    expect(cost({ cacheWriteTokens: 1_000_000 })).toBe("6.2500");
    expect(cost({ cacheReadTokens: 1_000_000 })).toBe("0.5000");
    expect(cost({ outputTokens: 1_000_000 })).toBe("25.0000");
  });

  it("costs the same through Google Cloud's global endpoint", () => {
    expect(
      cost({ provider: "vertex", inputTokens: 2_000, outputTokens: 300 }),
    ).toBe(cost({ inputTokens: 2_000, outputTokens: 300 }));
  });

  it("adds a turn up to the fraction of a cent", () => {
    // 1,200 in, 6,000 read from the cache, 800 out:
    // 0.006 + 0.003 + 0.02 = 0.029
    expect(
      cost({ inputTokens: 1_200, cacheReadTokens: 6_000, outputTokens: 800 }),
    ).toBe("0.0290");
  });
});

describe("Gemini, as Google prices it", () => {
  const flash = { model: "gemini-3.8-flash", provider: "vertex" };

  it("3.8 Flash: the introductory price through 31 December 2026", () => {
    expect(cost({ ...flash, day: "2026-12-31", inputTokens: 1_000_000 })).toBe(
      "0.7500",
    );
    expect(cost({ ...flash, day: "2026-12-31", outputTokens: 1_000_000 })).toBe(
      "3.7500",
    );
  });

  it("3.8 Flash: Google's standard price from 1 January 2027", () => {
    expect(cost({ ...flash, day: "2027-01-01", inputTokens: 1_000_000 })).toBe(
      "1.5000",
    );
    expect(cost({ ...flash, day: "2027-01-01", outputTokens: 1_000_000 })).toBe(
      "7.5000",
    );
  });

  it("bills its thinking as output", () => {
    expect(
      cost({ ...flash, outputTokens: 400_000, thinkingTokens: 600_000 }),
    ).toBe("3.7500");
  });

  it("3.1 Pro Preview and 2.5 Pro cost more for a prompt over 200,000 tokens", () => {
    const pro = { model: "gemini-3.1-pro-preview", provider: "vertex" };
    expect(cost({ ...pro, inputTokens: 1_000_000 })).toBe("2.0000");
    expect(cost({ ...pro, long: true, inputTokens: 1_000_000 })).toBe("4.0000");
    expect(cost({ ...pro, long: true, outputTokens: 1_000_000 })).toBe(
      "18.0000",
    );
    const old = { model: "gemini-2.5-pro", provider: "vertex" };
    expect(cost({ ...old, cacheReadTokens: 1_000_000 })).toBe("0.1250");
    expect(cost({ ...old, long: true, cacheReadTokens: 1_000_000 })).toBe(
      "0.2500",
    );
  });
});

describe("a model with no price", () => {
  it("is not $0: it has no price at all", () => {
    expect(priceOn("gemini-9-ultra", "vertex", "2026-10-04")).toBeNull();
    expect(
      cost({ model: "gemini-9-ultra", provider: "vertex", inputTokens: 5 }),
    ).toBeNull();
    // Gemini through the Anthropic key does not exist, and is priced nowhere.
    expect(
      cost({ model: "gemini-3.8-flash", provider: "anthropic" }),
    ).toBeNull();
  });
});

describe("the arithmetic", () => {
  it("never drifts by adding floats", () => {
    let pico = 0n;
    for (let i = 0; i < 1_000; i += 1) {
      pico += picoCost(group({ inputTokens: 3 })) ?? 0n;
    }
    // 3,000 tokens at $5 a million is exactly $0.015.
    expect(dollars(pico)).toBe("0.0150");
  });

  it("reads a limit in dollars exactly", () => {
    expect(picoOf("30.00")).toBe(30n * 10n ** 12n);
    expect(picoOf("0.5")).toBe(5n * 10n ** 11n);
    expect(dollars(picoOf("12.34"))).toBe("12.3400");
  });

  it("rounds half up at four places", () => {
    expect(dollars(5n * 10n ** 7n)).toBe("0.0001");
    expect(dollars(4n * 10n ** 7n)).toBe("0.0000");
  });
});

describe("each provider's counts, as ai_usage keeps them", () => {
  it("Claude: input apart from the cache, thinking inside output", () => {
    expect(
      claudeUsage({
        input_tokens: 120,
        output_tokens: 80,
        cache_read_input_tokens: 6_000,
        cache_creation_input_tokens: 0,
      }),
    ).toEqual({
      inputTokens: 120,
      cacheReadTokens: 6_000,
      cacheWriteTokens: 0,
      outputTokens: 80,
      thinkingTokens: null,
    });
  });

  it("Gemini: the prompt less its cached part, thinking on its own line", () => {
    expect(
      geminiUsage({
        usageMetadata: {
          promptTokenCount: 7_000,
          cachedContentTokenCount: 5_000,
          candidatesTokenCount: 300,
          thoughtsTokenCount: 900,
        },
      } as Parameters<typeof geminiUsage>[0]),
    ).toEqual({
      inputTokens: 2_000,
      cacheReadTokens: 5_000,
      cacheWriteTokens: 0,
      outputTokens: 300,
      thinkingTokens: 900,
    });
  });
});
