import { z } from "zod";

/**
 * Files this application actually holds, rather than links to files it hopes
 * are still there.
 *
 * For most of this app's life the answer to "where do documents live" was a
 * Google Drive link — `team_members.photo_url`, `cv_url`,
 * `transactions.receipt_url`. That was the right call while there was nowhere
 * to put bytes. It has two costs the owner ran into: the app cannot tell
 * whether a link still resolves, and it cannot tell whether the auditor asking
 * for a document has been given access to the folder it sits in.
 *
 * The link columns stay. Eighteen people already have data in them, and
 * dropping a column to satisfy a preference destroys what somebody typed. A
 * record can carry a link, an uploaded file, or both.
 */

/* -------------------------------------------------------------------------- */
/* What a file is                                                             */
/* -------------------------------------------------------------------------- */

export const FILE_KINDS = [
  "profile_photo",
  "cv",
  "appointment_letter",
  "salary_certificate",
  "nid",
  "etin_certificate",
  "receipt",
  /**
   * The bill the money was against, as opposed to `receipt`, which is proof it
   * was paid. A remittance carries both and they are not interchangeable: an
   * auditor asking "what was this transfer for" wants the first, and "did it
   * actually go" wants the second.
   */
  "invoice",
  /** A screenshot or PDF of the bank's own record of the movement. */
  "bank_statement",
  /**
   * The plan page of a paid tool, as it looked when it was bought.
   *
   * The reason it is a screenshot rather than a note: what a plan includes is
   * on the vendor's own page, and that page changes without telling anybody.
   * A year later "Max 5x" no longer means what it meant.
   */
  "subscription_screenshot",
  /**
   * The company's own signature, printed at the foot of a payslip.
   *
   * Belongs to the settings row rather than to a person: it is the company
   * signing, and the same mark goes on everybody's slip.
   */
  "signature",
  /**
   * The A-Challan: the bank's receipt for tax actually deposited.
   *
   * Last in the list because a Postgres enum only takes new values on the end,
   * and this array is that type's declaration order.
   */
  "challan",
  "import_source",
  "other",
] as const;

export const fileKindSchema = z.enum(FILE_KINDS);
export type FileKind = z.infer<typeof fileKindSchema>;

/** What a file can hang on. Each maps to its own foreign key on the row. */
export const FILE_OWNERS = [
  "team_member",
  "transaction",
  "import_batch",
  "subscription",
  "settings",
  "tds_deposit",
] as const;
export const fileOwnerSchema = z.enum(FILE_OWNERS);
export type FileOwner = z.infer<typeof fileOwnerSchema>;

export const FILE_KIND_LABELS: Record<FileKind, string> = {
  profile_photo: "Photo",
  cv: "CV",
  appointment_letter: "Appointment letter",
  salary_certificate: "Salary certificate",
  nid: "National ID",
  etin_certificate: "e-TIN certificate",
  receipt: "Receipt",
  invoice: "Invoice",
  bank_statement: "Bank statement",
  subscription_screenshot: "Plan screenshot",
  signature: "Signature",
  challan: "Challan",
  import_source: "Imported file",
  other: "Document",
};

/**
 * Kinds that carry a pay figure on the face of the document.
 *
 * An appointment letter states the salary and a salary certificate exists to
 * state it, so both follow `team.compensation.read` rather than `team.read`.
 * This matters less than it did — HR reads compensation now — but the gate is
 * one line and the roles it still holds back are real.
 */
export const COMPENSATION_FILE_KINDS: readonly FileKind[] = [
  "appointment_letter",
  "salary_certificate",
];

