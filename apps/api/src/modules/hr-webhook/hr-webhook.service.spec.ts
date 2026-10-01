import { Logger } from "@nestjs/common";

import type { DbService } from "../../db/db.service";
import { HrWebhookService } from "./hr-webhook.service";

/**
 * The webhook that tells the HR portal about decisions (#128), with the
 * database and `fetch` stood in for. What is held here is what the HR
 * portal's Brief 7 asks for: the exact body, the secret in its header and
 * nowhere else, at most 200 a call, "withdrawn" not sent, no retries — and a
 * decision never slowed or broken by any of it.
 */

const SECRET = "test-secret-that-is-long-enough-1234567890";
const URL_ = "https://hrm.example.test/api/finance/webhook/decisions";

type Row = {
  externalId: string;
  status: string;
  note: string | null;
  decidedByName: string | null;
  decidedAt: Date | null;
  appliedAt: Date | null;
};

function row(n: number, status = "approved"): Row {
  return {
    externalId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    status,
    note: status === "refused" ? "Not this year" : null,
    decidedByName: "CFO Name",
    decidedAt: new Date("2026-10-01T05:00:00.000Z"),
    appliedAt:
      status === "approved" ? new Date("2026-10-01T05:00:01.000Z") : null,
  };
}

function serviceWith(rows: Row[] | Error) {
  const execute = jest.fn(() =>
    rows instanceof Error ? Promise.reject(rows) : Promise.resolve({ rows }),
  );
  const db = { client: { execute } } as unknown as DbService;
  return { service: new HrWebhookService(db), execute };
}

function answer(status: number, body: unknown = { written: 1 }) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

const realFetch = global.fetch;
let fetchMock: jest.Mock;
let logs: string[];

beforeEach(() => {
  process.env.HR_WEBHOOK_URL = URL_;
  process.env.HR_WEBHOOK_SECRET = SECRET;
  fetchMock = jest.fn(() => answer(200));
  global.fetch = fetchMock;
  logs = [];
  for (const level of ["log", "warn", "error"] as const) {
    jest
      .spyOn(Logger.prototype, level)
      .mockImplementation((message: unknown) => {
        logs.push(String(message));
      });
  }
});

