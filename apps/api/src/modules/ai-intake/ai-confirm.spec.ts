/**
 * Confirm and save (3 Oct 2026, piece A4), held to the forms it saves as.
 *
 * The brief: a confirmed draft is saved "through the same endpoint, schema,
 * permissions and audit trail as the form". The save does not go over HTTP,
 * so nothing would notice if a form's endpoint changed its schema or its
 * permission and the Assistant's copy did not. These read the controllers
 * themselves and fail when the two part.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { RequestMethod, type Type } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import {
  AI_TARGETS,
  AI_TARGET_ENDPOINT,
  AI_TARGET_PERMISSION,
  type AiTarget,
} from "@finance/shared";

import { PERMISSIONS_KEY } from "../../common/decorators/auth.decorators";
import { SubscriptionsController } from "../subscriptions/subscriptions.controller";
import { TdsController } from "../tds/tds.controller";
import { TeamMembersController } from "../team-members/team-members.controller";
import { TransactionsController } from "../transactions/transactions.controller";
import { VendorsController } from "../vendors/vendors.controller";
import { savedLine } from "./ai-confirm.service";
import { APP_MAP } from "./app-map";

/**
 * The endpoint each kind of record is saved as, in the order its form sends
 * them, and the schema its body is read with. A new plan is two: the plan,
 * then its first payment, as the Add subscription form does.
 */
const SAVED_AS: Record<
  AiTarget,
  Array<{ controller: Type; method: string; schema: string }>
> = {
  transaction_out: [
    {
      controller: TransactionsController,
      method: "create",
      schema: "createTransactionSchema",
    },
  ],
  transaction_in: [
    {
      controller: TransactionsController,
      method: "create",
      schema: "createTransactionSchema",
    },
  ],
  transfer: [
    {
      controller: TransactionsController,
      method: "transfer",
      schema: "transferSchema",
    },
  ],
  subscription: [
    {
      controller: SubscriptionsController,
      method: "create",
      schema: "createSubscriptionSchema",
    },
    {
      controller: TransactionsController,
      method: "paySubscription",
      schema: "paySubscriptionSchema",
    },
  ],
  subscription_payment: [
    {
      controller: TransactionsController,
      method: "paySubscription",
      schema: "paySubscriptionSchema",
    },
  ],
  vendor: [
    {
      controller: VendorsController,
      method: "create",
      schema: "createVendorSchema",
    },
  ],
  team_member: [
    {
      controller: TeamMembersController,
      method: "create",
      schema: "createTeamMemberSchema",
    },
  ],
  tds_deposit: [
    {
      controller: TdsController,
      method: "createDeposit",
      schema: "createTdsDepositSchema",
    },
  ],
};

type Handler = (...args: unknown[]) => unknown;

