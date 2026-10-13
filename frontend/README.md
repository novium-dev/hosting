# Frontend

Vite + React single-page app for the novium panel. It talks to the backend API; authentication, users, projects and sessions are handled by the backend.

```bash
pnpm install
pnpm run dev        # :3000, proxies /api to VITE_DEV_API_URL
pnpm run typecheck
pnpm run lint
pnpm run format
pnpm run build
pnpm run gen        # regenerate lib/api from a running backend's OpenAPI spec
```

Configuration is described in `.env.example`.

## Structure

- `app/` - route components
- `components/` - shared UI, `components/ui` is shadcn on Base UI
- `lib/api/` - generated API client
- `locales/` - i18next translations (`en` and `de` must have identical keys)

Licensed under the PolyForm Noncommercial License 1.0.0, see [`../LICENSE`](../LICENSE).
