-- A subscription carries the same two numbers every other money row does.
--
-- `invoice_no` is ours — the bill the plan was charged against. `reference` is
-- theirs — what the bank or the card statement calls the payment. One column
-- would hold whichever was typed first, which is how the other fact ends up
-- nowhere.
--
-- Both nullable and both without a default: a plan recorded before this existed
-- has neither, and inventing one would be worse than leaving it blank.
--
-- `IF NOT EXISTS` because this is applied to the local database and the VPS
-- separately, and a migration that fails the second time is one somebody learns
-- to skip.
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS invoice_no varchar(60),
  ADD COLUMN IF NOT EXISTS reference varchar(120);
