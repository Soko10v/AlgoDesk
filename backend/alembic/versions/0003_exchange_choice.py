"""per-user exchange choice

Revision ID: 0003_exchange_choice
Revises: 0002_supabase_auth
Create Date: 2026-06-04 00:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "0003_exchange_choice"
down_revision = "0002_supabase_auth"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("exchange", sa.String(length=16), nullable=False, server_default="bybit"),
    )


def downgrade() -> None:
    op.drop_column("users", "exchange")
