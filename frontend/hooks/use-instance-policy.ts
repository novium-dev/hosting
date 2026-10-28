import useSWR from "swr";
import { instancePolicy, PolicyAccess } from "@/lib/api";
import type { InstancePolicyResponse } from "@/lib/api";

// Self-service actions this instance allows the current user, resolved by the
// backend against both the instance policy and the user's permissions. Fetched
// once and shared through SWR's cache.
const optimisticPolicy: InstancePolicyResponse = {
  create_project: PolicyAccess.ALLOWED,
  update_project: PolicyAccess.ALLOWED,
  upload_project_logo: PolicyAccess.DENIED,
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
    canCreateProject: policy.create_project !== PolicyAccess.DENIED,
    projectCreationBypassed: policy.create_project === PolicyAccess.BYPASSED,
    canUpdateProject: policy.update_project !== PolicyAccess.DENIED,
    projectUpdateBypassed: policy.update_project === PolicyAccess.BYPASSED,
    canUploadProjectLogo: policy.upload_project_logo !== PolicyAccess.DENIED,
    isLoading,
  };
}
