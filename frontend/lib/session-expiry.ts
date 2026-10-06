import { client } from "@/lib/api/client.gen";
import { useProjectStore } from "@/stores/projects";
import { useSessionStore } from "@/stores/session";

// A 401 means the session cookie expired or was revoked (e.g. a tab left open
// for days). Dropping the cached session lets the app layout's auth guard
// redirect to the sign-in page instead of every page showing a load error.
client.interceptors.response.use((response) => {
  if (
    response.status === 401 &&
    useSessionStore.getState().status === "authenticated"
  ) {
    useSessionStore.getState().clear();
    useProjectStore.getState().clear();
  }
  return response;
});
