import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import {
  AI_MODELS,
  AI_MODEL_LABELS,
  type AiModel,
  type GoogleCheck,
  type GoogleCheckId,
  type GoogleConnection,
  type GoogleKeyResult,
  type GoogleTestResult,
} from "@finance/shared";
import { eq } from "drizzle-orm";

import { AuditService } from "../../common/audit/audit.service";
import { seal } from "../../common/crypto/secret-box";
import type { AuthenticatedUser } from "../../common/decorators/auth.decorators";
import { DbService } from "../../db/db.service";
import { appSettings, users } from "../../db/schema";
import { explainClaudeError } from "../ai-intake/claude-errors";
import {
  GOOGLE_READ_SCOPES,
  googleAuth,
  openServiceAccount,
  readServiceAccount,
  vertexClient,
  type ServiceAccount,
} from "./google";

const LABELS: Record<GoogleCheckId, string> = {
  vertex: "Claude on Vertex AI",
  sheets: "Google Sheets",
  docs: "Google Docs",
  drive: "Google Drive",
};

/** The kinds of file Drive lists, for finding one to read in the test. */
const SPREADSHEET = "application/vnd.google-apps.spreadsheet";
const DOCUMENT = "application/vnd.google-apps.document";

/**
 * An id that cannot exist. Asked for when nothing of that kind has been
 * shared yet: any answer but "this API is disabled" proves it is switched on.
 */
const PROBE_ID = "sfm-connection-check";

type GoogleReply = { status: number; body: Record<string, unknown> | null };

/**
 * Settings → Connections: the Google Cloud service account (#131).
 *
 * The key goes in sealed and never comes out. Everything this returns is the
 * client email and the project — what Google prints on its own console, and
 * what the owner needs to share a file with the account.
 */
@Injectable()
export class ConnectionsService {
  private readonly log = new Logger(ConnectionsService.name);

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private async row() {
    const [row] = await this.db.client
      .select({
        sealed: appSettings.googleServiceAccount,
        setAt: appSettings.googleKeySetAt,
        setBy: users.fullName,
        region: appSettings.vertexRegion,
        model: appSettings.aiModel,
      })
      .from(appSettings)
      .leftJoin(users, eq(appSettings.googleKeySetBy, users.id))
      .where(eq(appSettings.id, 1))
      .limit(1);
    return row;
  }

  async google(): Promise<GoogleConnection> {
    const row = await this.row();
    const account = openServiceAccount(row?.sealed);
    return {
      configured: Boolean(account),
      clientEmail: account?.client_email ?? null,
      projectId: account?.project_id ?? null,
      region: row?.region || "global",
      setAt: account && row?.setAt ? row.setAt.toISOString() : null,
      setBy: account ? (row?.setBy ?? null) : null,
    };
  }

  /**
   * Saves the key — after Google has agreed it is a key.
   *
   * The test is a token, not a request to Vertex: a key is worth keeping
   * before the model is enabled or the APIs are switched on, and those are
   * what the Test button is for. A key Google will not exchange for a token
   * is worth nothing, and is not stored.
   */
  async setGoogleKey(
    text: string,
    actor: AuthenticatedUser,
  ): Promise<GoogleKeyResult> {
    const read = readServiceAccount(text);
    if ("problem" in read) {
      return {
        saved: false,
        message: read.problem,
        connection: await this.google(),
      };
    }
    const { account } = read;

    try {
      await googleAuth(account, GOOGLE_READ_SCOPES).getAccessToken();
    } catch (error) {
      return {
        saved: false,
        message: refusal(error),
        connection: await this.google(),
      };
    }

    await this.audit.mutate({
      action: "settings_change",
      entityTable: "app_settings",
      entityId: "1",
      // Who and when, from the audit row itself. Nothing about the key.
      summary: "Set the Google Cloud key",
      module: "settings",
      read: async (tx) => {
        const [row] = await tx
          .select({ setAt: appSettings.googleKeySetAt })
          .from(appSettings)
          .where(eq(appSettings.id, 1))
          .limit(1);
        return row;
      },
      run: async (tx) => {
        await tx
          .update(appSettings)
          .set({
            googleServiceAccount: seal(JSON.stringify(account)),
            googleKeySetAt: new Date(),
            googleKeySetBy: actor.id,
            updatedAt: new Date(),
            updatedBy: actor.id,
          })
          .where(eq(appSettings.id, 1));
      },
    });

    return { saved: true, message: null, connection: await this.google() };
  }

