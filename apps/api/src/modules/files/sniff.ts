/**
 * What a file actually is, decided by reading it.
 *
 * The browser sends a Content-Type with every upload and the filename carries
 * an extension, and both are claims made by whoever is uploading. Neither is
 * evidence. This reads the first bytes instead, which is the only part of an
 * upload that has to be true for the file to work at all.
 *
 * It matters because this app serves these files back. A file stored as
 * `photo.png` and served with `Content-Type: image/png` that is really HTML is
 * a script running on the app's own domain, with the session cookie attached.
 */

/** Bytes that identify a format, and where they sit. */
const SIGNATURES: ReadonlyArray<{
  mime: string;
  offset: number;
  bytes: readonly number[];
}> = [
  { mime: "image/jpeg", offset: 0, bytes: [0xff, 0xd8, 0xff] },
  {
    mime: "image/png",
    offset: 0,
    bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
  // "%PDF-"
  { mime: "application/pdf", offset: 0, bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  // The old binary Excel format is an OLE2 compound document.
  {
    mime: "application/vnd.ms-excel",
    offset: 0,
    bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
  },
];

function startsWith(
  buffer: Buffer,
  offset: number,
  bytes: readonly number[],
): boolean {
  if (buffer.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buffer[offset + i] === b);
}

/** RIFF....WEBP — the size sits between the two markers. */
function isWebp(buffer: Buffer): boolean {
  return (
    buffer.length >= 12 &&
    buffer.toString("latin1", 0, 4) === "RIFF" &&
    buffer.toString("latin1", 8, 12) === "WEBP"
  );
}

/** Any of the three zip local-header variants. xlsx and docx are zips. */
function isZip(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) return false;
  const third = buffer[2];
  const fourth = buffer[3];
  return (
    (third === 0x03 && fourth === 0x04) ||
    (third === 0x05 && fourth === 0x06) ||
    (third === 0x07 && fourth === 0x08)
  );
}

/**
 * CSV has no signature, so this is the one case decided by absence: it must be
 * decodable as UTF-8 and hold no NUL byte. That rules out every binary format
 * above and leaves a text file, which is all a CSV claims to be.
 */
function looksLikeText(buffer: Buffer): boolean {
  const head = buffer.subarray(0, 8192);
  if (head.includes(0x00)) return false;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    // A multi-byte character split by the 8 KB boundary would throw on a file
    // that is perfectly fine, so decode a little short of the edge.
    decoder.decode(head.subarray(0, Math.max(0, head.length - 4)));
    return true;
  } catch {
    return false;
  }
}

/**
 * The content type the bytes support, or null when nothing recognises them.
 *
 * `declared` is used only to choose between formats that share a signature —
 * xlsx and docx are both zip archives, and reading further to tell them apart
 * would mean unzipping an untrusted file to decide whether to accept it.
 * Nothing is ever accepted on `declared` alone.
 */
export function sniffMime(buffer: Buffer, declared?: string): string | null {
  for (const { mime, offset, bytes } of SIGNATURES) {
    if (startsWith(buffer, offset, bytes)) return mime;
  }

  if (isWebp(buffer)) return "image/webp";

  if (isZip(buffer)) {
    // Only ever offered as a spreadsheet by this app; anything else that is a
    // zip is refused by the per-kind allow-list a step later.
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }

  if (declared === "text/csv" && looksLikeText(buffer)) return "text/csv";

  return null;
}
