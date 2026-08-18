/**
 * The QR is injected into the page as markup, so what it can contain is a
 * security question, not a rendering one.
 *
 * These assertions are the reason that injection is allowed. "It is only an
 * image" is exactly the sentence that precedes markup getting in, and the
 * input here is a URL built from a user-controlled value — their email address
 * goes into the otpauth label. If the encoder ever put its input in the output
 * as text, an address containing a tag would arrive in the DOM.
 */
import { otpauthUrl } from "./totp";
import { qrSvgFor } from "./two-factor.service";

describe("qrSvgFor", () => {
  const url = otpauthUrl({
    secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
    account: "mirza@shareviral.cash",
    issuer: "ShareViral Finance",
  });

  it("is an svg element", () => {
    const svg = qrSvgFor(url);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
  });

  it("contains no script, no foreignObject, no event handler", () => {
    const svg = qrSvgFor(url);
    expect(svg).not.toMatch(/<script/i);
    expect(svg).not.toMatch(/<foreignObject/i);
    expect(svg).not.toMatch(/\bon[a-z]+\s*=/i);
    expect(svg).not.toMatch(/javascript:/i);
    // No text nodes at all: the symbol is rects and a path.
    expect(svg).not.toMatch(/<text/i);
    expect(svg).not.toMatch(/<title/i);
  });

  it("does not carry the secret or the URL in the markup", () => {
    // Anybody who can read the page's HTML must not get the secret without
    // decoding the picture, which is the same work as photographing it.
    const svg = qrSvgFor(url);
    expect(svg).not.toContain("JBSWY3DPEHPK3PXP");
    expect(svg).not.toContain("otpauth");
    expect(svg).not.toContain("shareviral.cash");
  });

  it("does not reflect a hostile email address into the output", () => {
    const hostile = otpauthUrl({
      secret: "JBSWY3DPEHPK3PXP",
      account: '"><script>alert(1)</script>@x.co',
      issuer: "ShareViral Finance",
    });
    const svg = qrSvgFor(hostile);
    expect(svg).not.toMatch(/<script/i);
    expect(svg).not.toContain("alert(1)");
  });

  it("keeps a light background, whatever the page's theme", () => {
    // A QR needs light quiet zones. One that followed a dark page would look
    // better and not scan.
    expect(qrSvgFor(url)).toMatch(/fill="white"/);
  });

  it("scales rather than fixing a pixel size", () => {
    expect(qrSvgFor(url)).toMatch(/viewBox="0 0 \d+ \d+"/);
  });

  it("encodes a long URL without throwing", () => {
    // The version is chosen automatically; a long issuer plus a long address
    // must not overflow the smallest symbol.
    const long = otpauthUrl({
      secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
      account: `${"a".repeat(64)}@a-fairly-long-company-domain.example.com`,
      issuer: "ShareViral Finance Management Limited",
    });
    expect(() => qrSvgFor(long)).not.toThrow();
    expect(qrSvgFor(long).startsWith("<svg")).toBe(true);
  });
});
