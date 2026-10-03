import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import {
  AI_MODEL_LABELS,
  AI_USAGE_WARN_SHARE,
  type AiModel,
  type AiProvider,
  type AiUsagePrice,
  type AiUsageReport,
  type AiUsageSummary,
  type AiUsageTotals,
  type SetAiUsageLimitInput,
} from "@finance/shared";
import { eq, sql } from "drizzle-orm";

import { AuditService } from "../../common/audit/audit.service";
import type { AuthenticatedUser } from "../../common/decorators/auth.decorators";
import { DbService } from "../../db/db.service";
import { aiUsage, appSettings } from "../../db/schema";
import { dollars, picoCost, picoOf, type TokenSums } from "./ai-cost";
import { AI_PRICES, LONG_PROMPT_TOKENS } from "./ai-prices";
import type { ModelUsage } from "./model-turn";

/** One call to a model, as it is kept: who, where, which, and the counts. */
export type UsageRow = {
  userId: string | null;
  chatId?: string | null;
  provider: AiProvider;
  model: string;
  kind: "turn" | "document" | "test";
  usage: ModelUsage;
};

/** Dhaka's month, as SQL reads it: from its first midnight. */
const MONTH_START = sql`date_trunc('month', now() at time zone 'Asia/Dhaka') at time zone 'Asia/Dhaka'`;

const EMPTY: AiUsageTotals = {
  calls: 0,
  inputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  thinkingTokens: 0,
  costUsd: null,
  unpricedCalls: 0,
};

/** Groups of calls, summed: the counts and their estimate. */
type Tally = { totals: AiUsageTotals; pico: bigint; priced: boolean };

function tallyOf(groups: TokenSums[]): Tally {
  let pico = 0n;
  let priced = false;
  const totals: AiUsageTotals = { ...EMPTY };
  for (const group of groups) {
    totals.calls += group.calls;
    totals.inputTokens += group.inputTokens;
    totals.cacheReadTokens += group.cacheReadTokens;
    totals.cacheWriteTokens += group.cacheWriteTokens;
    totals.outputTokens += group.outputTokens;
    totals.thinkingTokens += group.thinkingTokens;
    const cost = picoCost(group);
    if (cost === null) {
      totals.unpricedCalls += group.calls;
    } else {
      pico += cost;
      priced = true;
    }
  }
  totals.costUsd = priced ? dollars(pico) : null;
  return { totals, pico, priced };
}

/** Rows grouped by a key, each group tallied. */
function byKey<T extends TokenSums>(
  rows: T[],
  key: (row: T) => string,
): Map<string, Tally> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const at = key(row);
    groups.set(at, [...(groups.get(at) ?? []), row]);
  }
  return new Map([...groups].map(([at, list]) => [at, tallyOf(list)]));
}

/**
 * What the Assistant spends (B3, 4 Oct 2026).
 *
 * One row of `ai_usage` per call to a model (#152): every round of a turn,
 * every document read, every key's Test. The estimate is worked out here
 * when it is read, from those counts and the price table in the code
 * (ai-prices.ts), never stored. Tokens are summed in SQL; dollars are
 * multiplied and added as whole numbers (ai-cost.ts), never as floats.
 *
 * The month is Dhaka's. The limit is one for the whole company, in dollars
 * of estimated cost (the owner, 3 Oct 2026): at 80% the chat warns, and at
 * 100% the Assistant stops for everybody, before any model is asked, until
 * the month turns or a Super Admin raises it.
 */
@Injectable()
export class AiUsageService {
  private readonly log = new Logger(AiUsageService.name);

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Keeps calls already made. Never in the way of the answer they bought:
   * a failure to keep the count is logged, and the person still gets it.
   */
  async record(rows: UsageRow[]): Promise<void> {
    if (!rows.length) return;
    const values = (onChat: boolean) =>
      rows.map((row) => ({
        userId: row.userId,
        chatId: onChat ? (row.chatId ?? null) : null,
        provider: row.provider,
        model: row.model,
        kind: row.kind,
        inputTokens: row.usage.inputTokens,
        cacheReadTokens: row.usage.cacheReadTokens,
        cacheWriteTokens: row.usage.cacheWriteTokens,
        outputTokens: row.usage.outputTokens,
        thinkingTokens: row.usage.thinkingTokens,
      }));
    try {
      await this.db.client.insert(aiUsage).values(values(true));
    } catch {
      // A conversation that was never kept, or was deleted meanwhile: the
      // calls are counted all the same, on no conversation. What was spent
      // has to reach the month's total.
      try {
        await this.db.client.insert(aiUsage).values(values(false));
      } catch (error) {
        this.log.warn(
          `Could not keep ${rows.length} model call(s): ${String(error)}`,
        );
      }
    }
  }

