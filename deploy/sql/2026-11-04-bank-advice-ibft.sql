-- IBFT, a fifth payment type on a bank advice's line (the owner, 4 Nov 2026:
-- "IBFT akhon ei niyome beshirvag taka pathano jay"): an inter-bank fund
-- transfer, beside ACH, BT, RTGS and PAY. "IBFT" fits the column's
-- varchar(4) as it is; the check constraint is what has to learn it.
--
-- RUN THIS BEFORE THE CODE that writes it: a line saved as IBFT against the
-- old constraint is refused by the database.
--
-- The constraint was made inline by 2026-09-29-bank-advices.sql's
-- `create table if not exists`, which does nothing once the table exists, so
-- replaying the folder in order does not put the four-type rule back over
-- this one. Dropped and made again, so a second run changes nothing.
alter table bank_advice_lines
  drop constraint if exists bank_advice_lines_type_check;
alter table bank_advice_lines
  add constraint bank_advice_lines_type_check
  check (payment_type in ('ACH', 'BT', 'RTGS', 'PAY', 'IBFT'));
