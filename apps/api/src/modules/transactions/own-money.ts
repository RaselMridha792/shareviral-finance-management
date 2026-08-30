import { sql, type SQL } from "drizzle-orm";

import { transactions } from "../../db/schema";

/**
 * A movement between two of our own accounts is not money the company spent.
 *
 * A transfer is stored as two rows sharing a `transfer_group_id` — one `out`
 * of the sending account, one `in` to the receiving one. Both are real ledger
 * entries and both belong on an account's own register, because the money did
 * leave one bank and arrive at the other, and a balance that ignored them
 * would stop matching the bank's own paper.
 *
 * But the company is no poorer afterwards. So every figure answering **"what
 * did we spend"** or **"what moved through the company"** has to leave them
 * out, and the owner found the proof on the Other expenses screen: loading the
 * USD card from the bank account was listed as an expense, under no category,
 * beside the electricity bill.
 *
 * Measured before it was fixed — a ৳50,000 transfer between two of our own
 * accounts moved: the Other expenses list (+1 row), the strip's `moneyOut`
 * (+50,000) and the Reports overview's `moneyOut` (+50,000). The category
 * breakdown was already immune, because a transfer carries no category and
 * that query joins one.
 *
 * The rule lives here, once, for the reason this codebase keeps re-learning:
 * a condition written out in four queries is right in three of them.
 *
 * **Where it must NOT be applied**, and why each is deliberate:
 *
 *  - the account register and the bank statement — they answer "what moved
 *    through this account", and the running balance is built from it;
 *  - the per-account blocks on the dashboard (`accountGroups`), for the same
 *    reason: money genuinely left the card;
 *  - All transactions — it is the ledger, and a transfer is a ledger entry;
 *  - account balances and the overdraft rule, which are arithmetic over every
 *    row that ever touched the account.
 */
export function notATransfer(): SQL {
  return sql`${transactions.transferGroupId} is null`;
}
