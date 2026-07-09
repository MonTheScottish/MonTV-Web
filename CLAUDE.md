# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

MonTV Web Player — browser-based IPTV player (Vietnamese channels). Mirrors the Android TV app's channel/EPG data model; UI tailored for web. Stack: React 19 + TypeScript + Vite 8. HLS playback via `hls.js`. Local dev runs on HTTPS via `@vitejs/plugin-basic-ssl` to enable EME/DRM in the browser (Vite config in `vite.config.ts`).

## Commands

```bash
pnpm install          # Install
pnpm dev              # Dev server on https://localhost:5173
pnpm build            # tsc -b && vite build (type-check + production build)
pnpm preview          # Preview production build
pnpm lint             # oxlint (oxlint only — no formatter wired up)
```

Build script runs `tsc -b` first; expect strict type errors there, not just at build commit. `tsconfig.app.json` enables `noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly`, `verbatimModuleSyntax`. There are no tests.

`run.bat` wraps `pnpm install && pnpm dev` for Windows.

## Architecture

Single-page app, 4 screens routed by `screen` state in `src/App.tsx`: `splash` → `livetv` → `player` (or `settings`). `App.tsx` owns the `MonTVRepository` singleton (`useMemo`) and the `theme` attribute on `<html>`.

### Repository pattern (`src/services/`)

Centralizes all remote I/O, caching, and `localStorage`:

- **`repository.ts`** — `MonTVRepository` class. Handles playlist fetch + cache (`cachedChannels`, `cachedUrl`), EPG load + staleness check (4h TTL or latest-stop < today GMT+7), `localStorage` keys (`montv_playlist_url`, `montv_favorites`, `montv_recents`, `montv_working_src_<id>`, `montv_volume`), and stream resolution via `resolveChannelStreamUrl(channel, sourceIndex)`. Proxying: only `freem3u.xyz` URLs are rewritten to `/api-playlist` for local dev; `vnepg.site` is hit directly.
- **`playlistParser.ts`** — `parseM3U` and `parseJSON`. M3U handles `#EXTINF` attrs (`group-title`, `tvg-logo`, `tvg-id`), `#EXTVLCOPT` user-agent/referer, inline `url|header=val&...` syntax. JSON expects `{channels: [{title, urls: [{url, provider}], group, tvgId, thumbnail, isHidden, isAudio}, ...]}`. Both remap groups matching `/sự kiện/i` or `/tv360/i` to `"TV360"`. Channel IDs = `{tvgId|json.id}_${hashCode(streamUrl)}` to disambiguate same-name channels.
- **`epgParser.ts`** — XML EPG fallback parser (DOMParser-based). Not used in the main flow — main flow hits vnepg.site JSON API. Kept around for raw XML EPG sources.

### Stream resolution (`resolveChannelStreamUrl`)

Per-URL `provider` field drives resolution:
- `hls` / `video` / `backup_public` / none → return `{url, headers}` directly. `http://` upgraded to `https://` when page is HTTPS.
- `webview` → load in iframe; `https://freem3u.xyz/shaka.html` served as local `/shaka.html` (public file).
- `flow` → POST/GET against a JSON endpoint, optionally follow nested `jsonPath` extraction to find stream URL.

iOS-specific: `MiniPlayer` skips webview sources (`PlayerScreen.tsx` and `LiveTvScreen.tsx` use the same pattern).

### Components (`src/components/`)

- **`SplashScreen.tsx`** — startup loader; runs `repo.fetchChannels` then `repo.loadEPG`, reports progress.
- **`LiveTvScreen.tsx`** — sidebar (categories) + preview pane + grid of channels. Includes `MiniPlayer` (debounced silent HLS preview) and EPG bar. Categories from `groupTitle`. Heavy composition; this is the largest file.
- **`PlayerScreen.tsx`** — fullscreen playback. Source fallback chain (auto-bump `activeSourceIndex` past `urls.length` on stream error), volume + brightness via touch gestures, channel drawer, progress overlay.
- **`SettingsScreen.tsx`** — playlist URL edit, recent clear, EPG refresh, base64 export/import via `btoa(unescape(encodeURIComponent(JSON.stringify(...))))`.

### Local proxy / Vercel proxy (`api/playlist.js`)

Edge function at `/api/playlist` (rewritten from `/api-playlist/*` in `vercel.json`) proxies upstream `https://freem3u.xyz/*` with `User-Agent: OkHttp/4.9.2` + `Referer: https://freem3u.xyz` to bypass Cloudflare. Dev parity via Vite `server.proxy` in `vite.config.ts` — both paths re-route the same way.

### Theming & styling

`src/index.css` defines Fluent 2 design tokens as CSS variables under `:root` (dark) and `:root[data-theme='light']`. Use these variables — don't hardcode colors. Composed glass surfaces via `--color-glass-*`. Fonts: `'Outfit', 'Segoe UI'` from Google Fonts.

## Conventions

- Vietnamese UI strings throughout (`"Tất cả kênh"`, `"Kênh khác"`, `"Sẵn sàng!"`). Don't translate to English without explicit ask.
- `verbatimModuleSyntax: true` — type-only imports must use `import type` explicitly. Strict unused locals/params mean dead code fails `pnpm build`.
- `erasableSyntaxOnly: true` — no enums or namespaces; use union types and `as const`.
- Channel objects are deeply cloned/spread rather than mutated (see `overrideChannelMetadataFromVnepg`).
- `areHeadersEqual` helper at the top of `LiveTvScreen.tsx` and `PlayerScreen.tsx` — same shallow compare; don't reimplement inline.
