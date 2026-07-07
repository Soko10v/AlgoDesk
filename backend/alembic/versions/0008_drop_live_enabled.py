"""drop strategies.live_enabled — live is gated by plan, not per-strategy

Revision ID: 0008_drop_live_enabled
Revises: 0007_events
Create Date: 2026-07-07 15:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "0008_drop_live_enabled"
down_revision = "0007_events"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    insp = sa.inspect(op.get_bind())
    return any(c["name"] == column for c in insp.get_columns(table))


def upgrade() -> None:
    if _has_column("strategies", "live_enabled"):
        op.drop_column("strategies", "live_enabled")


def downgrade() -> None:
    if not _has_column("strategies", "live_enabled"):
        op.add_column(
            "strategies",
            sa.Column("live_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        )