  /**
   * Removes the key, and — if the assistant was going through Google — sends
   * it back to the Anthropic key. Left on Google with no key it would be off
   * for everybody, with a setting the screen no longer offers.
   */
  async clearGoogleKey(actor: AuthenticatedUser): Promise<GoogleConnection> {
    await this.audit.mutate({
      action: "settings_change",
      entityTable: "app_settings",
      entityId: "1",
      summary: "Removed the Google Cloud key",
      module: "settings",
      read: async (tx) => {
        const [row] = await tx
          .select({
            setAt: appSettings.googleKeySetAt,
            provider: appSettings.aiProvider,
          })
          .from(appSettings)
          .where(eq(appSettings.id, 1))
          .limit(1);
        return row;
      },
      run: async (tx) => {
        await tx
          .update(appSettings)
          .set({
            googleServiceAccount: null,
            googleKeySetAt: null,
            googleKeySetBy: null,
            aiProvider: "anthropic",
            updatedAt: new Date(),
            updatedBy: actor.id,
          })
          .where(eq(appSettings.id, 1));
      },
    });

    return this.google();
  }

  /**
   * The Test button: one tiny Claude request, and a look at each Google API.
   *
   * Each line stands on its own, so the owner sees which of the console steps
   * is still missing rather than one red light for all of them. Nothing is
   * written anywhere — the scopes could not allow it.
   */
  async testGoogle(): Promise<GoogleTestResult> {
    const row = await this.row();
    const account = openServiceAccount(row?.sealed);
    if (!account) {
      throw new BadRequestException("Add the Google Cloud key first.");
    }

    const region = row?.region || "global";
    const model: AiModel =
      AI_MODELS.find((offered) => offered === row?.model) ?? AI_MODELS[0];

    const [vertex, reads] = await Promise.all([
      this.checkVertex(account, region, model),
      this.checkReads(account),
    ]);
    return { checks: [vertex, ...reads] };
  }

  private async checkVertex(
    account: ServiceAccount,
    region: string,
    model: AiModel,
  ): Promise<GoogleCheck> {
    try {
      // One token, no retries: the point is the answer, and a button that
      // spins for a minute retrying a 404 is a worse answer.
      await vertexClient(account, region, {
        maxRetries: 0,
        timeout: 30_000,
      }).messages.create({
        model,
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      });
      return check(
        "vertex",
        true,
        `${AI_MODEL_LABELS[model]} answered, in the "${region}" region.`,
      );
    } catch (error) {
      const detail = explainClaudeError(error, "vertex", { model, region });
      if (!detail) {
        this.log.warn(`Vertex check failed: ${String(error)}`);
      }
      return check(
        "vertex",
        false,
        detail ?? "Could not reach Google Cloud. Try again in a moment.",
      );
    }
  }