/** Which kinds may hang on which owner. Anything else is a 400. */
export const KINDS_BY_OWNER: Record<FileOwner, readonly FileKind[]> = {
  team_member: [
    "profile_photo",
    "cv",
    "appointment_letter",
    "salary_certificate",
    "nid",
    "etin_certificate",
    "other",
  ],
  transaction: ["receipt", "invoice", "bank_statement", "other"],
  // One kind, and that is the point: this is the plan page, not a folder.
  // The plan page, and now the paperwork for what was paid for it: a
  // subscription is a money row like any other, so it carries the same two
  // documents — our bill and the bank's record of the charge.
  subscription: ["subscription_screenshot", "invoice", "bank_statement"],
  // One kind, and there is one of it. Two signatures on file would mean a
  // payslip had to pick.
  settings: ["signature"],
  // One kind, and "other" is not among them on purpose: a document on a
  // challan row is the challan. Anything else filed there is misfiled.
  tds_deposit: ["challan"],
  import_batch: ["import_source"],
};

/* -------------------------------------------------------------------------- */
/* What may be uploaded                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The allow-list is by *content*, not by file extension — see `sniffMime` on
 * the API side, which reads the first bytes and refuses anything whose insides
 * disagree with its name. An extension is a claim made by whoever uploaded the
 * file.
 *
 * SVG is deliberately absent everywhere. It is an image to a person and a
 * script host to a browser, and this app serves what it stores.
 */
/**
 * What a signature may be — narrower than an image in general.
 *
 * Declared up here with the other mime lists because the per-kind map below
 * refers to it, and a constant used before its own line is a runtime error the
 * compiler catches only some of the time.
 */
export const SIGNATURE_MIME_TYPES = ["image/png", "image/jpeg"] as const;

export const IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

const DOCUMENT_MIME_TYPES = [...IMAGE_MIME_TYPES, "application/pdf"] as const;

const SPREADSHEET_MIME_TYPES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
] as const;

export const ALLOWED_MIME_TYPES: Record<FileKind, readonly string[]> = {
  profile_photo: IMAGE_MIME_TYPES,
  cv: DOCUMENT_MIME_TYPES,
  appointment_letter: DOCUMENT_MIME_TYPES,
  salary_certificate: DOCUMENT_MIME_TYPES,
  nid: DOCUMENT_MIME_TYPES,
  etin_certificate: DOCUMENT_MIME_TYPES,
  receipt: DOCUMENT_MIME_TYPES,
  invoice: DOCUMENT_MIME_TYPES,
  // Images too, because "bank statement" in practice means a screenshot of one.
  bank_statement: DOCUMENT_MIME_TYPES,
  // A screenshot, overwhelmingly — but a PDF invoice for the plan is the same
  // evidence, so the wider list rather than images alone.
  subscription_screenshot: DOCUMENT_MIME_TYPES,
  // Narrower than everything else here on purpose: a signature has to render
  // over a printed rule, and a PDF cannot. See `checkSignatureImage`.
  signature: SIGNATURE_MIME_TYPES,
  // A screenshot from the bank's portal or the PDF it emails — the two
  // forms an A-Challan actually arrives in.
  challan: DOCUMENT_MIME_TYPES,
  import_source: SPREADSHEET_MIME_TYPES,
  other: DOCUMENT_MIME_TYPES,
};

const MB = 1024 * 1024;

/**
 * Per-kind ceilings. A photo of a person needs no more than this, and a limit
 * that is generous everywhere is the same as no limit at the one place it
 * mattered.
 *
 * nginx caps the request body at 25 MB before any of this runs, so these must
 * stay under it — a 30 MB limit here would be refused by the proxy with a bare
 * 413 and no explanation of which rule was hit.
 */
export const MAX_FILE_BYTES: Record<FileKind, number> = {
  profile_photo: 5 * MB,
  cv: 15 * MB,
  appointment_letter: 15 * MB,
  salary_certificate: 15 * MB,
  nid: 10 * MB,
  etin_certificate: 10 * MB,
  receipt: 15 * MB,
  invoice: 15 * MB,
  // A screenshot, so smaller — and the cap is the honest place to say so. The
  // multipart limit is one number for every route, so a per-kind limit above
  // UPLOAD_HARD_LIMIT_BYTES would be refused by multer with a generic error
  // before this rule could name itself.
  bank_statement: 10 * MB,
  // Same reasoning: a screen capture of a pricing page, not a document.
  subscription_screenshot: 10 * MB,
  // The real limit is SIGNATURE_MAX_BYTES, which is far smaller. This one only
  // has to stop a file before multer's generic refusal; the readable one comes
  // from the shared check.
  signature: 1 * MB,
  // A page from a bank portal. Generous for a screenshot, nowhere near
  // nginx's 25 MB body cap.
  challan: 10 * MB,
  import_source: 15 * MB,
  other: 15 * MB,
};

