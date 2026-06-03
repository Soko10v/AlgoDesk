-- AlgoDesk initial schema (mirrors backend/alembic/versions/0001_initial.py)
-- Apply via Supabase Dashboard → SQL, or: supabase db push

create table if not exists users (
    id serial primary key,
    telegram_id bigint not null unique,
    username varchar(255),
    api_key_encrypted varchar(1024),
    api_secret_encrypted varchar(1024),
    created_at timestamptz default now()
);

create index if not exists ix_users_id on users (id);
create index if not exists ix_users_telegram_id on users (telegram_id);

create table if not exists strategies (
    id serial primary key,
    user_id integer not null references users (id) on delete cascade,
    name varchar(255) not null,
    config_json jsonb not null,
    status varchar(32) not null,
    live_enabled boolean not null,
    created_at timestamptz default now()
);

create index if not exists ix_strategies_id on strategies (id);
create index if not exists ix_strategies_user_id on strategies (user_id);

create table if not exists trades (
    id serial primary key,
    strategy_id integer not null references strategies (id) on delete cascade,
    symbol varchar(30) not null,
    side varchar(10) not null,
    price double precision not null,
    amount double precision not null,
    pnl double precision,
    timestamp timestamptz default now()
);

create index if not exists ix_trades_id on trades (id);
create index if not exists ix_trades_strategy_id on trades (strategy_id);
create index if not exists ix_trades_timestamp on trades (timestamp);

create table if not exists subscriptions (
    id serial primary key,
    user_id integer not null unique references users (id) on delete cascade,
    plan varchar(32) not null,
    expires_at timestamptz,
    paid_in_usdt double precision not null
);

create index if not exists ix_subscriptions_id on subscriptions (id);
create index if not exists ix_subscriptions_user_id on subscriptions (user_id);
