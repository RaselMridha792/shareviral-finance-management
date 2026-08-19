import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SIGNATURE_MAX_BYTES,
  SIGNATURE_RULE,
  checkSignatureImage,
  readImageSize,
} from "./files.ts";

/**
 * A signature is refused on the server, and the server reads the size out of
 * the bytes. So the parser is the part that decides whether a good signature
 * gets in — and a parser that hangs, or that reads a number off the wrong
 * offset, is worse than no check at all.
 */

/** A PNG header with the dimensions written where a decoder looks for them. */
function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  // Chunk length, then the type.
  bytes.set([0, 0, 0, 13], 8);
  bytes.set([73, 72, 68, 82], 12); // "IHDR"
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

/**
 * A JPEG whose frame header sits behind however many other segments — which is
 * the real shape of a file off a phone or a scanner, where EXIF comes first.
 */
function jpeg(width: number, height: number, padding: number[][] = []) {
  const out: number[] = [0xff, 0xd8];
  for (const segment of padding) {
    const length = segment.length + 2;
    out.push(0xff, 0xe1, (length >> 8) & 0xff, length & 0xff, ...segment);
  }
  out.push(0xff, 0xc0, 0, 17, 8, (height >> 8) & 0xff, height & 0xff);
  out.push((width >> 8) & 0xff, width & 0xff, 3);
  return new Uint8Array(out);
}

describe("readImageSize", () => {
  it("reads a PNG", () => {
    assert.deepEqual(readImageSize(png(1200, 300)), {
      width: 1200,
      height: 300,
    });
  });

  it("reads a JPEG", () => {
    assert.deepEqual(readImageSize(jpeg(900, 200)), {
      width: 900,
      height: 200,
    });
  });

  /**
   * The case a fixed offset gets wrong. A scan carries EXIF before its frame
   * header, so reading bytes 5–9 of the file returns the size of nothing.
   */
  it("reads a JPEG whose frame is behind EXIF", () => {
    const exif = Array.from({ length: 400 }, (_, i) => i % 256);
    assert.deepEqual(readImageSize(jpeg(900, 200, [exif, exif])), {
      width: 900,
      height: 200,
    });
  });

  it("returns null rather than throwing on rubbish", () => {
    for (const bytes of [
      new Uint8Array(0),
      new Uint8Array([0]),
      new Uint8Array([0x25, 0x50, 0x44, 0x46]), // a PDF
      png(10, 10).slice(0, 12), // truncated mid-header
      jpeg(900, 200).slice(0, 6), // truncated before the frame
    ]) {
      assert.equal(readImageSize(bytes), null);
    }
  });

  /**
   * A segment claiming a length of zero would leave the walk standing still.
   * The file is malformed either way; what matters is that it ends.
   */
  it("terminates on a segment with an impossible length", () => {
    const bad = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x00, 0x00, 0x00]);
    assert.equal(readImageSize(bad), null);
  });

  it("terminates on a file that is all padding", () => {
    const padded = new Uint8Array(5000).fill(0xff);
    padded[0] = 0xff;
    padded[1] = 0xd8;
    assert.equal(readImageSize(padded), null);
  });
});

describe("checkSignatureImage", () => {
  const good = {
    width: 1200,
    height: 300,
    sizeBytes: 40_000,
    mimeType: "image/png",
  };

  it("takes a wide, small PNG", () => {
    assert.equal(checkSignatureImage(good).ok, true);
  });

  it("refuses a PDF", () => {
    const result = checkSignatureImage({ ...good, mimeType: "application/pdf" });
    assert.equal(result.ok, false);
  });

  it("refuses one over the size limit, and says how big it is", () => {
    const result = checkSignatureImage({
      ...good,
      sizeBytes: SIGNATURE_MAX_BYTES + 1,
    });
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.reason : "", /KB/);
  });

  it("refuses one too narrow to print", () => {
    assert.equal(checkSignatureImage({ ...good, width: 200, height: 60 }).ok, false);
  });

  /** Nobody signs in a square, and a square scan is uncropped paper. */
  it("refuses a square", () => {
    assert.equal(
      checkSignatureImage({ ...good, width: 600, height: 600 }).ok,
      false,
    );
  });

  it("refuses a sliver", () => {
    assert.equal(
      checkSignatureImage({ ...good, width: 2000, height: 100 }).ok,
      false,
    );
  });

  it("refuses a zero dimension rather than dividing by it", () => {
    assert.equal(checkSignatureImage({ ...good, height: 0 }).ok, false);
  });

  /**
   * The sentence on screen has to be true of the rule, or the form promises one
   * limit and enforces another.
   */
  it("is described by the sentence the screen prints", () => {
    assert.match(SIGNATURE_RULE, /PNG or JPEG/);
    assert.match(
      SIGNATURE_RULE,
      new RegExp(String(Math.round(SIGNATURE_MAX_BYTES / 1024))),
    );
  });
});
