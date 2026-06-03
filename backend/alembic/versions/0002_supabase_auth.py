"""supabase auth profile fields

Revision ID: 0002_supabase_auth
Revises: 0001_initial
Create Date: 2026-06-03 00:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "0002_supabase_auth"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("auth_user_id", sa.String(length=36), nullable=True))
    op.add_column("users", sa.Column("email", sa.String(length=255), nullable=True))
    op.alter_column("users", "telegram_id", existing_type=sa.BigInteger(), nullable=True)
    op.create_index(op.f("ix_users_auth_user_id"), "users", ["auth_user_id"], unique=True)
    op.create_index(op.f("ix_users_email"), "users", ["email"], unique=False)
    # Fresh installs with 0 users: backfill placeholder then enforce NOT NULL on auth_user_id
    op.execute(
        "UPDATE users SET auth_user_id = gen_random_uuid()::text WHERE auth_user_id IS NULL"
    )
    op.alter_column("users", "auth_user_id", nullable=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_users_email"), table_name="users")
    op.drop_index(op.f("ix_users_auth_user_id"), table_name="users")
    op.alter_column("users", "telegram_id", existing_type=sa.BigInteger(), nullable=False)
    op.drop_column("users", "email")
    op.drop_column("users", "auth_user_id")