  private async checkReads(account: ServiceAccount): Promise<GoogleCheck[]> {
    let token: string;
    try {
      token =
        (await googleAuth(account, GOOGLE_READ_SCOPES).getAccessToken()) ?? "";
    } catch (error) {
      const message = refusal(error);
      return (["sheets", "docs", "drive"] as const).map((id) =>
        check(id, false, message),
      );
    }

    const drive = await googleGet(
      token,
      "https://www.googleapis.com/drive/v3/files?" +
        new URLSearchParams({
          q: "trashed = false",
          pageSize: "100",
          fields: "files(id,name,mimeType)",
          supportsAllDrives: "true",
          includeItemsFromAllDrives: "true",
        }).toString(),
    );
    const files =
      drive.status === 200 && Array.isArray(drive.body?.files)
        ? (drive.body.files as { id: string; name: string; mimeType: string }[])
        : [];

    const sheet = files.find((file) => file.mimeType === SPREADSHEET);
    const doc = files.find((file) => file.mimeType === DOCUMENT);

    const [sheets, docs] = await Promise.all([
      googleGet(
        token,
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheet?.id ?? PROBE_ID)}?fields=properties.title`,
      ),
      googleGet(
        token,
        `https://docs.googleapis.com/v1/documents/${encodeURIComponent(doc?.id ?? PROBE_ID)}?fields=title`,
      ),
    ]);

    return [
      readCheck("sheets", "Google Sheets API", sheets, sheet?.name ?? null),
      readCheck("docs", "Google Docs API", docs, doc?.name ?? null),
      drive.status === 200
        ? check(
            "drive",
            true,
            files.length
              ? `${files.length === 100 ? "100 or more" : files.length} file${files.length === 1 ? "" : "s"} shared with it: ${files
                  .slice(0, 3)
                  .map((file) => file.name)
                  .join(", ")}${files.length > 3 ? ", …" : ""}.`
              : "Switched on. Nothing has been shared with the account yet — share a Sheet or Doc with the address above.",
          )
        : readCheck("drive", "Google Drive API", drive, null),
    ];
  }
}

function check(id: GoogleCheckId, ok: boolean, message: string): GoogleCheck {
  return { id, label: LABELS[id], ok, message };
}

/**
 * One API's answer, read.
 *
 * With a shared file to ask for, success is its title. Without one, the probe
 * id is asked for, and any refusal other than "disabled" or "bad key" proves
 * the API is on — a missing file is the expected answer.
 */
function readCheck(
  id: GoogleCheckId,
  api: string,
  reply: GoogleReply,
  name: string | null,
): GoogleCheck {
  if (reply.status === 200) {
    return check(id, true, name ? `Read "${name}".` : "Switched on.");
  }

  const error = (reply.body?.error ?? null) as Record<string, unknown> | null;
  const said = typeof error?.message === "string" ? error.message : "";

  if (reply.status === 0) {
    return check(id, false, "Could not reach Google. Try again in a moment.");
  }
  if (reply.status === 401) {
    return check(id, false, "Google refused the service-account key.");
  }
  if (
    reply.status === 403 &&
    /SERVICE_DISABLED|accessNotConfigured|has not been used|is disabled/i.test(
      JSON.stringify(error ?? {}),
    )
  ) {
    return check(
      id,
      false,
      `The ${api} is not switched on in the project. Enable it under APIs & Services, then test again.`,
    );
  }
  if (reply.status >= 500) {
    return check(id, false, "Google is not answering at the moment.");
  }
  if (!name) {
    return check(
      id,
      true,
      "Switched on. Nothing of this kind has been shared with the account yet.",
    );
  }
  return check(id, false, `Google said: ${said || `status ${reply.status}`}`);
}

/** A read-only GET. Status 0 means Google was not reached at all. */
async function googleGet(token: string, url: string): Promise<GoogleReply> {
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    return { status: response.status, body };
  } catch {
    return { status: 0, body: null };
  }
}

/**
 * Why Google would not issue a token, in words.
 *
 * Google's own reason is kept — "invalid_grant: Invalid JWT Signature" tells
 * an administrator the key was deleted — and it never contains the key.
 */
function refusal(error: unknown): string {
  const response = (error as { response?: { status?: number } }).response;
  if (!response) {
    return "Could not reach Google to check the key. Try again in a moment.";
  }
  const reason =
    error instanceof Error ? error.message.slice(0, 200) : "refused";
  return `Google refused this key (${reason}). It may have been deleted, or its project shut down. Make a new JSON key and paste that.`;
}
