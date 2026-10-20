from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from backend.app.config import settings
from backend.app.db import db
from backend.app.routes import router
from backend.app.models import HealthResponse, ReadinessResponse


@asynccontextmanager
async def lifespan(app: FastAPI):
    # The adapter owns the Supabase client; schema management belongs in Supabase migrations.
    try:
        yield
    finally:
        db.close()


app = FastAPI(
    title="CallFlow API",
    description="AI-Powered Cold Call Assistant API",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS Configuration: allow local Next.js frontend and configured origins
cors_origins = settings.cors_origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_origin_regex=settings.cors_origin_regex or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Core health endpoint
@app.get("/health", response_model=HealthResponse, tags=["Health"])
def health():
    db_mode = "supabase" if db.use_supabase else "unconfigured"
    return {
        "status": "ok",
        "service": "callflow-api",
        "database_mode": db_mode,
        "gemini_configured": settings.gemini_configured,
        "version": "1.0.0",
    }


@app.get("/health/db", tags=["Health"])
def database_health():
    """Report database readiness separately from process health."""
    try:
        db.database_readiness()
    except Exception as exc:
        from fastapi import HTTPException
        raise HTTPException(status_code=503, detail=f"Database is not ready: {type(exc).__name__}")
    return {"status": "ok", "supabase_db": "ok" if db.use_supabase else "unconfigured"}


@app.get("/health/ready", response_model=ReadinessResponse, tags=["Health"])
def readiness():
    """Run real dependency checks for manual operational verification.

    This endpoint intentionally performs live Supabase and Gemini requests. It
    is not used as the Render liveness probe because the external checks can
    be slower and may consume Gemini quota.
    """
    checks = {}

    try:
        if not db.use_supabase:
            raise RuntimeError("Supabase is not configured")
        db.database_readiness()
        checks["supabase_db"] = {"status": "ok"}
    except Exception as exc:
        checks["supabase_db"] = {
            "status": "failed",
            "detail": type(exc).__name__,
        }

    try:
        if not settings.gemini_configured:
            raise RuntimeError("Gemini is not configured")

        from google.genai import types
        from backend.app.gemini_pool import light_text_model_pool

        def _gemini_probe(client, model_name: str):
            return client.models.generate_content(
                model=model_name,
                contents="Reply with exactly: OK",
                config=types.GenerateContentConfig(max_output_tokens=2),
            )

        response = light_text_model_pool.execute_with_fallback(_gemini_probe)
        if not getattr(response, "text", None):
            raise RuntimeError("Gemini returned an empty response")
        checks["gemini"] = {"status": "ok"}
    except Exception as exc:
        checks["gemini"] = {
            "status": "failed",
            "detail": type(exc).__name__,
        }

    is_ready = all(check["status"] == "ok" for check in checks.values())
    payload = {
        "status": "ready" if is_ready else "not_ready",
        "service": "callflow-api",
        "version": "1.0.0",
        "checks": checks,
    }
    return JSONResponse(status_code=200 if is_ready else 503, content=payload)


# Include business routes
app.include_router(router)


if __name__ == "__main__":
    import uvicorn
    import os
    port = int(os.environ.get("PORT", settings.PORT))
    uvicorn.run("backend.main:app", host="0.0.0.0", port=port, reload=True)