function routeOf(controller: Type, method: string): string {
  const handler = (controller.prototype as Record<string, Handler>)[method];
  const prefix = String(Reflect.getMetadata(PATH_METADATA, controller) ?? "");
  const own = String(Reflect.getMetadata(PATH_METADATA, handler) ?? "");
  const verb = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod;
  const joined = [prefix, own]
    .map((part) => part.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
  return `${RequestMethod[verb]} /${joined}`;
}

function permissionsOf(controller: Type, method: string): string[] {
  const handler = (controller.prototype as Record<string, Handler>)[method];
  return (Reflect.getMetadata(PERMISSIONS_KEY, handler) as string[]) ?? [];
}

const SERVICE = readFileSync(
  path.join(__dirname, "ai-confirm.service.ts"),
  "utf8",
);

describe("Confirm and save is the form's own save", () => {
  it.each(AI_TARGETS)("%s is saved as the endpoint the map names", (target) => {
    const [first] = SAVED_AS[target];
    expect(routeOf(first.controller, first.method)).toBe(
      `POST ${AI_TARGET_ENDPOINT[target]}`,
    );
  });

  it.each(AI_TARGETS)(
    "%s asks for exactly the permissions its endpoints ask for",
    (target) => {
      const asked = new Set(
        SAVED_AS[target].flatMap((one) =>
          permissionsOf(one.controller, one.method),
        ),
      );
      expect([...asked].sort()).toEqual(
        [...AI_TARGET_PERMISSION[target]].sort(),
      );
    },
  );

  it.each(AI_TARGETS)(
    "%s is read with the schema its endpoint reads it with",
    (target) => {
      for (const one of SAVED_AS[target]) {
        const route = routeOf(one.controller, one.method);
        // The controller's own: `@ZodBody(<schema>)` on this method.
        const source = readFileSync(
          path.join(
            __dirname,
            "..",
            route.split("/")[1] === "tds"
              ? "tds/tds.controller.ts"
              : one.controller === TransactionsController
                ? "transactions/transactions.controller.ts"
                : one.controller === SubscriptionsController
                  ? "subscriptions/subscriptions.controller.ts"
                  : one.controller === VendorsController
                    ? "vendors/vendors.controller.ts"
                    : "team-members/team-members.controller.ts",
          ),
          "utf8",
        );
        const declared = new RegExp(
          `\\s${one.method}\\(\\s*(?:@Param\\([^)]*\\)\\s*\\w+:\\s*\\w+,\\s*)?@ZodBody\\((\\w+)\\)`,
        ).exec(source)?.[1];
        expect(declared).toBe(one.schema);
        // And the Assistant's save reads it with the same one.
        expect(SERVICE).toContain(`parse(${one.schema},`);
      }
    },
  );

  it("offers nothing but creating: no void, delete, finalise, pay run, settings or sign-in", () => {
    for (const target of AI_TARGETS) {
      expect(AI_TARGET_ENDPOINT[target]).not.toMatch(
        /void|delete|trash|finali[sz]e|payroll|settings|users|auth/i,
      );
    }
    // The parts where those live draft nothing, and point to their screens.
    for (const key of ["payroll", "settings"]) {
      const part = APP_MAP.find((one) => one.key === key);
      expect(part?.assistant.drafts).toEqual([]);
      expect(part?.assistant.otherwise).toMatch(/I cannot/);
    }
  });
});

describe("what the chat says after a save", () => {
  it("names a payment, its number, its account and where it shows", () => {
    expect(
      savedLine(
        "transaction_out",
        {
          amount: "4500",
          accountName: "City Bank",
          categoryName: "Courier",
        },
        "TXN-2026-000412",
      ),
    ).toBe(
      "Saved — money going out, TXN-2026-000412: ৳4,500.00 from City Bank, under Courier. It shows under All transactions.",
    );
  });

  it("names a transfer by both accounts", () => {
    expect(
      savedLine(
        "transfer",
        { amount: "100", fromAccountName: "Cash", toAccountName: "City Bank" },
        "TXN-2026-000413",
      ),
    ).toBe(
      "Saved — money moved between our own accounts, TXN-2026-000413: ৳100.00 from Cash to City Bank. It shows under Money Transfer.",
    );
  });

  it("names a plan and its first payment, keeping AI in capitals", () => {
    expect(
      savedLine(
        "subscription",
        { toolName: "Cursor", planName: "Pro", costUsd: "20" },
        "TXN-2026-000414",
      ),
    ).toBe(
      "Saved — a new plan under AI tools and subscriptions: Cursor, Pro, $20.00, its first payment TXN-2026-000414. It shows under AI tools and subscriptions.",
    );
  });

  it("says a plan whose payment was refused is saved, and what to do", () => {
    const line = savedLine(
      "subscription",
      { toolName: "Cursor", planName: "Pro", costUsd: "20" },
      null,
      "The plan is saved, but its first payment did not go through: That month is locked. Use Renew on its row to take the money out.",
    );
    expect(line).not.toMatch(/its first payment TXN/);
    expect(line).toMatch(/Use Renew on its row/);
  });

  it("says where a challan and a vendor really show", () => {
    expect(
      savedLine(
        "tds_deposit",
        { challanNumber: "A-123", amount: "10000" },
        "TXN-2026-000415",
      ),
    ).toBe(
      "Saved — a TDS challan, TXN-2026-000415: challan A-123, ৳10,000.00. Its payment shows under All transactions; the TDS screen lists no challans.",
    );
    expect(savedLine("vendor", { name: "Sundarban Courier" }, null)).toBe(
      "Saved — a vendor: Sundarban Courier. No screen lists vendors today.",
    );
  });

  it("names a person by their name, with no number", () => {
    expect(savedLine("team_member", { fullName: "Rahim Uddin" }, null)).toBe(
      "Saved — someone on the team: Rahim Uddin. It shows under Team.",
    );
  });

  it("writes a figure it cannot read as it was given, not as a crash", () => {
    expect(
      savedLine(
        "transaction_in",
        { amount: "lots", accountName: "Cash" },
        "TXN-1",
      ),
    ).toBe(
      "Saved — money coming in, TXN-1: lots into Cash. It shows under All transactions.",
    );
  });
});
