/**
 * The model follows the conversation, and the route follows the model
 * (3 Oct 2026, piece B2's code).
 *
 * The owner: a model picked in the chat holds for that conversation, and
 * opening it again from History brings it back; a chat nobody switched
 * follows the default. The chat's picker lists every model that has a
 * working route now. Gemini goes through Google Cloud whichever way Claude is
 * set to go. These hold the service to that with stubbed rows: nothing here
 * reaches a model or a database.
 */
import { BadRequestException } from "@nestjs/common";
import type { AiIntakeReply, AiModel, Role } from "@finance/shared";

import type { AuthenticatedUser } from "../../common/decorators/auth.decorators";
import { AiIntakeService } from "./ai-intake.service";

const as = (role: Role): AuthenticatedUser => ({
  id: "00000000-0000-0000-0000-000000000001",
  email: `${role}@example.test`,
  fullName: role,
  role,
  tokenVersion: 0,
  mustChangePassword: false,
});

const ANTHROPIC = "sk-ant-api03-0000000000000000000000000000LTa4";
const GOOGLE = { client_email: "assistant@project.iam.gserviceaccount.com" };

type Stored = Record<string, unknown>;

/** A service with nothing behind it but the settings row a test hands it. */
function serviceWith(stored: Stored = {}) {
  const service = Object.create(AiIntakeService.prototype) as AiIntakeService;
  const inner = service as unknown as Record<string, unknown>;
  inner.storedKey = () =>
    Promise.resolve({
      key: ANTHROPIC,
      fromEnvironment: false,
      setAt: null,
      setBy: null,
      model: "claude-opus-5",
      dataAccess: "full",
      provider: "anthropic",
      google: GOOGLE,
      region: "global",
      instructions: "",
      ...stored,
    });
  return { service, inner };
}

type Route = { model: AiModel; provider: string };
const routeOf = (service: AiIntakeService, asked?: AiModel) =>
  (service as unknown as { route: (asked?: AiModel) => Promise<Route> }).route(
    asked,
  );

describe("the chat's picker: every model with a working route now", () => {
  it("lists Claude and every Gemini when both keys are there", async () => {
    const seen = await serviceWith().service.availability(as("cfo"));
    expect(seen.models).toEqual([
      "claude-opus-5",
      "gemini-3.8-flash",
      "gemini-3.1-pro-preview",
      "gemini-2.5-pro",
    ]);
    expect(seen.configured).toBe(true);
  });

  it("lists Claude alone with the Anthropic key alone", async () => {
    const seen = await serviceWith({ google: null }).service.availability(
      as("super_admin"),
    );
    expect(seen.models).toEqual(["claude-opus-5"]);
  });

  it("lists the Geminis alone when Claude's route has no key", async () => {
    const seen = await serviceWith({
      key: null,
      model: "gemini-3.8-flash",
    }).service.availability(as("cfo"));
    expect(seen.models).toEqual([
      "gemini-3.8-flash",
      "gemini-3.1-pro-preview",
      "gemini-2.5-pro",
    ]);
    expect(seen.configured).toBe(true);
  });

  it("is off while the default cannot answer, and says which key is missing", async () => {
    // The Google key is there, but the owner's default is Claude and its
    // route has no key: not quietly put to a model nobody chose.
    const seen = await serviceWith({ key: null }).service.availability(
      as("super_admin"),
    );
    expect(seen.configured).toBe(false);
    expect(seen.reason).toMatch(
      /^Claude is set to go through an Anthropic key, and none has been added\. A Super Admin can add one in the Assistant's settings\./,
    );
    expect(seen.reason).not.toMatch(/Settings →|Settings,/);
  });

  it("names a Gemini default's missing key as Google's", async () => {
    const seen = await serviceWith({
      google: null,
      model: "gemini-3.8-flash",
    }).service.availability(as("super_admin"));
    expect(seen.configured).toBe(false);
    expect(seen.reason).toMatch(
      /^Gemini 3\.8 Flash goes through Google Cloud, and no Google Cloud key has been added\./,
    );
  });
});