  /** The company's limit, in dollars of estimated cost; null: none. */
  async limit(): Promise<string | null> {
    const [row] = await this.db.client
      .select({ limit: appSettings.aiMonthlyLimitUsd })
      .from(appSettings)
      .where(eq(appSettings.id, 1))
      .limit(1);
    return row?.limit ?? null;
  }

  /** This month so far: the panel beside the chat, and the check before a call. */
  async summary(): Promise<AiUsageSummary> {
    const [groups, limitUsd, month] = await Promise.all([
      this.groups(sql`created_at >= ${MONTH_START}`),
      this.limit(),
      this.month(),
    ]);
    const tally = tallyOf(groups);
    if (!limitUsd) {
      return {
        month,
        totals: tally.totals,
        limitUsd: null,
        usedShare: null,
        state: "ok",
        message: null,
      };
    }

    const limitPico = picoOf(limitUsd);
    // For display only: the decision below is made on the whole numbers.
    const usedShare = Number((tally.pico * 10_000n) / limitPico) / 10_000;
    const stopped = tally.pico >= limitPico;
    const warning = !stopped && usedShare >= AI_USAGE_WARN_SHARE;
    const spent = `$${dollars(tally.pico).replace(/(\.\d{2})\d+$/, "$1")}`;
    return {
      month,
      totals: tally.totals,
      limitUsd,
      usedShare,
      state: stopped ? "stopped" : warning ? "warning" : "ok",
      message: stopped
        ? `The Assistant has reached this month's limit of $${limitUsd} (about ${spent} spent, an estimate). It is off until the 1st, unless a Super Admin raises the limit in the Assistant's settings. The ordinary forms all still work.`
        : warning
          ? `The Assistant has used ${Math.floor(usedShare * 100)}% of this month's limit of $${limitUsd} (about ${spent}, an estimate). At the limit it stops until the 1st; a Super Admin can raise it in the Assistant's settings.`
          : null,
    };
  }

  /**
   * Before any model is asked: refused at the limit, in words that say who
   * can raise it. Nothing is asked and nothing is kept.
   */
  async assertUnderLimit(): Promise<void> {
    const summary = await this.summary();
    if (summary.state === "stopped" && summary.message) {
      throw new HttpException(summary.message, HttpStatus.PAYMENT_REQUIRED);
    }
  }

