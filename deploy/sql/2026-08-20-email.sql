-- Email, and the log that stops it saying the same thing twice.
--
-- Nothing in this app has ever sent a message. These are the three things that
-- have to exist before it can: somewhere to keep the provider's key, an address
-- to copy reminders to, and a record of what has already gone out.

-- The provider's key, sealed the same way the Anthropic key is — see
-- apps/api/src/common/crypto/secret-box.ts. Never returned to a browser; the
-- Settings screen gets a hint like "re_ab…9f" and nothing more.
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS resend_api_key text,
  ADD COLUMN IF NOT EXISTS resend_key_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS resend_key_set_by uuid,
  -- Who mail appears to be from. Must be on a domain the provider has verified,
  -- which is what the DNS records in Settings are for.
  ADD COLUMN IF NOT EXISTS email_from varchar(200),
  -- The admin address every reminder is copied to, as the owner asked.
  ADD COLUMN IF NOT EXISTS email_admin_address varchar(200),
  -- Off until somebody turns it on. A half-configured mailer that starts
  -- sending the moment a key is pasted is how test messages reach customers.
  ADD COLUMN IF NOT EXISTS email_enabled boolean NOT NULL DEFAULT false;

-- What has been sent, and what happened.
--
-- The reason this table exists is not reporting. It is that the job runs every
-- day and a renewal is three days away for exactly one of them — but a restart,
-- a retry, or a clock that crosses midnight twice would each send again. People
-- filter an app that mails them twice, and then the reminder that mattered is
-- in a folder nobody opens.
CREATE TABLE IF NOT EXISTS notification_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What the message was about. `subscription_renewal` today; the column exists
  -- so the second kind does not need a second table.
  kind text NOT NULL,
  -- The thing it was about, and the date it was about — a renewal on the 19th
  -- and the same plan's renewal next month are different messages.
  subject_id uuid,
  subject_date date,

  recipient varchar(200) NOT NULL,

  sent_at timestamptz NOT NULL DEFAULT now(),
  -- 'sent' or 'failed'. A failure is recorded rather than retried forever: a
  -- reminder that silently failed is worse than none, because it is relied on.
  outcome text NOT NULL,
  error text
);

-- The uniqueness that does the actual work. One message per kind, per thing,
-- per date, per person — enforced by the database rather than by remembering.
CREATE UNIQUE INDEX IF NOT EXISTS notification_log_once_idx
  ON notification_log (kind, subject_id, subject_date, recipient)
  WHERE outcome = 'sent';

CREATE INDEX IF NOT EXISTS notification_log_sent_at_idx
  ON notification_log (sent_at DESC);
