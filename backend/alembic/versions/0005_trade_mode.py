"""trade mode (paper vs live)

Revision ID: 0005_trade_mode
Revises: 0004_trade_leg
Create Date: 2026-06-14 23:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "0005_trade_mode"
down_revision = "0004_trade_leg"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    insp = sa.inspect(op.get_bind())
    return any(c["name"] == column for c in insp.get_columns(table))


def upgrade() -> None:
    # Idempotent: safe to re-run if the schema drifted ahead of alembic_version.
    if not _has_column("trades", "mode"):
        op.add_column(
            "trades",
            sa.Column("mode", sa.String(length=10), nullable=False, server_default="paper"),
        )


def downgrade() -> None:
    if _has_column("trades", "mode"):
        op.drop_column("trades", "mode")