/** The largest any single upload may be, for the multipart limit. */
export const UPLOAD_HARD_LIMIT_BYTES = 15 * MB;

export function isImageMime(mime: string): boolean {
  return (IMAGE_MIME_TYPES as readonly string[]).includes(mime);
}

/**
 * The extension a stored file is given on disk.
 *
 * Derived from the sniffed content type rather than carried over from the
 * uploaded name, so nothing a person typed reaches the filesystem.
 */
export function extensionForMime(mime: string): string {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "application/pdf":
      return "pdf";
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return "xlsx";
    case "application/vnd.ms-excel":
      return "xls";
    case "text/csv":
      return "csv";
    default:
      return "bin";
  }
}

/**
 * A display name safe to put in a Content-Disposition header and in a table
 * cell. Keeps the shape of what was uploaded without keeping its authority:
 * path separators, control characters and quotes all go.
 */
export function safeDisplayName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  // Written as a filter rather than a regex range so no control character
  // has to appear in this source file. A Content-Disposition header ends at
  // a newline, so a filename carrying one lets whatever follows it be read
  // as a header of its own; a quote closes the quoted-string early.
  const cleaned = Array.from(base)
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      if (code < 0x20 || code === 0x7f) return false;
      return ch !== '"' && ch !== "'";
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, 150) || "file";
}

/* -------------------------------------------------------------------------- */
/* Wire shapes                                                                */
/* -------------------------------------------------------------------------- */

/** Sent alongside the multipart body. */
export const uploadFileSchema = z.strictObject({
  kind: fileKindSchema,
  label: z.string().trim().max(120).optional(),
});
export type UploadFileInput = z.infer<typeof uploadFileSchema>;

