import logging
import sqlite3
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from .settings import Settings
from .infrastructure.database import Database
from .infrastructure.catalog_seed import seed_catalog
from .infrastructure.unit_of_work import SQLiteUnitOfWorkFactory
from .infrastructure.ai import OpenAIJSONClient
from .bootstrap import build_services
from .api.responses import ErrorResponse, HealthResponse
from .errors import AppError
from .api import skills, practice, progress, graph, evidence, projects, bridge, auth


def create_app(settings=None, ai=None):
    settings = settings or Settings.from_env()
    database = Database(settings.database_path)

    @asynccontextmanager
    async def lifespan(app):
        database.initialize()
        seed_catalog(database, settings.catalog_path)
        app.state.ai = ai or OpenAIJSONClient(settings)
        app.state.services = build_services(SQLiteUnitOfWorkFactory(database), app.state.ai)
        yield

    errors = {status: {"model": ErrorResponse} for status in (401, 403, 404, 409, 410, 429, 502, 503)}
    app = FastAPI(title="Flash Training Career Lab", version="3.0.0", lifespan=lifespan, responses=errors)
    app.state.settings = settings
    app.add_middleware(CORSMiddleware, allow_origins=list(settings.cors_origins),
                       allow_credentials=True, allow_methods=["GET", "POST", "PATCH", "DELETE"],
                       allow_headers=["Content-Type", "X-Requested-With", "X-Account-ID"])

    @app.middleware("http")
    async def private_responses(request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(AppError)
    async def app_error(request, exc):
        return JSONResponse(status_code=exc.status, content=ErrorResponse(code=exc.code,
                            msg=exc.message, detail=exc.message).model_dump())

    @app.exception_handler(sqlite3.IntegrityError)
    async def conflict(request, exc):
        logging.getLogger(__name__).warning("Database constraint rejected a write")
        message = "数据已存在或关联无效，请刷新后重试。"
        return JSONResponse(status_code=409, content=ErrorResponse(code="data_conflict", msg=message, detail=message).model_dump())

    @app.exception_handler(sqlite3.OperationalError)
    async def database_error(request, exc):
        logging.getLogger(__name__).error("Database operation failed: %s", type(exc).__name__)
        message = "数据库暂不可用，请检查服务日志。"
        return JSONResponse(status_code=503, content=ErrorResponse(code="database_unavailable", msg=message, detail=message).model_dump())

    @app.get("/api/health", tags=["system"], response_model=HealthResponse)
    def health() -> HealthResponse:
        version = database.check_health()
        return HealthResponse(schema_version=version, ai_configured=getattr(app.state.ai, "configured", False),
                              ai_api_style=settings.ai_api_style, ai_model=settings.ai_model)

    app.include_router(skills.router)
    app.include_router(auth.router)
    app.include_router(practice.router)
    app.include_router(progress.router)
    app.include_router(graph.router)
    app.include_router(evidence.router)
    app.include_router(projects.router)
    app.include_router(bridge.router)
    return app
