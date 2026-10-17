import os
from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    SUPABASE_URL: str = ""
    SUPABASE_SECRET_KEY: str = ""
    SUPABASE_SERVICE_ROLE_KEY: str = ""
    SUPABASE_KEY: str = ""
    DATABASE_URL: str = ""
    GEMINI_API_KEY: str = ""
    FRONTEND_ORIGIN: str = "http://localhost:3000,http://127.0.0.1:3000"
    SQLITE_DB_PATH: str = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "callflow.db")
    PORT: int = 8000

    class Config:
        env_file = (
            os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"),
            ".env",
        )
        env_file_encoding = "utf-8"
        extra = "ignore"

    @property
    def cors_origins(self) -> List[str]:
        origins = [orig.strip() for orig in self.FRONTEND_ORIGIN.split(",") if orig.strip()]
        # Always allow standard local Next.js ports
        defaults = ["http://localhost:3000", "http://127.0.0.1:3000"]
        for d in defaults:
            if d not in origins:
                origins.append(d)
        return origins

    @property
    def supabase_key(self) -> str:
        return (
            self.SUPABASE_SECRET_KEY
            or self.SUPABASE_SERVICE_ROLE_KEY
            or self.SUPABASE_KEY
        ).strip()

    @property
    def use_supabase(self) -> bool:
        return bool(self.SUPABASE_URL.strip() and self.supabase_key)


settings = Settings()
