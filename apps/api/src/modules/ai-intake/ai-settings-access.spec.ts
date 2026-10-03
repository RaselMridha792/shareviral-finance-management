/**
 * What the CFO sees behind the Assistant's settings (3 Oct 2026, piece B2's
 * permission change, pushed alone).
 *
 * The owner: the CFO sees everything behind the settings icon — the route,
 * the model, how much it may read, the instructions and the recent mistakes —
 * and changes nothing. Never a key, a key's hint, or who set it. These read
 * the controller's own gates, and the service's answers, and fail when
 * either opens a write or lets the hint out.
 */
import { RequestMethod, type Type } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { hasPermission, type Role } from "@finance/shared";

import {
  PERMISSIONS_KEY,
  type AuthenticatedUser,
} from "../../common/decorators/auth.decorators";
import { AiIntakeController } from "./ai-intake.controller";
import { AiIntakeService } from "./ai-intake.service";

type Handler = (...args: unknown[]) => unknown;

/** Every handler on the controller, as "VERB /path" → its permissions. */
function gates(controller: Type): Map<string, string[]> {
  const prefix = String(Reflect.getMetadata(PATH_METADATA, controller) ?? "");
  const proto = controller.prototype as Record<string, Handler>;
  const out = new Map<string, string[]>();
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (name === "constructor") continue;
    const handler = proto[name];
    const verb = Reflect.getMetadata(METHOD_METADATA, handler) as
      RequestMethod | undefined;
    if (verb === undefined) continue;
    const own = String(Reflect.getMetadata(PATH_METADATA, handler) ?? "");
    const route = [prefix, own]
      .map((part) => part.replace(/^\/+|\/+$/g, ""))
      .filter(Boolean)
      .join("/");
    out.set(
      `${RequestMethod[verb]} /${route}`,
      (Reflect.getMetadata(PERMISSIONS_KEY, handler) as string[]) ?? [],
    );
  }
  return out;
}

const GATES = gates(AiIntakeController);

/** What sits behind the settings icon, to read. */
const READS = [
  "GET /ai/availability",
  "GET /ai/instructions",
  "GET /ai/mistakes",
  "GET /ai/knowledge",
];

/** Every change to the Assistant's settings. */
const WRITES = [
  "POST /ai/key",
  "DELETE /ai/key",
  "PATCH /ai/settings",
  "PUT /ai/instructions",
  "POST /ai/mistakes/:id/rule",
  "DELETE /ai/mistakes/:id",
];

const as = (role: Role): AuthenticatedUser => ({
  id: "00000000-0000-0000-0000-000000000001",
  email: `${role}@example.test`,
  fullName: role,
  role,
  tokenVersion: 0,
  mustChangePassword: false,
});

describe("the Assistant's settings: the CFO reads, and changes nothing", () => {
  it("knows every route it is asked about", () => {
    for (const route of [...READS, ...WRITES]) {
      expect([route, GATES.has(route)]).toEqual([route, true]);
    }
  });

  it("opens each read to whoever may use the Assistant", () => {
    for (const route of READS) {
      expect([route, GATES.get(route)]).toEqual([route, ["ai.use"]]);
    }
  });

  it("keeps each write to the Super Admin", () => {
    for (const route of WRITES) {
      expect([route, GATES.get(route)]).toEqual([route, ["settings.write"]]);
    }
  });

  it("and nothing on the controller is left ungated", () => {
    for (const [route, permissions] of GATES) {
      expect([route, permissions.length > 0]).toEqual([route, true]);
    }
  });

  it("which, on the matrix, is: the CFO reads, HR does neither", () => {
    expect(hasPermission("cfo", "ai.use")).toBe(true);
    expect(hasPermission("cfo", "settings.write")).toBe(false);
    expect(hasPermission("hr", "ai.use")).toBe(false);
    expect(hasPermission("super_admin", "settings.write")).toBe(true);
  });
});

