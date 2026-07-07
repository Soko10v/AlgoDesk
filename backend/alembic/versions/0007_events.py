"""in-house analytics events

Revision ID: 0007_events
Revises: 0006_discovered_strategies
Create Date: 2026-07-07 12:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "0007_events"
down_revision = "0006_discovered_strategies"
branch_labels = None
depends_on = None


def _has_table(table: str) -> bool:
    insp = sa.inspect(op.get_bind())
    return insp.has_table(table)


def upgrade() -> None:
    if _has_table("events"):
        return
    op.create_table(
        "events",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("anon_id", sa.String(length=64), nullable=True),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("path", sa.String(length=255), nullable=True),
        sa.Column("properties_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_events_name", "events", ["name"])
    op.create_index("ix_events_anon_id", "events", ["anon_id"])
    op.create_index("ix_events_user_id", "events", ["user_id"])
    op.create_index("ix_events_created_at", "events", ["created_at"])


def downgrade() -> None:
    if _has_table("events"):
        op.drop_table("events")