  /** A month by day, person and model, with the last twelve months beside it. */
  async report(asked?: string): Promise<AiUsageReport> {
    const month = asked ?? (await this.month());
    const [year, monthNumber] = month.split("-").map(Number);
    const next =
      monthNumber === 12
        ? `${year + 1}-01`
        : `${year}-${String(monthNumber + 1).padStart(2, "0")}`;
    const inMonth = sql`created_at >= (${`${month}-01`}::date::timestamp at time zone 'Asia/Dhaka')
      and created_at < (${`${next}-01`}::date::timestamp at time zone 'Asia/Dhaka')`;

    const [rows, yearRows, people, limitUsd] = await Promise.all([
      this.groups(inMonth, true),
      this.groups(
        sql`created_at >= (${`${next}-01`}::date - interval '12 months')::timestamp at time zone 'Asia/Dhaka'
          and created_at < (${`${next}-01`}::date::timestamp at time zone 'Asia/Dhaka')`,
      ),
      this.db.client.execute(sql`select id, full_name from users`),
      this.limit(),
    ]);
    const names = new Map(
      (people.rows as Array<{ id: string; full_name: string }>).map((row) => [
        row.id,
        row.full_name,
      ]),
    );

    const days = byKey(rows, (row) => row.day);
    const persons = byKey(rows, (row) => row.userId ?? "");
    const models = byKey(rows, (row) => `${row.provider}|${row.model}`);
    const months = byKey(yearRows, (row) => row.day.slice(0, 7));

    return {
      month,
      totals: tallyOf(rows).totals,
      byDay: [...days]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([day, tally]) => ({ day, ...tally.totals })),
      byPerson: [...persons]
        .map(([userId, tally]) => ({
          userId: userId || null,
          name: userId
            ? (names.get(userId) ?? "Somebody since removed")
            : "Nobody (a removed account)",
          ...tally.totals,
        }))
        .sort((a, b) => b.calls - a.calls),
      byModel: [...models]
        .map(([key, tally]) => {
          const [provider, model] = key.split("|");
          const label = AI_MODEL_LABELS[model as AiModel] ?? model;
          return {
            model,
            provider,
            label: `${label}, ${provider === "vertex" ? "Google Cloud" : "Anthropic key"}`,
            ...tally.totals,
          };
        })
        .sort((a, b) => b.calls - a.calls),
      months: [...months]
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([at, tally]) => ({ month: at, ...tally.totals })),
      limitUsd,
      prices: AI_PRICES.map((price): AiUsagePrice => ({
        model: price.model,
        provider: price.provider,
        from: price.from ?? null,
        until: price.until ?? null,
        ...price.rate,
        long: price.long ?? null,
        source: price.source,
      })),
    };
  }

  /** The Super Admin's: one limit for the company, in dollars. Audited. */
  async setLimit(
    input: SetAiUsageLimitInput,
    actor: AuthenticatedUser,
  ): Promise<AiUsageSummary> {
    const limit =
      input.limitUsd === null ? null : Number(input.limitUsd).toFixed(2);
    await this.audit.mutate({
      action: "settings_change",
      entityTable: "app_settings",
      entityId: "1",
      summary: limit
        ? `Set the Assistant's monthly limit to $${limit} of estimated cost`
        : "Took off the Assistant's monthly limit",
      module: "settings",
      read: async (tx) => {
        const [row] = await tx
          .select({ limit: appSettings.aiMonthlyLimitUsd })
          .from(appSettings)
          .where(eq(appSettings.id, 1))
          .limit(1);
        return row;
      },
      run: async (tx) => {
        await tx
          .update(appSettings)
          .set({
            aiMonthlyLimitUsd: limit,
            updatedAt: new Date(),
            updatedBy: actor.id,
          })
          .where(eq(appSettings.id, 1));
      },
    });
    return this.summary();
  }

  /** YYYY-MM, Dhaka's month now. */
  private async month(): Promise<string> {
    const result = await this.db.client.execute(
      sql`select to_char(now() at time zone 'Asia/Dhaka', 'YYYY-MM') as month`,
    );
    return (result.rows[0] as { month: string }).month;
  }

  /**
   * The calls summed in SQL, by what decides their price — the model, the
   * way, the Dhaka day (a price can change on a date) and whether the prompt
   * was over 200,000 tokens — and, for the report, by person.
   */
  private async groups(
    where: ReturnType<typeof sql>,
    byPerson = false,
  ): Promise<Array<TokenSums & { userId: string | null }>> {
    const result = await this.db.client.execute(sql`
      select model, provider,
             to_char(created_at at time zone 'Asia/Dhaka', 'YYYY-MM-DD') as day,
             (input_tokens + cache_read_tokens + cache_write_tokens) > ${LONG_PROMPT_TOKENS} as long,
             ${byPerson ? sql`user_id` : sql`null::uuid`} as user_id,
             count(*)::int as calls,
             coalesce(sum(input_tokens), 0)::bigint as input,
             coalesce(sum(cache_read_tokens), 0)::bigint as cache_read,
             coalesce(sum(cache_write_tokens), 0)::bigint as cache_write,
             coalesce(sum(output_tokens), 0)::bigint as output,
             coalesce(sum(thinking_tokens), 0)::bigint as thinking
        from ${aiUsage}
       where ${where}
       group by 1, 2, 3, 4, 5`);
    return (
      result.rows as Array<{
        model: string;
        provider: string;
        day: string;
        long: boolean;
        user_id: string | null;
        calls: number;
        input: string;
        cache_read: string;
        cache_write: string;
        output: string;
        thinking: string;
      }>
    ).map((row) => ({
      model: row.model,
      provider: row.provider,
      day: row.day,
      long: row.long,
      userId: row.user_id,
      calls: Number(row.calls),
      inputTokens: Number(row.input),
      cacheReadTokens: Number(row.cache_read),
      cacheWriteTokens: Number(row.cache_write),
      outputTokens: Number(row.output),
      thinkingTokens: Number(row.thinking),
    }));
  }
}
