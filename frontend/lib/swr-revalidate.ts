import { mutate } from "swr";
import { client } from "@/lib/api/client.gen";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const DEBOUNCE_MS = 150;

let timer: ReturnType<typeof setTimeout> | null = null;

// SWR caches by key, so data fetched by one component stays stale after a
// mutation made elsewhere. Revalidating every active key after any successful
// write keeps all views current without each call site naming its keys.
client.interceptors.response.use((response, options) => {
  const method = String(options.method ?? "GET").toUpperCase();
  const isAuth = new URL(
    response.url,
    window.location.origin,
  ).pathname.includes("/auth/");

  if (response.ok && !SAFE_METHODS.has(method) && !isAuth) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void mutate(() => true);
    }, DEBOUNCE_MS);
  }

  return response;
});
