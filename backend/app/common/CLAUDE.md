# backend/app/common/

## Purpose
Cross-cutting helpers used by every router: authentication dependencies, the app's error
types, structured logging setup, and the rate limiter.

## Contents
- `__init__.py` — empty.
- `dependencies.py` — FastAPI dependencies. `get_current_user` reads a JWT from the
  `Authorization: Bearer` header or the `access_token` cookie, accepts `access` and `temp`
  token types, and loads the `User`. `require_admin` (role ADMIN only) and `require_user`
  (ADMIN or USER; rejects GUEST) build on it. `get_refresh_token` reads the refresh cookie.
- `exceptions.py` — `BuzzerError` base plus `NotFoundError` (404), `ForbiddenError` (403),
  `UnauthorizedError` (401), `ConflictError` (409); `register_exception_handlers` turns them
  into `{"error": CODE, "message": ...}` JSON, formats 422s, and hides unexpected errors
  behind a generic 500.
- `logging.py` — structlog configuration: colored console in development, JSON otherwise;
  quiets uvicorn access logs outside dev unless stress-test mode is on.
- `rate_limit.py` — slowapi `limiter`. In development every request gets a random key, so
  limits never fire locally; `STRESS_TEST_KEY` + `X-Stress-Key` header bypasses them in tests.

## How it fits in
Routers take `Depends(require_admin)` / `Depends(require_user)` for global-role checks and
raise the `BuzzerError` subclasses instead of `HTTPException` (the one exception is
`admin.import_game`, which raises `HTTPException` directly). The WebSocket gateway does its own JWT check at connect time and
does not use these dependencies.

## Gotchas
- **There is no "is HOST of this course" dependency here.** Only global roles are checked.
  The per-course check exists as a service helper instead —
  `services/game_service.assert_host_can_use_course` (ADMIN passes; otherwise requires a
  `UserCourseAccess` HOST row) — but today only `create_room` calls it. T4's new host
  endpoints must call it (or wrap it as a dependency); forgetting is an access-control hole.
- Because rate limits are disabled in development, local testing cannot tell you whether a
  limit would trip in production.
- `temp` tokens (onboarding) pass `get_current_user`, so a route that must not accept an
  onboarding user has to check the token type itself.