export const fileDtoSchema = z.object({
  id: z.string().uuid(),
  kind: fileKindSchema,
  label: z.string().nullable(),
  originalName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  isImage: z.boolean(),
  uploadedBy: z.string().uuid().nullable(),
  uploadedByName: z.string().nullable(),
  createdAt: z.string(),
  /** Always through the API — never a path on disk, never a direct nginx URL. */
  url: z.string(),
});
export type FileDto = z.infer<typeof fileDtoSchema>;

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / MB).toFixed(1)} MB`;
}

/* -------------------------------------------------------------------------- */
/*  What a signature has to be                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The shape and size a payslip signature is allowed to be.
 *
 * The owner asked for these to be *stated and required*, and the second half is
 * the easy half — a rule nobody can read before they pick a file is a rule they
 * meet by accident. Both the Settings screen and the upload endpoint go through
 * `checkSignatureImage` below, so the words on screen and the refusal on the
 * server cannot say different things.
 *
 * The numbers are chosen for what a signature is: a scan of ink on paper,
 * cropped close. Wide and short — nobody signs in a square — which is what the
 * ratio bounds express, and generously wide so a 3:1 and a 5:1 are both fine.
 * The width floor exists because the payslip prints it about 110pt across; a
 * 200px scan lands there as a smear.
 */
export const SIGNATURE_MAX_BYTES = 300 * 1024;
export const SIGNATURE_MIN_WIDTH = 300;
export const SIGNATURE_MAX_WIDTH = 2400;
/** width ÷ height. */
export const SIGNATURE_MIN_RATIO = 1.5;
export const SIGNATURE_MAX_RATIO = 8;

/**
 * Said in one sentence, for the screen to print before a file is chosen.
 *
 * Built from the constants rather than typed out beside them, so the rule and
 * its description cannot drift — which is exactly how a form comes to promise
 * one limit and enforce another.
 */
export const SIGNATURE_RULE = `PNG or JPEG, under ${Math.round(
  SIGNATURE_MAX_BYTES / 1024,
)} KB, at least ${SIGNATURE_MIN_WIDTH}px wide, and between ${SIGNATURE_MIN_RATIO}:1 and ${SIGNATURE_MAX_RATIO}:1 — wider than it is tall.`;

/**
 * One rule, called from the browser and from the server.
 *
 * Returns the reason rather than a boolean, because every one of these is
 * something a person can go and fix, and "invalid image" tells them none of it.
 */
export function checkSignatureImage(image: {
  width: number;
  height: number;
  sizeBytes: number;
  mimeType: string;
}): { ok: true } | { ok: false; reason: string } {
  if (!SIGNATURE_MIME_TYPES.includes(image.mimeType as "image/png")) {
    return { ok: false, reason: "It has to be a PNG or a JPEG." };
  }
  if (image.sizeBytes > SIGNATURE_MAX_BYTES) {
    return {
      ok: false,
      reason: `It is ${Math.round(image.sizeBytes / 1024)} KB. The limit is ${Math.round(
        SIGNATURE_MAX_BYTES / 1024,
      )} KB — a signature is ink on paper, so cropping it close usually gets there.`,
    };
  }
  if (image.width <= 0 || image.height <= 0) {
    return { ok: false, reason: "That file does not read as an image." };
  }
  if (image.width < SIGNATURE_MIN_WIDTH) {
    return {
      ok: false,
      reason: `It is ${image.width}px wide. Under ${SIGNATURE_MIN_WIDTH}px it prints on the payslip as a smear.`,
    };
  }
  if (image.width > SIGNATURE_MAX_WIDTH) {
    return {
      ok: false,
      reason: `It is ${image.width}px wide, over the ${SIGNATURE_MAX_WIDTH}px limit. Scale it down first.`,
    };
  }

  const ratio = image.width / image.height;
  if (ratio < SIGNATURE_MIN_RATIO || ratio > SIGNATURE_MAX_RATIO) {
    return {
      ok: false,
      reason: `It is ${image.width}×${image.height}, which is ${ratio.toFixed(
        1,
      )}:1. A signature wants ${SIGNATURE_MIN_RATIO}:1 to ${SIGNATURE_MAX_RATIO}:1 — crop away the space above and below the ink.`,
    };
  }

  return { ok: true };
}

/**
 * Width and height, read out of the bytes themselves.
 *
 * No dependency for this: PNG carries its size in the IHDR chunk, which is
 * always the first one, and JPEG carries it in whichever start-of-frame marker
 * comes first — which means walking the segments, because EXIF, ICC profiles
 * and comments all sit before it and none of them are a fixed length.
 *
 * Returns null rather than throwing on anything it does not understand. A file
 * whose dimensions cannot be read is refused by the caller with a reason, not
 * by an exception from a parser.
 */
export function readImageSize(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  // PNG: 8-byte signature, then a length, then "IHDR", then width and height
  // as big-endian 32-bit integers.
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 24 && PNG.every((b, i) => bytes[i] === b)) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR") return null;
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }

  // JPEG: 0xFFD8, then segments. Each is 0xFF, a marker, and a two-byte length
  // that includes itself. The frame markers carry the size; the rest are
  // skipped by their own length, which is what makes EXIF harmless.
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    // Bounded by the file, and every step moves forward by at least two bytes,
    // so a malformed file ends the walk instead of spinning in it.
    while (offset + 3 < bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      const marker = bytes[offset + 1];
      // Padding between segments, and the standalone markers that carry no
      // length of their own.
      if (marker === 0xff) {
        offset += 1;
        continue;
      }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
        offset += 2;
        continue;
      }
      const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
      if (length < 2) return null;
      // Start-of-frame, baseline through progressive, excluding the four that
      // are not frames at all.
      const isFrame =
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc;
      if (isFrame) {
        if (offset + 9 >= bytes.length) return null;
        const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
        const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
        return { width, height };
      }
      offset += 2 + length;
    }
  }

  return null;
}
