# Contributing

This frontend is backed by the external API schema generated into `lib/api`.

## Local Workflow

Install dependencies:

```bash
bun install
```

Start the frontend:

```bash
bun dev
```

Regenerate the API client when the backend OpenAPI schema changes:

```bash
bun run gen
```

Run the type check before opening a change:

```bash
bunx tsc --noEmit
```
