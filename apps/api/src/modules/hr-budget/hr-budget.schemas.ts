import { amountSchema, isoDateSchema } from "@finance/shared";
import { z } from "zod";

/**
 * What the HR portal sends, and what finance does with it.
 *
 * The shapes were settled with the HR portal's session on 30 Sep 2026 and
 * that side builds against them — change one and tell it. Bodies are strict
 * (an unknown key is a 400), amounts are strings, and a nullable field must
 * be PRESENT: `null`, never left out, so "not sent" and "sent as nothing"
 * cannot be confused.
 */

const positiveAmount = amountSchema.refine((value) => Number(value) > 0, {
  message: "The amount must be more than zero",
});
const name = (max: number) => z.string().trim().min(1).max(max);

export const submitPeriodSchema = z
  .strictObject({
    externalId: z.string().uuid(),
    categoryName: name(120),
    startsOn: isoDateSchema,
    endsOn: isoDateSchema,
    amount: positiveAmount,
    note: z.string().trim().max(500).nullable(),
    recordedByName: name(120),
  })
  .refine((body) => body.endsOn >= body.startsOn, {
    path: ["endsOn"],
    message: "The period cannot end before it starts",
  });
export type SubmitPeriodInput = z.infer<typeof submitPeriodSchema>;

export const submitSpendSchema = z
  .strictObject({
    externalId: z.string().uuid(),
    budgetExternalId: z.string().uuid(),
    spentOn: isoDateSchema,
    amount: positiveAmount,
    purpose: name(500),
    teamMemberId: z.string().uuid().nullable(),
    employeeName: z.string().trim().max(120).nullable(),
    hrStatus: z.enum(["proposed", "approved"]),
    hrApprovedByName: z.string().trim().min(1).max(120).nullable(),
    hrApprovedAt: z.string().datetime({ offset: true }).nullable(),
    recordedByName: name(120),
    hasReceipt: z.boolean(),
  })
  .refine(
    (body) => (body.hrApprovedByName === null) === (body.hrApprovedAt === null),
    {
      path: ["hrApprovedAt"],
      message: "HR's approval is who and when together — both or neither",
    },
  )
  .refine(
    (body) => body.hrStatus === "proposed" || body.hrApprovedAt !== null,
    {
      path: ["hrApprovedAt"],
      message: "An approved spend says who approved it and when",
    },
  );
export type SubmitSpendInput = z.infer<typeof submitSpendSchema>;

export const externalIdsQuerySchema = z.object({
  externalIds: z
    .string()
    .transform((value) =>
      value
        .split(",")
        .map((one) => one.trim())
        .filter(Boolean),
    )
    .pipe(
      z
        .array(z.string().uuid("Each id must be a uuid"))
        .min(1, "Give at least one id")
        .max(100, "At most 100 ids at a time"),
    ),
});
export type ExternalIdsQuery = z.infer<typeof externalIdsQuerySchema>;

export const PERIOD_STATUSES = ["received", "approved", "refused"] as const;
export const SPEND_STATUSES = [
  "received",
  "approved",
  "refused",
  "paid",
] as const;

export const listPeriodsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(PERIOD_STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
});
export type ListPeriodsQuery = z.infer<typeof listPeriodsQuerySchema>;

export const listSpendsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(SPEND_STATUSES).optional(),
  budgetExternalId: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
});
export type ListSpendsQuery = z.infer<typeof listSpendsQuerySchema>;

/**
 * Finance's decision. `received` puts a decision back — a mis-click, or a
 * question asked of HR — so a repeat from HR can amend it again. A refusal
 * says why: HR sees the note.
 */
export const decisionSchema = z
  .strictObject({
    decision: z.enum(["approved", "refused", "received"]),
    note: z.string().trim().max(500).nullable(),
  })
  .refine((body) => body.decision !== "refused" || Boolean(body.note), {
    path: ["note"],
    message: "Say why it is refused — HR sees this",
  });
export type DecisionInput = z.infer<typeof decisionSchema>;

/** Paying an approved spend: the expense it becomes in the books. */
export const paySpendSchema = z.strictObject({
  accountId: z.string().uuid("Choose the account it is paid from"),
  categoryId: z.string().uuid("Choose the expense heading"),
  txnDate: isoDateSchema,
  usdRate: z
    .string()
    .trim()
    .regex(/^\d{1,5}(\.\d{1,6})?$/, "Enter a rate like 122.77"),
  description: z.string().trim().min(2).max(300),
  notes: z.string().trim().max(1000).nullable(),
});
export type PaySpendInput = z.infer<typeof paySpendSchema>;
