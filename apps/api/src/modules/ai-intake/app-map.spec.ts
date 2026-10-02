/**
 * The map of the app the Assistant is given, held to the app itself
 * (2 Oct 2026).
 *
 * A map written once and left alone goes stale the way the old prompt did:
 * it still called a tool "a vendor" long after the vendors screen was gone.
 * So this reads the repository — the module folders, the controllers' own
 * routes, the web app's pages — and fails when the map names something that
 * is not there, or leaves out something that is.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import {
  AI_TARGETS,
  AI_TARGET_ENDPOINT,
  AI_TARGET_SHOWS_ON,
  PERMISSIONS,
} from "@finance/shared";

import {
  APP_MAP,
  APP_PART_KEYS,
  NOT_A_FORM,
  NOT_A_PART,
  NOT_A_SCREEN,
  allForms,
  fieldsOf,
  partOf,
  partsDrafting,
  renderAppMap,
  screenOf,
} from "./app-map";
import { AI_TOOL_DEFINITIONS } from "./ai-tools";

const MODULES = path.join(__dirname, "..");
const PAGES = path.join(__dirname, "../../../../web/src/app/(dashboard)");

const folders = readdirSync(MODULES).filter((name) =>
  statSync(path.join(MODULES, name)).isDirectory(),
);

/** Every route the API declares, as "POST /subscriptions/:id/pay". */
function routes(): Set<string> {
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".controller.ts")) {
        const source = readFileSync(full, "utf8");
        const prefix = /@Controller\((?:"([^"]*)")?\)/.exec(source)?.[1] ?? "";
        for (const match of source.matchAll(
          /@(Get|Post|Patch|Put|Delete)\((?:"([^"]*)")?\)/g,
        )) {
          const route = [prefix, match[2] ?? ""].filter(Boolean).join("/");
          found.add(`${match[1].toUpperCase()} /${route}`);
        }
      }
    }
  };
  walk(MODULES);
  return found;
}

/** Whether the web app has a page at this address. */
function hasPage(href: string): boolean {
  return existsSync(path.join(PAGES, href, "page.tsx"));
}

/** Every page of the web app behind sign-in, as "/payroll/[runId]". */
function pages(): string[] {
  const found: string[] = [];
  const walk = (dir: string, href: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full, `${href}/${name}`);
      else if (name === "page.tsx") found.push(href || "/");
    }
  };
  walk(PAGES, "");
  return found;
}

/**
 * Every request that changes something, by the module that declares it:
 * "POST /subscriptions/:id/pay" under `transactions`.
 */
function writes(): Map<string, string> {
  const found = new Map<string, string>();
  for (const folder of folders) {
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (name.endsWith(".controller.ts")) {
          const source = readFileSync(full, "utf8");
          const prefix =
            /@Controller\((?:"([^"]*)")?\)/.exec(source)?.[1] ?? "";
          for (const match of source.matchAll(
            /@(Post|Patch|Put|Delete)\((?:"([^"]*)")?\)/g,
          )) {
            const route = [prefix, match[2] ?? ""].filter(Boolean).join("/");
            found.set(`${match[1].toUpperCase()} /${route}`, folder);
          }
        }
      }
    };
    walk(path.join(MODULES, folder));
  }
  return found;
}

describe("every part of the app is on the map", () => {
  it("has an entry for every module, or says why a module is not a part", () => {
    const spokenFor = new Set(APP_MAP.flatMap((part) => part.modules));

    for (const folder of folders) {
      expect([folder, spokenFor.has(folder) || folder in NOT_A_PART]).toEqual([
        folder,
        true,
      ]);
    }
  });

  it("names no module that is not there", () => {
    const named = [
      ...APP_MAP.flatMap((part) => part.modules),
      ...Object.keys(NOT_A_PART),
    ];
    for (const folder of named) {
      expect([folder, folders.includes(folder)]).toEqual([folder, true]);
    }
    // And none is both a part and plumbing.
    for (const part of APP_MAP) {
      for (const folder of part.modules) {
        expect([folder, folder in NOT_A_PART]).toEqual([folder, false]);
      }
    }
  });

  it("gives each part a key of its own", () => {
    expect(new Set(APP_PART_KEYS).size).toBe(APP_PART_KEYS.length);
    for (const key of APP_PART_KEYS) expect(key).toMatch(/^[a-z_]+$/);
  });

  it("says what each part is for, what it keeps and what to say otherwise", () => {
    for (const part of APP_MAP) {
      expect([part.key, part.purpose.length > 40]).toEqual([part.key, true]);
      expect([part.key, part.keeps.length > 0]).toEqual([part.key, true]);
      expect([part.key, part.assistant.otherwise.length > 20]).toEqual([
        part.key,
        true,
      ]);
      if (part.permission) expect(PERMISSIONS).toContain(part.permission);
    }
  });
});

