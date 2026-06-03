from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.subscription import Subscription
from app.models.user import User


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
