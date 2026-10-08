# Simplification candidates

Places where the code can shrink or get simpler without changing what the
product does. Each entry says what it is, where it lives and what doing it
takes. Remove an entry once it is done.

## Frontend

### Keep one server console

There are two full console implementations, picked per browser in the
appearance settings: the enhanced log view and an xterm terminal. Keeping one
removes the other, the mode setting and its store field.

Where:

- `frontend/app/(app)/[slug]/servers/[server]/components/console/log-console.tsx` and `frontend/lib/console-log.ts` - the enhanced view
- `frontend/app/(app)/[slug]/servers/[server]/components/console/xterm-console.tsx` - the terminal
- `frontend/app/(app)/[slug]/servers/[server]/components/server-console.tsx` - the switch
- `frontend/stores/console-preferences.ts` - the `mode` field and `consoleModes`

### Share the request boilerplate

About 46 handlers repeat the same steps: set a loading flag, call the API,
toast the `apiErrorMessage` or a success message, revalidate, clear the flag.
SWR's `useSWRMutation` or a small `useRequest` hook would cover them.

Where: the `set*Loading(true)` / `set*Pending(true)` / `set*Submitting(true)`
call sites under `frontend/app` and `frontend/components`.

### One confirm dialog component

26 files build their own delete or confirm `AlertDialog` from the same markup.
A shared `ConfirmDialog` taking a title, a description, a confirm label and an
`onConfirm` would replace them. `ConfirmDeleteDialog` in the files manager
(`components/files-manager/file-dialogs.tsx`) is a starting point.

### Drop the server action layer

`frontend/actions/`, `frontend/lib/safe-action.ts` and
`frontend/lib/action-hooks.ts` are left over from the Next.js server actions.
They wrap the generated client in zod validation and `ActionError`. With the
request helper above, components can call the generated client directly.
18 components use `useAction` / `useHookFormAction`; the forms among them keep
react-hook-form and submit through the request helper instead.

### Retire the Next.js shims

`frontend/lib/navigation.ts` (`useRouter`, `usePathname`, `useSearchParams`)
and `frontend/components/link.tsx` (a `Link` taking `href`) only map
`next/navigation` and `next/link` onto React Router. Using React Router's
`useNavigate`, `useLocation`, `useSearchParams` and `Link` directly removes the
layer. 16 files use the navigation shim and 28 use the link.

### One cache for projects

`frontend/stores/projects.ts` caches full projects per slug in Zustand, next to
SWR. Fetching them through a shared SWR key in
`frontend/hooks/use-shared-queries.ts` leaves one cache, and `invalidate(slug)`
becomes `mutate`.

## Backend

### Split the largest services

`backend/src/service/resource.rs`, `backend/src/service/server.rs` and
`backend/src/templates/games/minecraft.rs` are the biggest files. Splitting
them by concern (for example, power, settings and startup in `server.rs`)
makes them easier to read; it does not remove code on its own.
