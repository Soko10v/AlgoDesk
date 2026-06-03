import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.subscription import Subscription
from app.models.user import User

TELEGRAM_AUTH_NAMESPACE = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")


def telegram_auth_user_id(telegram_id: int) -> str:
    return str(uuid.uuid5(TELEGRAM_AUTH_NAMESPACE, f"telegram:{telegram_id}"))


async def get_or_create_user_for_auth(
    db: AsyncSession,
    auth_user_id: str,
    email: str | None,
) -> User:
    user = (await db.execute(select(User).where(User.auth_user_id == auth_user_id))).scalar_one_or_none()
    if user is None:
        user = User(auth_user_id=auth_user_id, email=email)
        db.add(user)
        await db.flush()
        db.add(Subscription(user_id=user.id, plan="free", paid_in_usdt=0.0))
    elif email and user.email != email:
        user.email = email
    await db.commit()
    await db.refresh(user)
    return user


async def get_or_create_user_for_telegram(
    db: AsyncSession,
    telegram_id: int,
    username: str | None,
) -> User:
    user = (await db.execute(select(User).where(User.telegram_id == telegram_id))).scalar_one_or_none()
    auth_user_id = telegram_auth_user_id(telegram_id)
    if user is None:
        user = User(auth_user_id=auth_user_id, telegram_id=telegram_id, username=username)
        db.add(user)
        await db.flush()
        db.add(Subscription(user_id=user.id, plan="free", paid_in_usdt=0.0))
    else:
        user.username = username
        if not user.auth_user_id:
            user.auth_user_id = auth_user_id
    await db.commit()
    await db.refresh(user)
    return user
