import useSWR from "swr";
import { instancePolicy } from "@/lib/api";
import type { InstancePolicyResponse } from "@/lib/api";

// Self-service actions this instance allows the current user, resolved by the
// backend against both the instance policy and the user's permissions. Fetched
// once and shared through SWR's cache.
const optimisticPolicy: InstancePolicyResponse = {
  can_create_project: true,
  can_update_project: true,
};

export function useInstancePolicy() {
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

  return {
    canCreateProject: policy.can_create_project,
    canUpdateProject: policy.can_update_project,
    isLoading,
  };
}
