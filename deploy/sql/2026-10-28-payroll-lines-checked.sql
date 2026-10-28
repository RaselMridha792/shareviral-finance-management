-- The Check column on the salary sheet: Checked or Unchecked, ticked by hand
-- on each person's line (the owner, 28 Oct 2026: "new 2ta column add korba
-- transactions fee and (check: checked, unchecked name.)").
--
-- A review mark rather than a figure, so the app lets it change after the
-- sheet is finalised. Every line already on file starts unchecked.
--
-- RUN THIS BEFORE THE CODE that reads it: Drizzle names every column in its
-- SELECT, so code that knows `checked` against a table without it fails every
-- payroll query.
--
-- Defined here and nowhere else; IF NOT EXISTS, so a second run changes
-- nothing.
alter table payroll_lines
  add column if not exists checked boolean not null default false;
