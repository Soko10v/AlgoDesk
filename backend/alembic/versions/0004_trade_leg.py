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


def upgrade() -> None:
    op.add_column(
        "trades",
        sa.Column("leg", sa.String(length=10), nullable=False, server_default="main"),
    )


def downgrade() -> None:
    op.drop_column("trades", "leg")
