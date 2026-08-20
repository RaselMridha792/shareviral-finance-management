-- The bell in the top bar.
--
-- A different table from `notification_log`, and deliberately so. That one
-- records that a message left the building — one row per address, whether or
-- not the address belongs to anybody with an account here. This one is one row
-- per person per thing, with a read mark, because in-app the question is not
-- "was it sent" but "has this person seen it".

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who it is for. The bell is personal.
  user_id uuid NOT NULL,

  -- Which of the four events raised it. Text, not an enum, so the fifth kind
  -- does not need a migration in two databases.
  kind text NOT NULL,

  -- What makes this one distinct from the next: `subscription:<id>:2026-08-23`,
  -- `tds:2026-07`, and so on. Never null — a unique index over a null is not
  -- unique in Postgres, and the job that writes these runs every day.
  dedupe_key varchar(160) NOT NULL,

  title varchar(200) NOT NULL,
  body text,
  -- Where clicking it goes. Null for the few with nowhere to send.
  href varchar(300),

  created_at timestamptz NOT NULL DEFAULT now(),
  -- Null until read. The bell counts the nulls.
  read_at timestamptz
);

-- The index that makes a daily job safe to run a hundred times.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_once_idx
  ON notifications (user_id, kind, dedupe_key);

-- The bell's own query: this person's, newest first.
CREATE INDEX IF NOT EXISTS notifications_for_user_idx
  ON notifications (user_id, created_at DESC);

-- Which events raise one.
--
-- Four columns rather than one JSON blob: these are read by the job that
-- raises each event, and a typo in a key is a feature that silently never
-- fires. On by default, because a bell that has to be switched on before it
-- says anything is a bell nobody knows exists.
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS notify_renewals boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_tds_deadline boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_payroll_unpaid boolean NOT NULL DEFAULT true,
  -- Off by default, and the one that has to be. The audit log catches every
  -- write in this app; a bell wired to all of it is one nobody looks at within
  -- a week. It raises only for a voided money row, a changed salary, or an
  -- edit inside a locked period, and only to super admins.
  ADD COLUMN IF NOT EXISTS notify_significant_changes boolean NOT NULL DEFAULT false;
