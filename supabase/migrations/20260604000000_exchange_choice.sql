-- Per-user exchange choice (run after 20260603100000_supabase_auth.sql)
-- Mirrors backend/alembic/versions/0003_exchange_choice.py

alter table users add column if not exists exchange varchar(16) not null default 'bybit';
