from pydantic import BaseModel


class AuthConfigOut(BaseModel):
    supabase_url: str
    supabase_anon_key: str
