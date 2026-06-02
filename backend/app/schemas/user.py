from datetime import datetime

from pydantic import BaseModel


class UserOut(BaseModel):
    id: int
    telegram_id: int
    username: str | None
    created_at: datetime

    model_config = {"from_attributes": True}
