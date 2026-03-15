# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Desktop Google Messages client built as three cooperating layers: a Go backend that wraps the `libgm` (mautrix-gmessages) library, a React frontend, and an Electron shell that manages both. The backend talks to Google's RCS servers via `libgm`, exposes a REST + WebSocket API, and caches data in SQLite. The frontend is a pure web app that consumes that API. Electron spawns the backend binary, proxies WebSocket events for native notifications and dock badges, and loads the frontend.

## Architecture

- **backend/** — Go HTTP server (gorilla/mux). `main.go` boots the server; `server.go` defines routes; `handlers.go` has HTTP handlers; `client.go` wraps `libgm` for pairing, messaging, media, reactions; `events.go` handles libgm event callbacks; `websocket.go` is a hub that broadcasts events to connected WS clients; `models.go` defines API types and gmproto→API conversion functions; `db.go` is the SQLite cache layer.
- **frontend/** — React 19 + Vite 8 + Tailwind CSS 4 SPA. Entry at `src/main.tsx` → `App.tsx` which manages three views (loading/pairing/main). `src/api/client.ts` has typed API client and all WS event types. `src/hooks/useWebSocket.ts` provides a subscribe-based WS hook with auto-reconnect. Components: `ConversationList`, `MessageThread`, `MessageBubble`, `QRPairing`, `ReactionPicker`, `MediaPlayer`, `StatusBar`.
- **electron/** — Electron main process (`src/main.ts`) + preload (`src/preload.ts`). Spawns the backend binary, polls until ready, connects its own WS for notifications/badge, creates the BrowserWindow. In dev it checks if backend is already running before spawning.

## Development Commands

### Backend
```bash
cd backend
go build -o backend .    # build binary
go run .                 # run directly (default port 8080)
go run . --port 9090 --data ./mydata  # custom port/data dir
```

### Frontend
```bash
cd frontend
npm install
npm run dev              # Vite dev server on :5173
npm run build            # tsc + vite build
npm run lint             # eslint
```

### Electron
```bash
cd electron
npm install
npm run dev              # tsc + launch electron (expects backend running + frontend on :5173)
npm run build            # tsc + electron-builder (packages app with backend binary + frontend dist)
npm run typecheck        # tsc --noEmit
```

### Full dev workflow
1. `cd backend && go run .` (or `go build -o backend . && ./backend`)
2. `cd frontend && npm run dev`
3. `cd electron && npm run dev` (optional — or just use browser at localhost:5173)

## Key Conventions

- The API contract between backend and frontend is documented in `API_CONTRACT.md`. All REST endpoints and WebSocket event shapes are defined there.
- Backend uses `zerolog` for structured logging with component-scoped loggers.
- Frontend uses relative URLs (`/api/...`) — Vite proxies to backend in dev, Electron loads the built frontend from resources in production.
- Session data persists in `{dataDir}/session.json`; message cache in `{dataDir}/messages.db`.
- The backend falls back to SQLite cache when the libgm client is disconnected.
- Electron manages backend lifecycle: spawns binary, waits for health check, kills on quit. In dev mode it skips spawning if backend is already reachable on the port.
- CORS is configured for `localhost:5173` (Vite dev) and `localhost:8080` (backend self).
