-- Supabase Auth profile fields (run after 20260603000000_initial.sql)

alter table users add column if not exists auth_user_id varchar(36);
alter table users add column if not exists email varchar(255);
alter table users alter column telegram_id drop not null;

create unique index if not exists ix_users_auth_user_id on users (auth_user_id);
create index if not exists ix_users_email on users (email);

-- Enforce NOT NULL only when table is empty or after manual backfill
-- alter table users alter column auth_user_id set not null;
