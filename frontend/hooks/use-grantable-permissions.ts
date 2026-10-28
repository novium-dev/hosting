import { authClient } from "@/lib/auth-client";
import { mergePermissions } from "@/lib/permissions";

// The permissions the current user may grant to project members and API keys:
// their instance-wide permissions, plus their permissions in `projectPermissions`
// when granting within a project. The backend enforces the same ceiling.
export function useGrantablePermissions(projectPermissions?: number) {
  const { data: session } = authClient.useSession();
  const global = session?.user.permissions ?? 0;

  return projectPermissions === undefined
    ? global
    : mergePermissions(global, projectPermissions);
}
