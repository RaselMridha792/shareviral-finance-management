import { amountSchema } from "@finance/shared";
import { z } from "zod";

/** The four money requests the HR portal sends (#125). */
export const REQUEST_KINDS = [
  "pay_change",
  "one_off",
  "budget",
  "spend",
] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];
export const requestKindSchema = z.enum(REQUEST_KINDS);

/**
 * What HR reads back, the same four words for all four kinds. Stored as the
 * budget tables already stored them — received, held, approved, refused —
 * and said here the way the HR portal asked for them.
 */
export type RequestState = "pending" | "held" | "approved" | "rejected";

export function stateOf(status: string): RequestState {
  if (status === "received") return "pending";
  if (status === "refused") return "rejected";
  if (status === "paid") return "approved";
  return status as RequestState;
}

const name = (max: number) => z.string().trim().min(1).max(max);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A date, YYYY-MM-DD");

/**
 * A pay change, as the HR portal sends it: the figure `POST
 * /team-members/:id/compensation` took, plus the HR row's own id and HR's
 * side of the decision. Stored and applied only when finance approves.
 */
export const submitPayChangeSchema = z
  .strictObject({
    externalId: z.string().uuid(),
    teamMemberId: z.string().uuid(),
    grossAmount: amountSchema.refine((value) => Number(value) > 0, {
      message: "The salary must be more than zero",
    }),
    effectiveFrom: isoDate,
    changeReason: z.string().trim().max(200).nullable().optional(),
    /** HR's own reason and note, which the CFO reads before deciding. */
    hrNote: z.string().trim().max(1000).nullable().optional(),
    requestedByName: name(120),
    hrApprovedByName: z.string().trim().min(1).max(120).nullable().optional(),
    hrApprovedAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .refine(
    (value) => Boolean(value.hrApprovedByName) === Boolean(value.hrApprovedAt),
    {
      message: "Who approved it in HR and when: both, or neither",
      path: ["hrApprovedAt"],
    },
  );
export type SubmitPayChangeInput = z.infer<typeof submitPayChangeSchema>;

/**
 * Finance's decision. `received` puts a decision back to waiting — only
 * while nothing has moved. A refusal and a hold both need the CFO's own
 * words: a refusal without a sentence is one HR cannot act on, and a hold is
 * a question that has to be asked.
 */
export const decisionSchema = z
  .strictObject({
    decision: z.enum(["approved", "refused", "held", "received"]),
    note: z.string().trim().max(1000).nullable().optional(),
  })
  .refine(
    (value) =>
      !(value.decision === "refused" || value.decision === "held") ||
      Boolean(value.note),
    {
      message: "Say why, in a sentence — HR reads it",
      path: ["note"],
    },
  );
export type DecisionInput = z.infer<typeof decisionSchema>;

export const listRequestsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  /** Waiting (pending and held) is the default view: it is the work. */
  state: z
    .enum(["waiting", "pending", "held", "approved", "rejected", "all"])
    .default("waiting"),
  kind: requestKindSchema.optional(),
  /** The month it takes effect in, YYYY-MM. */
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/, "A month, YYYY-MM")
    .optional(),
  q: z.string().trim().max(100).optional(),
});
export type ListRequestsQuery = z.infer<typeof listRequestsQuerySchema>;

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
