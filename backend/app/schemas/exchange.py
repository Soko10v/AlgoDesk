from pydantic import BaseModel, Field


class ExchangeConnectIn(BaseModel):
    api_key: str = Field(min_length=3)
    api_secret: str = Field(min_length=3)
