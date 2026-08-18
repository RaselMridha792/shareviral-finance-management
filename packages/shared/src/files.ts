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
  subscription: ["subscription_screenshot"],
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