afterEach(() => {
  delete process.env.HR_WEBHOOK_URL;
  delete process.env.HR_WEBHOOK_SECRET;
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

/** What one call carried: the body is always the JSON string it was sent as. */
const bodyOf = (init: RequestInit): unknown => JSON.parse(init.body as string);

/** Lets the fire-and-forget promise inside `notify` run to the end. */
const drain = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("HrWebhookService", () => {
  it("is off without a secret: reads nothing, sends nothing", async () => {
    delete process.env.HR_WEBHOOK_SECRET;
    const { service, execute } = serviceWith([row(1)]);
    service.notify("pay_change", [row(1).externalId]);
    await drain();
    expect(execute).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends exactly the status rows, with the secret in its header, refusing redirects", async () => {
    const { service } = serviceWith([row(1), row(2, "refused")]);
    service.notify("pay_change", [row(1).externalId, row(2).externalId]);
    await drain();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(URL_);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    expect(init.headers).toEqual({
      "content-type": "application/json",
      "x-finance-secret": SECRET,
    });
    expect(bodyOf(init)).toEqual([
      {
        externalId: row(1).externalId,
        state: "approved",
        note: null,
        decidedByName: "CFO Name",
        decidedAt: "2026-10-01T05:00:00.000Z",
        appliedAt: "2026-10-01T05:00:01.000Z",
      },
      {
        externalId: row(2).externalId,
        state: "rejected",
        note: "Not this year",
        decidedByName: "CFO Name",
        decidedAt: "2026-10-01T05:00:00.000Z",
        appliedAt: null,
      },
    ]);
  });

  it("says pending, not received, and does not send withdrawn", async () => {
    const { service } = serviceWith([
      row(1, "received"),
      row(2, "withdrawn"),
      row(3, "held"),
    ]);
    service.notify("one_off", [
      row(1).externalId,
      row(2).externalId,
      row(3).externalId,
    ]);
    await drain();
    const sent = bodyOf(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1],
    ) as { state: string }[];
    expect(sent.map((one) => one.state)).toEqual(["pending", "held"]);
  });

  it("sends nothing when everything named was withdrawn", async () => {
    const { service } = serviceWith([row(1, "withdrawn")]);
    service.notify("spend", [row(1).externalId]);
    await drain();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips null ids and asks once per id", async () => {
    const { service, execute } = serviceWith([row(1)]);
    service.notify("pay_change", [
      null,
      row(1).externalId,
      row(1).externalId,
      undefined,
    ]);
    await drain();
    expect(execute).toHaveBeenCalledTimes(1);
    service.notify("pay_change", [null, undefined]);
    await drain();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("sends at most 200 a call", async () => {
    const many = Array.from({ length: 250 }, (_, n) => row(n + 1));
    const { service } = serviceWith(many);
    await service.send(
      { url: URL_, secret: SECRET },
      "spend",
      many.map((one) => one.externalId),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const sizes = fetchMock.mock.calls.map(
      (call) =>
        (bodyOf((call as [string, RequestInit])[1]) as unknown[]).length,
    );
    expect(sizes).toEqual([200, 50]);
  });

  it("never retries: written 0, a 401, a 500 and a dead network are each one try", async () => {
    for (const next of [
      () => answer(200, { written: 0 }),
      () => answer(401, { message: "no" }),
      () => answer(500, { message: "down" }),
      () => Promise.reject(new TypeError("fetch failed")),
    ]) {
      fetchMock.mockReset();
      fetchMock.mockImplementation(next);
      const { service } = serviceWith([row(1)]);
      await expect(
        service.send({ url: URL_, secret: SECRET }, "pay_change", [
          row(1).externalId,
        ]),
      ).resolves.toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it("never throws out of notify, even when the database fails", async () => {
    const { service } = serviceWith(new Error("connection reset"));
    expect(() => service.notify("budget", [row(1).externalId])).not.toThrow();
    await drain();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logs.some((line) => line.includes("connection reset"))).toBe(true);
  });

  it("never writes the secret into a log line", async () => {
    fetchMock.mockImplementation(() => answer(401, {}));
    const { service } = serviceWith([row(1)]);
    service.onModuleInit();
    await service.send({ url: URL_, secret: SECRET }, "pay_change", [
      row(1).externalId,
    ]);
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.every((line) => !line.includes(SECRET))).toBe(true);
  });

  it("turns itself off, without printing it, when the secret has a line break in it", async () => {
    const broken = "first-half-of-a-secret\nsecond-half-of-it";
    process.env.HR_WEBHOOK_SECRET = broken;
    const { service, execute } = serviceWith([row(1)]);
    service.onModuleInit();
    service.notify("pay_change", [row(1).externalId]);
    await drain();
    expect(execute).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logs.some((line) => line.startsWith("Off:"))).toBe(true);
    expect(
      logs.every(
        (line) =>
          !line.includes("first-half-of-a-secret") &&
          !line.includes("second-half-of-it"),
      ),
    ).toBe(true);
  });

  it("is off for a URL with a password in it, or plain http to another machine", async () => {
    for (const url of [
      "https://user:pass@hrm.example.test/api/finance/webhook/decisions",
      "http://hrm.example.test/api/finance/webhook/decisions",
      "not a web address",
    ]) {
      process.env.HR_WEBHOOK_URL = url;
      const { service } = serviceWith([row(1)]);
      service.notify("pay_change", [row(1).externalId]);
      await drain();
      expect(fetchMock).not.toHaveBeenCalled();
    }
    process.env.HR_WEBHOOK_URL =
      "http://localhost:4099/api/finance/webhook/decisions";
    const { service } = serviceWith([row(1)]);
    service.notify("pay_change", [row(1).externalId]);
    await drain();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("logs a failure's cause, and cuts the secret out of any error text", async () => {
    fetchMock.mockImplementation(() =>
      Promise.reject(
        new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } }),
      ),
    );
    const { service } = serviceWith([row(1)]);
    await service.send({ url: URL_, secret: SECRET }, "pay_change", [
      row(1).externalId,
    ]);
    expect(logs.some((line) => line.includes("ECONNREFUSED"))).toBe(true);

    logs.length = 0;
    fetchMock.mockImplementation(() =>
      Promise.reject(new TypeError(`bad header value "${SECRET}"`)),
    );
    await service.send({ url: URL_, secret: SECRET }, "pay_change", [
      row(1).externalId,
    ]);
    expect(logs.some((line) => line.includes("[secret]"))).toBe(true);
    expect(logs.every((line) => !line.includes(SECRET))).toBe(true);
  });

  it("keeps a database error's cause when its message is the whole query", async () => {
    const query = `select ${"r.external_id, ".repeat(40)}r.status from requests r`;
    const { service } = serviceWith(
      new Error(`Failed query: ${query}`, { cause: { code: "42P01" } }),
    );
    service.notify("pay_change", [row(1).externalId]);
    await drain();
    expect(fetchMock).not.toHaveBeenCalled();
    const line = logs.find((text) => text.includes("Failed query"));
    expect(line).toBeDefined();
    expect(line).toContain("42P01");
    expect((line ?? "").length).toBeLessThan(500);
  });
});
