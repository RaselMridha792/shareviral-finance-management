-- Whether reminders also go to the people who can sign in.
--
-- A sign-in address is a login, not necessarily a mailbox. This company's
-- super admin signs in as an address with no inbox behind it, so every
-- reminder sent there bounces — and a provider that scores senders counts
-- those bounces against the mail that matters. The owner needs to be able to
-- say "only the address I typed in Settings".
--
-- On by default: for most installations the sign-in address is a real person's
-- mailbox, and defaulting this off would quietly leave the CFO uninformed.
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS email_to_staff boolean NOT NULL DEFAULT true;
