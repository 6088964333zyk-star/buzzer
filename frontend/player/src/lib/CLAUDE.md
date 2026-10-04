# frontend/player/src/lib/

## Purpose
Small shared helpers: the REST client, the Tailwind class-merge utility, and a JWT expiry check.

## Contents
- `api.ts` — `api.get` / `api.post` wrapping `fetch('/api' + path)`. Adds `Authorization: Bearer`
  from `localStorage.token`, throws `Error(detail)` on non-2xx, returns `{}` for empty bodies.
- `utils.ts` — `cn(...)` (`clsx` + `tailwind-merge`) and `isTokenExpired(token)`, which decodes
  the JWT payload in the browser and compares `exp` to now (no signature check).

## How it fits in
`api` is used by the pre-game pages (room ping, guest/login token requests). Game traffic goes
over `socket.io-client` in `../pages/game/GameLayout.tsx`, which calls `isTokenExpired` before
connecting.

## Gotchas
- Only `get` and `post` exist — no `put`/`patch`/`delete`.
- Always sends `Content-Type: application/json`; not usable for file uploads as-is.
- `isTokenExpired` only saves a pointless connection attempt — the server still validates the token.
- Differs from host/admin `lib/`: host has `api.delete` but no `isTokenExpired`.
