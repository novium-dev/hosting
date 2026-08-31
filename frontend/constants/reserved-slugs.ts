// Projects resolve to `/<slug>`, so a slug that matches a top-level route
// segment (or a framework/static path) would shadow that route and lock users
// out of it. Keep this in sync with the top-level entries under `app/`.
export const RESERVED_SLUGS = new Set<string>([
  // Framework / static paths
  "api",
  "_next",
  "static",
  "public",
  "favicon.ico",
  "robots.txt",
  "sitemap.xml",
  "manifest.json",
  // Top-level app routes that would be shadowed by `/<slug>`
  "admin",
  "create",
  "onboarding",
  "error",
  "signin",
  "signout",
  "signup",
  "login",
  "logout",
  "auth",
  "accept-invitation",
  "profile",
  "settings",
  // Brand / product reserved
  "novium",
]);

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.trim().toLowerCase());
}
