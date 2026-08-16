import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ALLOWED_MIME_TYPES,
  COMPENSATION_FILE_KINDS,
  extensionForMime,
  FILE_KIND_LABELS,
  FILE_KINDS,
  IMAGE_MIME_TYPES,
  KINDS_BY_OWNER,
  MAX_FILE_BYTES,
  safeDisplayName,
  UPLOAD_HARD_LIMIT_BYTES,
} from "./files.ts";

describe("what a filename is allowed to be", () => {
  /**
   * Every one of these reaches a Content-Disposition header, which is a
   * single line: a newline in the value ends it, and whatever came after is
   * read by the browser as a header of its own.
   */
  it("keeps only the last path segment", () => {
    assert.equal(safeDisplayName("/etc/passwd"), "passwd");
    assert.equal(safeDisplayName("..\\..\\windows\\system32\\a.dll"), "a.dll");
    assert.equal(safeDisplayName("C:/Users/me/cv.pdf"), "cv.pdf");
  });

  it("removes what would break the header it goes into", () => {
    // Deleted, not replaced with a space — so the parts either side run
    // together. That reads oddly and is exactly right: the only thing that
    // matters is that no newline or quote survives to end the header early.
    const attack = safeDisplayName('cv.pdf"\r\nSet-Cookie: a=b');
    assert.equal(attack, "cv.pdfSet-Cookie: a=b");
    assert.ok(!/["'\r\n]/.test(attack));

    assert.equal(safeDisplayName("a'b\"c.pdf"), "abc.pdf");
  });

  it("never returns nothing", () => {
    assert.equal(safeDisplayName(""), "file");
    assert.equal(safeDisplayName("///"), "file");
    assert.equal(safeDisplayName('"""'), "file");
  });

  it("leaves an ordinary name alone, Bangla included", () => {
    assert.equal(
      safeDisplayName("Appointment Letter.pdf"),
      "Appointment Letter.pdf",
    );
    assert.equal(safeDisplayName("নিয়োগপত্র.pdf"), "নিয়োগপত্র.pdf");
  });

  it("caps the length without emptying it", () => {
    const long = `${"a".repeat(400)}.pdf`;
    assert.equal(safeDisplayName(long).length, 150);
  });
});

describe("what goes on disk", () => {
  it("gives every allowed type an extension of its own", () => {
    const allowed = new Set(Object.values(ALLOWED_MIME_TYPES).flat());
    const extensions = [...allowed].map(extensionForMime);
    assert.ok(
      !extensions.includes("bin"),
      "every type this app accepts should map to a real extension",
    );
  });

  it("falls back rather than throwing on something unknown", () => {
    assert.equal(extensionForMime("application/x-made-up"), "bin");
  });
});

describe("the tables agree with each other", () => {
  it("labels and limits every kind", () => {
    for (const kind of FILE_KINDS) {
      assert.ok(FILE_KIND_LABELS[kind], `${kind} has no label`);
      assert.ok(MAX_FILE_BYTES[kind] > 0, `${kind} has no size limit`);
      assert.ok(ALLOWED_MIME_TYPES[kind]?.length, `${kind} allows nothing`);
    }
  });

  it("keeps every kind reachable from some owner", () => {
    const reachable = new Set(Object.values(KINDS_BY_OWNER).flat());
    for (const kind of FILE_KINDS) {
      assert.ok(reachable.has(kind), `${kind} can be attached to nothing`);
    }
  });

  it("keeps every per-kind limit under the multipart ceiling", () => {
    // The interceptor's limit is one number for every route. A per-kind limit
    // above it would be rejected by multer with a generic error before the
    // message naming the real rule could ever be produced.
    for (const kind of FILE_KINDS) {
      assert.ok(
        MAX_FILE_BYTES[kind] <= UPLOAD_HARD_LIMIT_BYTES,
        `${kind} allows more than the upload ceiling`,
      );
    }
  });

  it("never allows svg anywhere", () => {
    // An image to a person, a script host to a browser, and this app serves
    // what it stores.
    for (const kind of FILE_KINDS) {
      assert.ok(
        !ALLOWED_MIME_TYPES[kind].includes("image/svg+xml"),
        `${kind} allows svg`,
      );
    }
  });

  it("allows a photo to be an image and nothing else", () => {
    assert.deepEqual(
      [...ALLOWED_MIME_TYPES.profile_photo],
      [...IMAGE_MIME_TYPES],
    );
  });

  it("keeps the pay-bearing kinds on team members only", () => {
    for (const kind of COMPENSATION_FILE_KINDS) {
      assert.ok(
        KINDS_BY_OWNER.team_member.includes(kind),
        `${kind} is gated on compensation but cannot hang on a person`,
      );
      assert.ok(
        !KINDS_BY_OWNER.transaction.includes(kind) &&
          !KINDS_BY_OWNER.import_batch.includes(kind),
        `${kind} can hang somewhere its compensation gate is not applied`,
      );
    }
  });
});
