"""discovered (auto-found best) strategies

Revision ID: 0006_discovered_strategies
Revises: 0005_trade_mode
Create Date: 2026-07-06 12:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "0006_discovered_strategies"
down_revision = "0005_trade_mode"
branch_labels = None
depends_on = None


def _has_table(table: str) -> bool:
    insp = sa.inspect(op.get_bind())
    return insp.has_table(table)


def upgrade() -> None:
    if _has_table("discovered_strategies"):
        return
    op.create_table(
        "discovered_strategies",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("subtitle", sa.String(length=255), nullable=False),
        sa.Column("symbol", sa.String(length=32), nullable=False),
        sa.Column("timeframe", sa.String(length=8), nullable=False),
        sa.Column("config_json", sa.JSON(), nullable=False),
        sa.Column("total_return_pct", sa.Float(), nullable=False, server_default="0"),
        sa.Column("max_drawdown_pct", sa.Float(), nullable=False, server_default="0"),
        sa.Column("win_rate", sa.Float(), nullable=False, server_default="0"),
        sa.Column("trades", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("score", sa.Float(), nullable=False, server_default="0"),
        sa.Column("period_days", sa.Integer(), nullable=False, server_default="30"),
        sa.Column("rank", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("discovered_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    if _has_table("discovered_strategies"):
        op.drop_table("discovered_strategies")
