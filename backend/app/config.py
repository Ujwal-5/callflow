import os
from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    SUPABASE_URL: str = ""
    SUPABASE_SECRET_KEY: str = ""
    SUPABASE_SERVICE_ROLE_KEY: str = ""
    SUPABASE_KEY: str = ""
    GEMINI_API_KEY: str = ""
    # Optional backup key. Used automatically when the primary key hits its quota.
    GEMINI_API_KEY_2: str = ""
    MISTRAL_API_KEY: str = ""
    MISTRAL_MODEL: str = "ministral-14b-latest"
    FRONTEND_ORIGIN: str = "http://localhost:3000,http://127.0.0.1:3000"
    # Optional regex for allowed origins (e.g. Vercel preview deployments).
    # Matches the project's production and preview domains by default.
    FRONTEND_ORIGIN_REGEX: str = r"https://callflow[a-z0-9-]*\.vercel\.app"
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
    def cors_origin_regex(self) -> str:
        return self.FRONTEND_ORIGIN_REGEX.strip()

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

    @property
    def gemini_api_keys(self) -> List[str]:
        """Return all configured Gemini API keys, in priority order, without duplicates."""
        keys: List[str] = []
        for raw in (self.GEMINI_API_KEY, self.GEMINI_API_KEY_2):
            key = (raw or "").strip()
            if key and key not in keys:
                keys.append(key)
        return keys

    @property
    def gemini_configured(self) -> bool:
        return bool(self.gemini_api_keys)

    @property
    def mistral_configured(self) -> bool:
        return bool(self.MISTRAL_API_KEY.strip())


settings = Settings()
