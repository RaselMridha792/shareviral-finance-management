import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";

import { DbService } from "../../db/db.service";
import type { RequestKind } from "../hr-requests/hr-requests.schemas";
import { readStatuses, type RequestStatus } from "../hr-requests/request-rows";

/** The HR portal takes up to 200 a call; more is a backfill, which its poll does. */
const MAX_PER_CALL = 200;

/** A decision is never kept waiting on another application. */
const TIMEOUT_MS = 5_000;

/**
 * The four words the HR portal knows (its Brief 7 §3). It keeps a word it
 * does not recognise aside rather than guessing, and asked to be told before
 * a fifth is sent — so "withdrawn", which is HR's own act and which it
 * already knows about, is not sent here. Its poll still reads it.
 */
const SENT_STATES = new Set<RequestStatus["state"]>([
  "pending",
  "held",
  "approved",
  "rejected",
]);

type Target = { url: string; secret: string };

/**
 * The configuration, read and checked — or why it is off.
 *
 * Checked here rather than in env.ts on purpose: a bad value there stops the
 * whole API from starting, and an optional webhook must never be able to take
 * the finance app down. A bad value here turns the webhook off and says why,
 * without ever printing the value.
 */
type Config = { on: true; target: Target } | { on: false; why: string };

function configured(): Config {
  const url = process.env.HR_WEBHOOK_URL?.trim();
  const secret = process.env.HR_WEBHOOK_SECRET?.trim();
  if (!url || !secret) {
    return {
      on: false,
      why: "HR_WEBHOOK_URL or HR_WEBHOOK_SECRET is not set",
    };
  }
  /* Visible characters only. A line break inside would make every send fail
     with an error that repeats the header's value — the whole secret — and
     the HR side could not hold it as a header either. */
  if (!/^[\x21-\x7e]{16,}$/.test(secret)) {
    return {
      on: false,
      why: "HR_WEBHOOK_SECRET must be 16 or more visible characters, with no spaces or line breaks",
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { on: false, why: "HR_WEBHOOK_URL is not a web address" };
  }
  if (parsed.username || parsed.password) {
    return {
      on: false,
      why: "HR_WEBHOOK_URL carries a user name or password; the secret goes in its own header",
    };
  }
  /* The secret travels in a header, so never in the clear to another
     machine. Plain http is allowed to this machine only — the harness. */
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && local)) {
    return {
      on: false,
      why: "HR_WEBHOOK_URL must be https (plain http only to this machine)",
    };
  }
  return { on: true, target: { url, secret } };
}

/**
 * Tells the HR portal, the moment it happens, what finance now says about
 * one of its money requests (#128).
 *
 * The owner asked for both a webhook and a poll. The HR portal polls the four
 * status routes every hour and collects every decision either way; this only
 * turns "within the hour" into "within seconds". So it is built to be
 * forgettable:
 *
 *   - Off unless HR_WEBHOOK_URL and HR_WEBHOOK_SECRET are both set and sound
 *     (`configured`); a bad value turns it off with a warning rather than
 *     stopping the API. The secret is the same string as
 *     FINANCE_WEBHOOK_SECRET on the HR side and is never logged — every
 *     error is scrubbed of it (`describe`).
 *   - Fire and forget. `notify` returns at once and never throws; a decision
 *     is not slowed, and never fails, because the HR portal is restarting.
 *   - No retries, on anything. A `written: 0` answer is ordinary — the row
 *     was never sent to finance, or HR filed it away — and HR asked that it
 *     not be retried (§5), because a retry against a row that will never
 *     match is a loop that never ends. A failed call is reconciled by the
 *     next poll.
 *   - The body is exactly what the status routes answer, read by the same
 *     function (`readStatuses`), so the webhook and the poll cannot tell the
 *     HR portal two different things about the same request.
 *   - Redirects are refused: the secret travels in a header, and following a
 *     redirect would hand it to whatever host the redirect names.
 */
