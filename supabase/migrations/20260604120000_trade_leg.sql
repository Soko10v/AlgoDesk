-- Trade leg: "main" position vs "hedge" short leg (run after 20260604000000_exchange_choice.sql)
-- Mirrors backend/alembic/versions/0004_trade_leg.py

alter table trades add column if not exists leg varchar(10) not null default 'main';