describe("what the map names is really there", () => {
  it("names only screens the web app has", () => {
    for (const part of APP_MAP) {
      for (const screen of part.screens) {
        expect([part.key, screen.href, hasPage(screen.href)]).toEqual([
          part.key,
          screen.href,
          true,
        ]);
      }
    }
  });

  it("names only endpoints a controller declares", () => {
    const declared = routes();
    for (const part of APP_MAP) {
      for (const endpoint of part.recordedBy) {
        expect([part.key, endpoint, declared.has(endpoint)]).toEqual([
          part.key,
          endpoint,
          true,
        ]);
      }
    }
  });

  it("sends a saved record to a page that exists", () => {
    for (const target of AI_TARGETS) {
      const shows = AI_TARGET_SHOWS_ON[target];
      if (shows) {
        expect([target, hasPage(shows.href)]).toEqual([target, true]);
      }
    }
    // A plan, and its renewal, show on the page the owner looked for them on.
    expect(AI_TARGET_SHOWS_ON.subscription?.href).toBe("/subscriptions");
    expect(AI_TARGET_SHOWS_ON.subscription_payment?.href).toBe(
      "/subscriptions",
    );
  });
});

describe("every page and every form is on the map (A2b)", () => {
  const screens = new Set(
    APP_MAP.flatMap((part) => part.screens.map((screen) => screen.href)),
  );

  it("has every page as a part's screen, or says why it is not one", () => {
    for (const page of pages()) {
      expect([page, screens.has(page) || page in NOT_A_SCREEN]).toEqual([
        page,
        true,
      ]);
    }
    for (const page of Object.keys(NOT_A_SCREEN)) {
      expect([page, hasPage(page), screens.has(page)]).toEqual([
        page,
        true,
        false,
      ]);
    }
  });

  it("names every request that changes something in a form, or says why not", () => {
    const named = new Set(allForms().flatMap(({ form }) => form.saves));
    for (const [endpoint, folder] of writes()) {
      if (folder in NOT_A_PART) continue;
      expect([
        endpoint,
        folder,
        named.has(endpoint) || endpoint in NOT_A_FORM,
      ]).toEqual([endpoint, folder, true]);
    }
  });

  it("names only requests a controller declares", () => {
    const declared = writes();
    for (const { part, form } of allForms()) {
      for (const endpoint of form.saves) {
        expect([part.key, form.name, endpoint, declared.has(endpoint)]).toEqual(
          [part.key, form.name, endpoint, true],
        );
      }
    }
    for (const endpoint of Object.keys(NOT_A_FORM)) {
      expect([endpoint, declared.has(endpoint)]).toEqual([endpoint, true]);
    }
  });

  it("puts each form on a screen of the map, and says what it does", () => {
    for (const { part, form } of allForms()) {
      expect([part.key, form.name, screens.has(form.on)]).toEqual([
        part.key,
        form.name,
        true,
      ]);
      expect([form.name, form.saves.length > 0]).toEqual([form.name, true]);
      expect([form.name, form.opens.length > 3]).toEqual([form.name, true]);
      expect([form.name, form.onSave.length > 15]).toEqual([form.name, true]);
      if (form.permission) expect(PERMISSIONS).toContain(form.permission);
    }
  });

  it("explains only fields the form's schema has", () => {
    for (const { form } of allForms()) {
      if (!form.schema) continue;
      const fields = fieldsOf(form).map((field) => field.name);
      // A schema the map cannot read its fields from is no help to it.
      expect([form.name, fields.length > 0]).toEqual([form.name, true]);
      for (const field of Object.keys(form.fields ?? {})) {
        expect([form.name, field, fields.includes(field)]).toEqual([
          form.name,
          field,
          true,
        ]);
      }
    }
  });

  it("gives every kind of draft the form whose endpoint saves it", () => {
    for (const target of AI_TARGETS) {
      const drafting = allForms().filter(({ form }) => form.draft === target);
      expect([target, drafting.length > 0]).toEqual([target, true]);
      for (const { form } of drafting) {
        expect([target, form.saves]).toEqual([
          target,
          expect.arrayContaining([`POST ${AI_TARGET_ENDPOINT[target]}`]),
        ]);
      }
    }
  });

  it("writes each form into the map the model reads, with its fields", () => {
    const rendered = renderAppMap();
    for (const { form } of allForms()) {
      expect(rendered).toContain(`"${form.name}"`);
    }
    // A form it drafts points to that kind's own list, not a second copy.
    const subscriptions = rendered.slice(
      rendered.indexOf("[subscriptions]"),
      rendered.indexOf("[vendors]"),
    );
    expect(subscriptions).toMatch(
      /Fields: those of subscription under EVERY FIELD\./,
    );
    // Any other form lists what its Save needs, generated from its schema.
    const advice = rendered.slice(
      rendered.indexOf("[bank_advice]"),
      rendered.indexOf("[hr_requests]"),
    );
    expect(advice).toMatch(/paymentType\*/);
    expect(advice).toMatch(/beneficiaryName\*/);
    // And the page has every field of a drafted form, the tool required.
    const plan = allForms().find(({ form }) => form.draft === "subscription");
    expect(fieldsOf(plan!.form)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "toolName", required: true }),
      ]),
    );
  });

  it("reads a field behind a .transform() as the form takes it", () => {
    // The bank file's email may be left out: its input has a default.
    const payment = allForms().find(
      ({ form }) =>
        form.saves.includes("POST /bank-advices/:id/lines") &&
        form.schema !== undefined,
    );
    const email = fieldsOf(payment!.form).find(
      (field) => field.name === "email",
    );
    expect(email?.required).toBe(false);
  });
});

