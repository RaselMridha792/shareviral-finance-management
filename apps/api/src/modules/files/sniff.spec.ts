import { sniffMime } from "./sniff";

/**
 * The one function in this feature where being wrong is a security hole rather
 * than a bug. Everything downstream — which kinds are allowed, what
 * Content-Type is sent back, whether a browser renders it inline — trusts the
 * answer this gives.
 */

const bytes = (...values: number[]) => Buffer.from(values);
const withHead = (head: number[], length = 64) =>
  Buffer.concat([bytes(...head), Buffer.alloc(length)]);

describe("sniffMime", () => {
  it("recognises the formats this app serves back", () => {
    expect(sniffMime(withHead([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(
      sniffMime(withHead([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toBe("image/png");
    expect(sniffMime(Buffer.from("%PDF-1.7\nrest"))).toBe("application/pdf");
  });

  it("recognises webp, whose marker is not at the start", () => {
    const webp = Buffer.concat([
      Buffer.from("RIFF"),
      bytes(0x00, 0x00, 0x00, 0x00),
      Buffer.from("WEBP"),
      Buffer.alloc(32),
    ]);
    expect(sniffMime(webp)).toBe("image/webp");
  });

  it("does not mistake any RIFF file for webp", () => {
    // A .wav is RIFF too. Reading only the first four bytes would accept it as
    // an image and then serve it as one.
    const wav = Buffer.concat([
      Buffer.from("RIFF"),
      bytes(0x00, 0x00, 0x00, 0x00),
      Buffer.from("WAVE"),
      Buffer.alloc(32),
    ]);
    expect(sniffMime(wav)).toBeNull();
  });

  it("refuses HTML however it is labelled", () => {
    // The attack this whole function exists for: a script stored as a photo
    // and served from the app's own API, with the session cookie attached.
    const html = Buffer.from("<html><script>alert(1)</script></html>");
    expect(sniffMime(html)).toBeNull();
    expect(sniffMime(html, "image/png")).toBeNull();
    expect(sniffMime(html, "application/pdf")).toBeNull();
  });

  it("refuses an SVG, which is markup wearing an image's name", () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(sniffMime(svg, "image/svg+xml")).toBeNull();
  });

  it("ignores what the browser claimed for anything but csv", () => {
    const jpeg = withHead([0xff, 0xd8, 0xff, 0xe0]);
    // Declared as a PDF, actually a JPEG. The bytes decide.
    expect(sniffMime(jpeg, "application/pdf")).toBe("image/jpeg");
  });

  it("accepts a csv only when it is text, and only when asked to", () => {
    const csv = Buffer.from("date,description,amount\n2026-08-16,Rent,1000\n");
    expect(sniffMime(csv, "text/csv")).toBe("text/csv");
    // Without the declaration there is nothing to distinguish it from any
    // other text, so it is not guessed at.
    expect(sniffMime(csv)).toBeNull();
  });

  it("refuses a binary file dressed as a csv", () => {
    const binary = Buffer.concat([
      Buffer.from("date,amount\n"),
      bytes(0x00, 0x01, 0x02),
    ]);
    expect(sniffMime(binary, "text/csv")).toBeNull();
  });

  it("reads a zip as a spreadsheet, which is the only zip offered here", () => {
    expect(sniffMime(withHead([0x50, 0x4b, 0x03, 0x04]))).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  });

  it("recognises the old binary Excel format", () => {
    expect(
      sniffMime(withHead([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
    ).toBe("application/vnd.ms-excel");
  });

  it("says nothing rather than guessing about an empty or tiny file", () => {
    expect(sniffMime(Buffer.alloc(0))).toBeNull();
    expect(sniffMime(bytes(0xff))).toBeNull();
    expect(sniffMime(bytes(0xff, 0xd8))).toBeNull();
  });
});
