from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.app.config import settings
from backend.app.db import db
from backend.app.routes import router
from backend.app.models import HealthResponse


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
    return {"status": "ok", "database_mode": "supabase" if db.use_supabase else "unconfigured"}


# Include business routes
app.include_router(router)


if __name__ == "__main__":
    import uvicorn
    import os
    port = int(os.environ.get("PORT", settings.PORT))
    uvicorn.run("backend.main:app", host="0.0.0.0", port=port, reload=True)