describe("what the Assistant may do in each part", () => {
  it("gives every kind of draft a part to belong to", () => {
    for (const target of AI_TARGETS) {
      expect([target, partsDrafting(target).length > 0]).toEqual([
        target,
        true,
      ]);
    }
    for (const part of APP_MAP) {
      for (const target of part.assistant.drafts) {
        expect(AI_TARGETS).toContain(target);
      }
    }
  });

  it("gives every look-up tool a part, and names no tool that is not there", () => {
    const tools = AI_TOOL_DEFINITIONS.map((tool) => tool.name);
    const read = new Set(APP_MAP.flatMap((part) => part.assistant.reads));

    for (const tool of tools)
      expect([tool, read.has(tool)]).toEqual([tool, true]);
    for (const tool of read) {
      expect([tool, tools.includes(tool)]).toEqual([tool, true]);
    }
  });

  it("lets nobody read a part through a tool its screen would refuse", () => {
    // A tool named by a part asks at least for something; `find_party` is
    // the one that decides inside, by which of its two lists is asked for.
    for (const tool of AI_TOOL_DEFINITIONS) {
      if (tool.name === "find_party") continue;
      expect([tool.name, tool.requires.length > 0]).toEqual([tool.name, true]);
    }
  });

  it("keeps a subscription out of the plain ledger", () => {
    const subscriptions = partOf("subscriptions");

    expect(subscriptions?.assistant.drafts).toEqual([
      "subscription",
      "subscription_payment",
    ]);
    expect(subscriptions?.claims?.from).toContain("transaction_out");
    // A part never claims a kind of draft it keeps itself.
    for (const part of APP_MAP) {
      for (const target of part.claims?.from ?? []) {
        expect(part.assistant.drafts).not.toContain(target);
      }
    }
    // The owner's rule: software, AI tools, hosting and servers, domains.
    for (const name of [
      "Ai Tools and Subscriptions",
      "AI tools",
      "Software & subscriptions",
      "Hosting & servers",
      "Domains",
    ]) {
      expect([name, subscriptions?.claims?.categories?.test(name)]).toEqual([
        name,
        true,
      ]);
    }
    for (const name of ["Office rent", "Electricity", "Detailing"]) {
      expect([name, subscriptions?.claims?.categories?.test(name)]).toEqual([
        name,
        false,
      ]);
    }
  });

  it("drafts nothing where the brief says to point to the screen", () => {
    for (const key of [
      "payroll",
      "bank_advice",
      "hr_requests",
      "hr_budget",
      "settings",
      "reports",
      "accounts",
    ]) {
      expect([key, partOf(key)?.assistant.drafts]).toEqual([key, []]);
    }
  });
});

describe("the map as the model reads it", () => {
  const rendered = renderAppMap();

  it("has a block for every part, with its key", () => {
    for (const part of APP_MAP) {
      expect(rendered).toContain(`[${part.key}] ${part.name}`);
    }
  });

  it("says where a subscription is kept, and that it is never a plain payment", () => {
    const block = rendered.slice(rendered.indexOf("[subscriptions]"));

    expect(block).toMatch(/Never a plain payment/);
    expect(block).toMatch(
      /You can draft here: subscription \(.*\), subscription_payment \(/,
    );
    expect(block).toMatch(/AI tools and subscriptions \(\/subscriptions\)/);
  });

  it("says so when no screen shows a part", () => {
    const vendors = rendered.slice(
      rendered.indexOf("[vendors]"),
      rendered.indexOf("[team]"),
    );
    expect(vendors).toMatch(/Screens: none/);
  });

  it("points to a list, never to one record's own page", () => {
    for (const part of APP_MAP) {
      const screen = screenOf(part);
      if (screen) expect(screen.href).not.toMatch(/\[/);
    }
    expect(screenOf(partOf("subscriptions"))).toEqual({
      name: "AI tools and subscriptions",
      href: "/subscriptions",
    });
    expect(screenOf(partOf("vendors"))).toBeNull();
  });
});
