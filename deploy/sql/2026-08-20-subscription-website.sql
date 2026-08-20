-- Where the tool actually lives.
--
-- The register names thirty tools and holds no address for any of them, so
-- "open Claude's billing page" means remembering the URL or searching for it.
-- The name on the row is the obvious place to click and it went nowhere.
--
-- Nullable and no default: a plan recorded before this existed has no address,
-- and inventing one from the tool's name would be a guess printed as a fact.
--
-- `IF NOT EXISTS` because this is applied to the local database and the VPS
-- separately.
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS website_url varchar(500);
