import { z } from "zod";

/**
 * A PATCH body built from a create schema: every field optional, and **no
 * defaults**.
 *
 * `createSchema.partial()` looks like it does this and does not. Zod keeps the
 * `.default()` inside the now-optional field, so an absent key is not absent —
 * it is materialised with its default value on the way out of `parse`. A
 * service that spreads the parsed object into its SET clause then writes
 * fields the caller never mentioned.
 *
 * That was not theoretical. Three endpoints did exactly this:
 *
 * - `PATCH /accounts/:id` with a name and a note **zeroed the opening
 *   balance**, because `openingBalance` defaults to `"0"` — and an empty body
 *   `{}` passed the "nothing to change" guard, because the defaults had
 *   already put three keys in the object. One account fell from ৳2,60,739 to
 *   ৳1,60,739 across every screen at once, each of them agreeing on the wrong
 *   figure.
 * - `PATCH /team-members/:id` with `{status, endedOn}` — the exact body the
 *   Change status dialog sends — **turned a contractor into an employee** and
 *   wiped their PSR status. `engagementType` is the field that keeps
 *   contractors off the salary sheet.
 * - `PATCH /vendors/:id` reset a **USD 3,000/month** subscription to **BDT
 *   3,000/month**: wrong by the exchange rate, and reading as entirely normal.
 *
 * In each case the audit trail recorded the change faithfully. It was simply
 * never requested.
 *
 * So: unwrap the default, then make the field optional. A field that was
 * already optional stays as it is. What is not in the body does not reach the
 * database.
 */
export function patchOf<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
): z.ZodObject<{ [K in keyof T]: z.ZodOptional<T[K]> }> {
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([key, field]) => {
      const type = field as z.ZodType & {
        def?: { type?: string; innerType?: z.ZodType };
      };
      // `.default()` wraps the real field; unwrap before making it optional so
      // the default can never be applied to an absent key.
      const inner =
        type.def?.type === "default" && type.def.innerType
          ? type.def.innerType
          : type;
      return [key, inner.optional()];
    }),
  );

  // The cast restores the field types the loop erases. Unwrapping a
  // `.default()` does not change what the field accepts or produces — only
  // whether an absent key is invented — so `ZodOptional<T[K]>` still describes
  // the result exactly.
  return z.strictObject(shape) as unknown as z.ZodObject<{
    [K in keyof T]: z.ZodOptional<T[K]>;
  }>;
}

/**
 * A boolean from a query string, where `"false"` means false.
 *
 * `z.coerce.boolean()` is `Boolean(value)`, and `Boolean("false")` is `true` —
 * so every one of these parameters did the opposite of what it was asked when
 * the caller was explicit. `?includeVoided=false` *included* voided rows:
 * money that had been struck out reappeared in the totals, ৳50,000 of it in
 * one measured case, and the same schema drives the Excel export, so it
 * reached a file somebody keeps. `?hasReceipt=false` returned exactly the rows
 * that *have* a receipt.
 *
 * Absent stays absent, so `.default()` and `.optional()` behave as they read.
 */
export const boolish = z
  .union([z.boolean(), z.string(), z.number()])
  .transform((value) => {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    const text = value.trim().toLowerCase();
    return !(text === "" || text === "false" || text === "0" || text === "no");
  });
