import useSWR from "swr";
import { instancePolicy } from "@/lib/api";
import type { InstancePolicyResponse } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import {
  hasManagementPermission,
  ManagementPermission,
} from "@/lib/permissions";

// Instance-wide self-service policy, fetched once and shared through SWR's
// cache. Anything the policy withdraws stays available to users who can bypass
// instance limits, which is what the backend checks too.
const optimisticPolicy: InstancePolicyResponse = {
  self_project_creation: true,
  self_project_update: true,
};

export function useInstancePolicy() {
  const { data: session } = authClient.useSession();
  const { data, isLoading } = useSWR(
    "instance/policy",
    async () => {
      const response = await instancePolicy();
      if (response.error || !response.data) return optimisticPolicy;
      return response.data;
    },
    { revalidateOnFocus: false, revalidateIfStale: false },
  );

  const policy = data ?? optimisticPolicy;
  const canBypassLimits = hasManagementPermission(
    session?.user.permissions ?? 0,
    ManagementPermission.LIMITS_BYPASS,
  );

  return {
    canCreateProject: policy.self_project_creation || canBypassLimits,
    canUpdateProject: policy.self_project_update || canBypassLimits,
    isLoading,
  };
}