/** A service with nothing behind it but the rows a test hands it. */
function serviceWith(stub: {
  stored?: Record<string, unknown>;
  mistakes?: Array<Record<string, unknown>>;
}): AiIntakeService {
  const service = Object.create(AiIntakeService.prototype) as AiIntakeService;
  const inner = service as unknown as Record<string, unknown>;
  inner.storedKey = () =>
    Promise.resolve({
      key: "sk-ant-api03-0000000000000000000000000000LTa4",
      fromEnvironment: false,
      setAt: new Date("2026-10-02T10:00:00Z"),
      setBy: "The Owner",
      model: "claude-opus-5",
      dataAccess: "full",
      provider: "anthropic",
      google: null,
      region: "global",
      instructions: "",
      ...stub.stored,
    });
  const query = {
    from: () => query,
    leftJoin: () => query,
    orderBy: () => query,
    limit: () => Promise.resolve(stub.mistakes ?? []),
  };
  inner.db = { client: { select: () => query } };
  return service;
}

describe("availability: the key's description only to whoever may change it", () => {
  it("gives the Super Admin the hint, when it was set and by whom", async () => {
    const seen = await serviceWith({}).availability(as("super_admin"));
    expect(seen.keyHint).toMatch(/LTa4$/);
    expect(seen.setBy).toBe("The Owner");
    expect(seen.setAt).toBe("2026-10-02T10:00:00.000Z");
  });

  it("gives the CFO the route and the model, and no hint, date or name", async () => {
    const seen = await serviceWith({}).availability(as("cfo"));
    expect(seen).toMatchObject({
      configured: true,
      model: "claude-opus-5",
      dataAccess: "full",
      provider: "anthropic",
      keyHint: null,
      setAt: null,
      setBy: null,
      fromEnvironment: false,
    });
    expect(JSON.stringify(seen)).not.toMatch(/LTa4|sk-ant|The Owner/);
  });

  it("nor a key from the environment", async () => {
    const seen = await serviceWith({
      stored: { fromEnvironment: true, setAt: null, setBy: null },
    }).availability(as("cfo"));
    expect([seen.keyHint, seen.fromEnvironment, seen.configured]).toEqual([
      null,
      false,
      true,
    ]);
  });
});

describe("the mistakes: read by the CFO, each only about a part they may read", () => {
  const row = (id: string, over: Record<string, unknown>) => ({
    id,
    kind: "reply",
    target: null,
    area: null,
    said: "asked",
    field: null,
    drafted: 'said "no"',
    corrected: "right",
    model: "claude-opus-5",
    ruledAt: null,
    by: "Somebody",
    at: new Date("2026-10-03T08:00:00Z"),
    ...over,
  });
  const ROWS = [
    row("team", { area: "team" }),
    row("accounts", { area: "accounts" }),
    row("plan", { kind: "field", target: "subscription", field: "toolName" }),
    row("nowhere", {}),
  ];
  const ids = async (role: Role) =>
    (await serviceWith({ mistakes: ROWS }).mistakes(as(role))).map((m) => m.id);

  it("the Super Admin sees every one, the one placed nowhere too", async () => {
    expect(await ids("super_admin")).toEqual([
      "team",
      "accounts",
      "plan",
      "nowhere",
    ]);
  });

  it("the CFO, who reads every part, sees every one placed in a part", async () => {
    expect(await ids("cfo")).toEqual(["team", "accounts", "plan"]);
  });

  it("a role without a part's read would not see that part's", async () => {
    // HR does not hold `ai.use`; the guard refuses it before this runs. The
    // filter is measured on it because it is the role that reads Team and
    // not Accounts — the shape a later role given the Assistant could take.
    expect(hasPermission("hr", "team.read")).toBe(true);
    expect(hasPermission("hr", "accounts.read")).toBe(false);
    const seen = await ids("hr");
    expect(seen).toContain("team");
    expect(seen).not.toContain("accounts");
    expect(seen).not.toContain("nowhere");
  });
});