describe("the route follows the model", () => {
  it("sends a Gemini through Google Cloud while Claude goes by the Anthropic key", async () => {
    const { service } = serviceWith({ provider: "anthropic" });
    expect(await routeOf(service, "gemini-3.8-flash")).toMatchObject({
      model: "gemini-3.8-flash",
      provider: "vertex",
    });
    expect(await routeOf(service, "claude-opus-5")).toMatchObject({
      model: "claude-opus-5",
      provider: "anthropic",
    });
  });

  it("sends Claude through Google Cloud when the settings say so", async () => {
    const { service } = serviceWith({ provider: "vertex", key: null });
    expect(await routeOf(service, "claude-opus-5")).toMatchObject({
      provider: "vertex",
    });
  });

  it("puts a turn that names no model to the default", async () => {
    const { service } = serviceWith({ model: "gemini-3.1-pro-preview" });
    expect(await routeOf(service)).toMatchObject({
      model: "gemini-3.1-pro-preview",
      provider: "vertex",
    });
  });

  it("refuses a picked model that cannot be reached, in words, and swaps it for nothing", async () => {
    const { service } = serviceWith({ google: null });
    const refused = await routeOf(service, "gemini-3.8-flash").catch(
      (error: unknown) => error,
    );
    expect(refused).toBeInstanceOf(BadRequestException);
    expect((refused as Error).message).toBe(
      "Gemini 3.8 Flash goes through Google Cloud, and no Google Cloud key has been added. A Super Admin can add one in the Assistant's settings. Pick another model in the chat.",
    );
  });
});

describe("a turn keeps the model picked for its conversation", () => {
  /** The turn, with the model's answer stubbed and the history recorded. */
  function turnWith(stored: Stored = {}) {
    const { service, inner } = serviceWith(stored);
    const recorded: unknown[][] = [];
    const thought: Route[] = [];
    inner.think = (_input: unknown, _actor: unknown, route: Route) => {
      thought.push(route);
      return Promise.resolve({
        summary: "Done.",
        model: route.model,
      } as unknown as AiIntakeReply);
    };
    inner.chats = {
      record: (...args: unknown[]) => {
        recorded.push(args);
        return Promise.resolve("00000000-0000-4000-8000-000000000001");
      },
    };
    inner.attachments = { attachToChat: () => Promise.resolve() };
    // What it spends (B3): under any limit, and counted nowhere here.
    inner.usage = {
      assertUnderLimit: () => Promise.resolve(),
      record: () => Promise.resolve(),
      summary: () => Promise.resolve(undefined),
    };
    return { service, recorded, thought };
  }
  const messages = [{ role: "user" as const, content: "kemon acho" }];

  it("puts the turn to the picked model and keeps it on the conversation", async () => {
    const { service, recorded, thought } = turnWith();
    await service.turn(
      { messages, model: "gemini-3.8-flash" },
      as("super_admin"),
    );
    expect(thought[0]).toMatchObject({
      model: "gemini-3.8-flash",
      provider: "vertex",
    });
    expect(recorded[0][4]).toBe("gemini-3.8-flash");
  });

  it("leaves a conversation nobody switched following the default", async () => {
    const { service, recorded, thought } = turnWith();
    await service.turn({ messages }, as("cfo"));
    expect(thought[0]).toMatchObject({ model: "claude-opus-5" });
    expect(recorded[0][4]).toBeUndefined();
  });

  it("asks nothing of any model, and records nothing, for a model it cannot reach", async () => {
    const { service, recorded, thought } = turnWith({ google: null });
    await expect(
      service.turn({ messages, model: "gemini-2.5-pro" }, as("cfo")),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(thought).toEqual([]);
    expect(recorded).toEqual([]);
  });
});

describe("the default, set in the Assistant's settings", () => {
  it("may be a Gemini while Claude goes by the Anthropic key (no longer a pair refused)", async () => {
    const { service, inner } = serviceWith({ provider: "anthropic" });
    const writes: unknown[] = [];
    inner.audit = {
      mutate: (change: unknown) => {
        writes.push(change);
        return Promise.resolve();
      },
    };
    inner.availability = () => Promise.resolve({ configured: true });
    await service.updateSettings(
      { model: "gemini-3.8-flash" },
      as("super_admin"),
    );
    expect(writes).toHaveLength(1);
    expect((writes[0] as { summary: string }).summary).toBe(
      "Changed the assistant's default model to gemini-3.8-flash",
    );
  });

  it("is never a Gemini with no Google key to reach it", async () => {
    const { service, inner } = serviceWith({ google: null });
    inner.audit = {
      mutate: () => Promise.reject(new Error("must not be written")),
    };
    await expect(
      service.updateSettings({ model: "gemini-3.8-flash" }, as("super_admin")),
    ).rejects.toThrow(
      "Gemini 3.8 Flash goes through Google Cloud. Add the Google Cloud key first, under Google Cloud in the Assistant's settings.",
    );
  });
});
