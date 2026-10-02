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

import {
  PERMISSIONS_KEY,
  type AuthenticatedUser,
} from "../../common/decorators/auth.decorators";
import { SubscriptionsController } from "../subscriptions/subscriptions.controller";
import { TdsController } from "../tds/tds.controller";
import { TeamMembersController } from "../team-members/team-members.controller";
import { TransactionsController } from "../transactions/transactions.controller";
import { VendorsController } from "../vendors/vendors.controller";
import { AiConfirmService, savedLine } from "./ai-confirm.service";
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

/*
 * "Added by the assistant" on every ledger row Confirm writes (A4b).
 *
 * Before A4b only a plain payment said so: a transfer, a plan's payment and a
 * challan's payment were written by their own services as "Entered by hand"
 * or "From a tax payment", and the Assistant's batch could not be found by
 * its origin. Each save is followed to the service it calls, which must be
 * told the origin; the services' own use of it is measured against the
 * database by .assistantoriginqa.mjs.
 */
describe("everything Confirm saves is added by the assistant", () => {
  const ACCOUNT = "11111111-1111-4111-8111-111111111111";
  const OTHER = "22222222-2222-4222-8222-222222222222";
  const CATEGORY = "33333333-3333-4333-8333-333333333333";
  const PLAN = "44444444-4444-4444-8444-444444444444";
  const DAY = "2026-10-01";
  const actor = {
    id: "55555555-5555-4555-8555-555555555555",
  } as AuthenticatedUser;

  function confirmed(target: AiTarget, body: Record<string, unknown>) {
    const transactions = {
      create: jest.fn(() => Promise.resolve({ id: "t1", refNo: "TXN-1" })),
      transfer: jest.fn(() => Promise.resolve({ id: "t2", refNo: "TXN-2" })),
      payForSubscription: jest.fn(() =>
        Promise.resolve({ id: "t3", refNo: "TXN-3" }),
      ),
      findOne: jest.fn(() => Promise.resolve({ id: "t4", refNo: "TXN-4" })),
    };
    const subscriptions = {
      create: jest.fn(() => Promise.resolve({ id: PLAN, startDate: DAY })),
    };
    const tds = {
      createDeposit: jest.fn(() =>
        Promise.resolve({ id: "d1", transactionId: "t4" }),
      ),
    };
    const chats = {
      get: jest.fn(() => Promise.resolve({ reply: { target, area: null } })),
      markSaved: jest.fn(() => Promise.resolve()),
    };
    const intake = {
      readyToSave: jest.fn(() => Promise.resolve({ body, draft: {} })),
      learn: jest.fn(() => Promise.resolve({ recorded: 0 })),
    };
    const service = new AiConfirmService(
      chats as never,
      intake as never,
      transactions as never,
      subscriptions as never,
      {} as never,
      {} as never,
      tds as never,
    );
    return {
      done: service.confirm({ chatId: PLAN, draft: {} }, actor),
      transactions,
      tds,
    };
  }

  it("a payment, even when its body says otherwise", async () => {
    const { done, transactions } = confirmed("transaction_out", {
      direction: "out",
      amount: "640",
      accountId: ACCOUNT,
      categoryId: CATEGORY,
      usdRate: "122.5",
      txnDate: DAY,
      description: "Courier",
      createdVia: "manual",
    });
    await done;
    expect(transactions.create).toHaveBeenCalledWith(
      expect.objectContaining({ createdVia: "ai_intake" }),
      actor,
    );
  });

  it("a transfer, both halves told", async () => {
    const { done, transactions } = confirmed("transfer", {
      fromAccountId: ACCOUNT,
      toAccountId: OTHER,
      amount: "100",
      usdRate: "122.5",
      txnDate: DAY,
      description: "Transfer from Cash to City Bank",
    });
    await done;
    expect(transactions.transfer).toHaveBeenCalledWith(
      expect.objectContaining({ amount: "100" }),
      actor,
      { createdVia: "ai_intake" },
    );
  });

  it("a plan's renewal", async () => {
    const { done, transactions } = confirmed("subscription_payment", {
      subscriptionId: PLAN,
      txnDate: DAY,
      advanceRenewal: true,
    });
    await done;
    expect(transactions.payForSubscription).toHaveBeenCalledWith(
      PLAN,
      expect.objectContaining({ txnDate: DAY }),
      actor,
      { createdVia: "ai_intake" },
    );
  });

  it("a new plan's first payment", async () => {
    const { done, transactions } = confirmed("subscription", {
      toolName: "Cursor",
      planName: "Pro",
      category: "ai_tool",
      costUsd: "20",
      usdRate: "122.5",
      startDate: DAY,
      accountId: ACCOUNT,
    });
    await done;
    expect(transactions.payForSubscription).toHaveBeenCalledWith(
      PLAN,
      expect.objectContaining({ txnDate: DAY, advanceRenewal: false }),
      actor,
      { createdVia: "ai_intake" },
    );
  });

  it("a challan's payment", async () => {
    const { done, tds } = confirmed("tds_deposit", {
      challanNumber: "A-123",
      challanDate: DAY,
      depositDate: DAY,
      amount: "500",
      periodYear: 2026,
      periodMonth: 9,
      accountId: ACCOUNT,
      usdRate: "122.5",
    });
    await done;
    expect(tds.createDeposit).toHaveBeenCalledWith(
      expect.objectContaining({ challanNumber: "A-123" }),
      actor,
      { createdVia: "ai_intake" },
    );
  });
});