@Injectable()
export class HrWebhookService implements OnModuleInit {
  private readonly log = new Logger(HrWebhookService.name);

  constructor(private readonly db: DbService) {}

  onModuleInit() {
    const config = configured();
    if (config.on) {
      this.log.log(
        `On: decisions on HR's requests go to ${new URL(config.target.url).host} as they are made.`,
      );
    } else {
      this.log.warn(
        `Off: ${config.why}. The HR portal's hourly poll still collects every decision.`,
      );
    }
  }

  /**
   * Say what finance now holds about these requests. Call it after the
   * change has committed — it reads the rows back. Ids that are null (pay
   * copied in from before approvals existed, which HR never sent) are
   * skipped.
   */
  notify(kind: RequestKind, externalIds: (string | null | undefined)[]): void {
    const config = configured();
    const ids = [
      ...new Set(externalIds.filter((id): id is string => Boolean(id))),
    ];
    if (!config.on || ids.length === 0) return;
    const { target } = config;
    void this.send(target, kind, ids).catch((error: unknown) => {
      this.log.warn(
        `Could not tell the HR portal about ${ids.length} ${kind} request(s): ${describe(error, target.secret)}. Its hourly poll will collect them.`,
      );
    });
  }

  /** The sending itself. Resolves once every batch has had its one try. */
  async send(target: Target, kind: RequestKind, ids: string[]): Promise<void> {
    const decisions = (await readStatuses(this.db.client, kind, ids)).filter(
      (row) => SENT_STATES.has(row.state),
    );
    for (let at = 0; at < decisions.length; at += MAX_PER_CALL) {
      const batch = decisions.slice(at, at + MAX_PER_CALL);
      let response: Response;
      try {
        response = await fetch(target.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-finance-secret": target.secret,
          },
          body: JSON.stringify(batch),
          redirect: "error",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (error) {
        this.log.warn(
          `The HR portal could not be reached for ${batch.length} ${kind} decision(s): ${describe(error, target.secret)}. Its hourly poll will collect them.`,
        );
        continue;
      }
      if (response.ok) {
        const body = (await response.json().catch(() => null)) as {
          written?: number;
        } | null;
        this.log.log(
          `Told the HR portal about ${batch.length} ${kind} decision(s); ${body?.written ?? "an unknown number"} matched a row there.`,
        );
      } else if (response.status === 401) {
        this.log.warn(
          "The HR portal refused the webhook's secret (401). HR_WEBHOOK_SECRET must be the same string as FINANCE_WEBHOOK_SECRET on the HR side.",
        );
      } else {
        this.log.warn(
          `The HR portal answered ${response.status} to ${batch.length} ${kind} decision(s). Its hourly poll will collect them.`,
        );
      }
    }
  }
}

/**
 * An error in words, with its cause — and never the secret.
 *
 * Node's fetch says only "fetch failed" for every network failure; what
 * happened (a refused connection, an unknown host, a certificate, the
 * redirect this refuses) is in `cause`, so it is added. Whatever the text,
 * the secret is cut out of it before it is logged, and it is kept short.
 */
function describe(error: unknown, secret: string): string {
  /* Cleaned BEFORE it is shortened, piece by piece: shortening first could
     leave half a secret behind, and shortening the whole could cut off the
     cause — a database error's message is the whole query. */
  const clean = (text: string, max: number) => {
    const cut = text.split(secret).join("[secret]");
    return cut.length > max ? `${cut.slice(0, max)}…` : cut;
  };
  if (error instanceof Error && error.name === "TimeoutError") {
    return `no answer within ${TIMEOUT_MS / 1000}s`;
  }
  if (error instanceof Error) {
    const cause = (error as { cause?: { code?: string; message?: string } })
      .cause;
    const why = cause?.code ?? cause?.message;
    const message = clean(error.message, 200);
    return why ? `${message} (${clean(String(why), 120)})` : message;
  }
  return clean(String(error), 200);
}
