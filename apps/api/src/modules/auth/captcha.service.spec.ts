import { Logger } from "@nestjs/common";

import { CaptchaService, SITEVERIFY_URL } from "./captcha.service";

/**
 * The human check in front of the password, with `fetch` stood in for. What
 * is held here is the sign-in brief's (2026-10-03): off while the secret is
 * unset, refused without a token once it is set, and refused — never let
 * through — whenever Cloudflare cannot give an answer.
 */

const SECRET = "0x-test-secret-that-is-not-real";
const TOKEN = "a-token-cloudflare-handed-the-browser";
const HR_SECRET = "a-shared-secret-of-thirty-two-ch";

function answer(status: number, body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

const realFetch = global.fetch;
const saved = {
  secret: process.env.TURNSTILE_SECRET_KEY,
  url: process.env.TURNSTILE_VERIFY_URL,
  hr: process.env.HR_WEBHOOK_SECRET,
};
let fetchMock: jest.Mock;
let logs: string[];
let errors: string[];

beforeEach(() => {
  process.env.TURNSTILE_SECRET_KEY = SECRET;
  delete process.env.TURNSTILE_VERIFY_URL;
  process.env.HR_WEBHOOK_SECRET = HR_SECRET;
  fetchMock = jest.fn(() => answer(200, { success: true }));
  global.fetch = fetchMock;
  logs = [];
  errors = [];
  jest.spyOn(Logger.prototype, "warn").mockImplementation((message) => {
    logs.push(String(message));
  });
  jest.spyOn(Logger.prototype, "error").mockImplementation((message) => {
    logs.push(String(message));
    errors.push(String(message));
  });
});

afterEach(() => {
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

afterAll(() => {
  for (const [name, value] of [
    ["TURNSTILE_SECRET_KEY", saved.secret],
    ["TURNSTILE_VERIFY_URL", saved.url],
    ["HR_WEBHOOK_SECRET", saved.hr],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("CaptchaService", () => {
  const captcha = new CaptchaService();

  describe("off", () => {
    it.each([
      ["unset", undefined],
      ["empty, as compose names it", ""],
      ["blank", "   "],
    ])("lets every sign-in through when the secret is %s", async (_, value) => {
      if (value === undefined) delete process.env.TURNSTILE_SECRET_KEY;
      else process.env.TURNSTILE_SECRET_KEY = value;

      expect(captcha.enabled).toBe(false);
      await expect(captcha.verify(undefined, null)).resolves.toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("on", () => {
    it("is enabled by the secret alone", () => {
      expect(captcha.enabled).toBe(true);
    });

    it("refuses a sign-in with no token, without asking Cloudflare", async () => {
      await expect(captcha.verify(undefined, "203.0.113.9")).resolves.toBe(
        false,
      );
      await expect(captcha.verify("", "203.0.113.9")).resolves.toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("lets it through when Cloudflare says success", async () => {
      await expect(captcha.verify(TOKEN, "203.0.113.9")).resolves.toBe(true);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(SITEVERIFY_URL);
      expect(init.method).toBe("POST");
      const sent = init.body as URLSearchParams;
      expect(sent.get("secret")).toBe(SECRET);
      expect(sent.get("response")).toBe(TOKEN);
      expect(sent.get("remoteip")).toBe("203.0.113.9");
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it("leaves the address out when there is none", async () => {
      await captcha.verify(TOKEN, null);
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect((init.body as URLSearchParams).has("remoteip")).toBe(false);
    });

    it("refuses when Cloudflare says the token is bad", async () => {
      fetchMock.mockImplementation(() =>
        answer(200, {
          success: false,
          "error-codes": ["invalid-input-response"],
        }),
      );
      await expect(captcha.verify(TOKEN, null)).resolves.toBe(false);
      expect(logs.join("\n")).toContain("invalid-input-response");
    });

    it("refuses anything but a literal true", async () => {
      fetchMock.mockImplementation(() => answer(200, { success: "true" }));
      await expect(captcha.verify(TOKEN, null)).resolves.toBe(false);
    });

    it("refuses on a non-200", async () => {
      fetchMock.mockImplementation(() => answer(503, { success: true }));
      await expect(captcha.verify(TOKEN, null)).resolves.toBe(false);
    });

    it("refuses when Cloudflare cannot be reached", async () => {
      fetchMock.mockImplementation(() =>
        Promise.reject(
          Object.assign(new TypeError("fetch failed"), {
            cause: { code: "ECONNREFUSED" },
          }),
        ),
      );
      await expect(captcha.verify(TOKEN, null)).resolves.toBe(false);
      expect(logs.join("\n")).toContain("ECONNREFUSED");
    });

    it("refuses when Cloudflare does not answer in time", async () => {
      fetchMock.mockImplementation(() =>
        Promise.reject(
          new DOMException("The operation was aborted", "TimeoutError"),
        ),
      );
      await expect(captcha.verify(TOKEN, null)).resolves.toBe(false);
      expect(logs.join("\n")).toContain("no answer within 5s");
    });

    it("refuses on an answer that is not JSON", async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(new Response("<html>", { status: 200 })),
      );
      await expect(captcha.verify(TOKEN, null)).resolves.toBe(false);
    });

    it("says loudly when the secret itself is wrong", async () => {
      fetchMock.mockImplementation(() =>
        answer(200, {
          success: false,
          "error-codes": ["invalid-input-secret"],
        }),
      );
      await expect(captcha.verify(TOKEN, null)).resolves.toBe(false);
      expect(errors.join(" ")).toContain("invalid-input-secret");
    });

    it("asks the overridden address when one is set", async () => {
      process.env.TURNSTILE_VERIFY_URL = "http://127.0.0.1:9/siteverify";
      await captcha.verify(TOKEN, null);
      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toBe("http://127.0.0.1:9/siteverify");
    });

    it("never writes the secret or the token into a log", async () => {
      fetchMock.mockImplementation(() =>
        Promise.reject(new TypeError(`fetch failed`)),
      );
      await captcha.verify(TOKEN, null);
      fetchMock.mockImplementation(() =>
        answer(200, {
          success: false,
          "error-codes": ["invalid-input-secret"],
        }),
      );
      await captcha.verify(TOKEN, null);

      const written = logs.join("\n");
      expect(written).not.toContain(SECRET);
      expect(written).not.toContain(TOKEN);
    });
  });

  /*
   * The HR portal's server, which has no browser (brief 2026-10-04). Only
   * whether the header matches is decided here; that it opens the way for an
   * HR account alone is the login's, and .captchaqa.mjs measures that.
   */
  describe("the HR portal's secret", () => {
    it("accepts the shared secret exactly", () => {
      expect(captcha.isHrServer(HR_SECRET)).toBe(true);
    });

    it.each([
      ["missing", undefined],
      ["empty", ""],
      ["wrong in its last character", "a-shared-secret-of-thirty-two-cX"],
      ["a prefix of it", HR_SECRET.slice(0, 16)],
      ["longer than it", HR_SECRET + "x"],
      ["sent twice", [HR_SECRET, HR_SECRET]],
    ])("refuses a header that is %s", (_, header) => {
      expect(captcha.isHrServer(header)).toBe(false);
    });

    it.each([
      ["unset", undefined],
      ["empty, as compose names it", ""],
      ["shorter than the webhook allows", "short-secret"],
      ["carrying a space", "a shared secret of thirty-two ch"],
    ])("accepts no header when our secret is %s", (_, value) => {
      if (value === undefined) delete process.env.HR_WEBHOOK_SECRET;
      else process.env.HR_WEBHOOK_SECRET = value;
      expect(captcha.isHrServer(value)).toBe(false);
      expect(captcha.isHrServer("")).toBe(false);
      expect(captcha.isHrServer(undefined)).toBe(false);
    });

    it("never asks Cloudflare, and writes nothing to a log", () => {
      captcha.isHrServer(HR_SECRET);
      captcha.isHrServer("wrong");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(logs).toEqual([]);
    });
  });
});
