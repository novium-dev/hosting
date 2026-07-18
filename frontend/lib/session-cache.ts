import type { MeResponse } from "@/lib/api";

const SESSION_CACHE_TTL_MS = 30_000;

type CacheEntry = {
  expiresAt: number;
  user: MeResponse;
};

const sessionCache = new Map<string, CacheEntry>();

export function getSessionCacheKey(headers: {
  authorization?: string | null;
  cookie?: string | null;
}) {
  return headers.authorization || headers.cookie || null;
}

export function getCachedSessionUser(key: string | null) {
  if (!key) return null;

  const entry = sessionCache.get(key);
  if (!entry) return null;

  if (entry.expiresAt <= Date.now()) {
    sessionCache.delete(key);
    return null;
  }

  return entry.user;
}

export function setCachedSessionUser(key: string | null, user: MeResponse) {
  if (!key) return;

  sessionCache.set(key, {
    expiresAt: Date.now() + SESSION_CACHE_TTL_MS,
    user,
  });
}

export function clearCachedSessionUser(key: string | null) {
  if (!key) return;
  sessionCache.delete(key);
}
