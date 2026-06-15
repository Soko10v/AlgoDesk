"""trade leg (main vs hedge)

Revision ID: 0004_trade_leg
Revises: 0003_exchange_choice
Create Date: 2026-06-04 12:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "0004_trade_leg"
down_revision = "0003_exchange_choice"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    insp = sa.inspect(op.get_bind())
    return any(c["name"] == column for c in insp.get_columns(table))


def upgrade() -> None:
    # Idempotent: the column may already exist if the schema drifted ahead of
    # alembic_version (re-running this migration must not fail on a duplicate).
    if not _has_column("trades", "leg"):
        op.add_column(
            "trades",
            sa.Column("leg", sa.String(length=10), nullable=False, server_default="main"),
        )


def downgrade() -> None:
    if _has_column("trades", "leg"):
        op.drop_column("trades", "leg")
