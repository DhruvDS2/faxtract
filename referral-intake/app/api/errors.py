"""Every 4xx (and the 5xx we raise on purpose) has the ErrorBody shape:
{detail, errors[], status, flags[]} (docs/CONTRACTS.md §5)."""
from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.contracts import ErrorBody, FieldError
from app.models import Flag

log = logging.getLogger("faxtract.api")


class ApiError(Exception):
    def __init__(self, status_code: int, detail: str, *, errors: list[FieldError] | None = None,
                 status: str | None = None, flags: list[Flag] | None = None):
        super().__init__(detail)
        self.status_code = status_code
        self.body = ErrorBody(detail=detail, errors=errors or [], status=status, flags=flags or [])


def error_response(status_code: int, body: ErrorBody) -> JSONResponse:
    return JSONResponse(status_code=status_code, content=body.model_dump(mode="json"))


def not_found(what: str) -> ApiError:
    return ApiError(404, f"{what} not found")


def _loc_to_field(loc) -> str:
    parts = [str(p) for p in loc if p not in ("body", "query", "path", "form")]
    return ".".join(parts) or "body"


def install(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError):
        return error_response(exc.status_code, exc.body)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError):
        errors = [FieldError(field=_loc_to_field(e.get("loc", ())), message=e.get("msg", "invalid"))
                  for e in exc.errors()]
        detail = "; ".join(f"{e.field}: {e.message}" for e in errors) or "invalid request"
        return error_response(422, ErrorBody(detail=detail, errors=errors))

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException):
        detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
        return error_response(exc.status_code, ErrorBody(detail=detail))
