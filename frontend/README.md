# Hephaestus

Hephaestus is a game panel frontend for the backend API generated into `lib/api`.

Authentication, users, projects, and sessions are handled by the backend.

## Setup

Install dependencies:

```bash
bun install
```

Configure the backend API URL:

```bash
NEXT_PUBLIC_API_URL="http://localhost:8080"
```

Run the app:

```bash
bun dev
```

Regenerate the API client after backend schema changes:

```bash
bun run gen
```

## Structure

- `lib/api` contains the generated API client.
- `app/api/[...path]/route.ts` proxies browser requests to the backend API.
- `lib/auth.ts` and `lib/auth-client.ts` wrap backend auth endpoints for server and client code.
- `app/(app)` contains the authenticated Hephaestus UI.
