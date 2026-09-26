# Frontend (Person 4)

React + TypeScript + Vite. Landscape phone app: capture a graph photo, confirm what was read,
then explore it by touch with speech and haptic guidance.

## Run

```sh
cd frontend
npx -y pnpm@10 install
npx -y pnpm@10 dev          # http://127.0.0.1:5173
```

Routes: `/` camera capture (plus "Upload image" = Controlled mode, and "Use saved graph"),
`#saved` explore the bundled US-unemployment graph with no camera or backend, `#slider` the old
slider page, `#spider-sense` Nico's ring harness.

## Backend on another laptop (e.g. Louks's)

The dev server proxies `/api/*` to the backend (so no CORS). The target defaults to
`http://localhost:8000` and is set with `VITE_BACKEND_URL`:

```sh
# Git Bash
VITE_BACKEND_URL=http://<louks-laptop-ip>:8000 npx -y pnpm@10 dev
# PowerShell
$env:VITE_BACKEND_URL='http://<louks-laptop-ip>:8000'; npx -y pnpm@10 dev
```

or put `VITE_BACKEND_URL=http://<ip>:8000` in `frontend/.env.local`. On Louks's laptop the
backend must listen on the LAN (`uvicorn app.main:app --host 0.0.0.0 --port 8000`) and the
firewall must allow port 8000. Check with `curl http://<ip>:8000/docs` from this laptop.

## Phone over USB

```sh
adb reverse tcp:5173 tcp:5173
```

then open `http://localhost:5173` on the phone (localhost counts as a secure context, so the
camera works without HTTPS). Only the phone -> this laptop hop goes over USB; this laptop ->
backend goes over the LAN via the proxy above, so the phone never needs the backend's address.

## Checks

```sh
npx -y pnpm@10 exec tsc -b
npx -y pnpm@10 build
npx -y pnpm@10 exec oxlint
```
