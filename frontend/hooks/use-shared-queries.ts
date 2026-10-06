import useSWR, { type SWRConfiguration } from "swr";
import {
  listDatabaseHosts,
  listGroups,
  listInstanceDatabases,
  listNodeGroups,
  listProjectInstances,
  listRouteDomainsAdmin,
  serverInfo,
} from "@/lib/api";

export function useServerInfo(serverId: string | null | undefined) {
  return useSWR(serverId ? ["server-info", serverId] : null, ([, id]) =>
    serverInfo({ path: { server_id: id } }),
  );
}

export function useProjectInstances(
  projectId: string | null | undefined,
  config?: SWRConfiguration,
) {
  return useSWR(
    projectId ? ["project-instances", projectId] : null,
    async ([, id]) => {
      const response = await listProjectInstances({
        path: { project_id: id },
      });
      if (response.error) {
        throw new Error(response.error.error?.msg ?? "Failed to load instances");
      }
      return response.data ?? [];
    },
    config,
  );
}

export function useInstanceDatabases(projectId: string, instanceId: string) {
  return useSWR(
    ["instance-databases", projectId, instanceId],
    async ([, project, instance]) => {
      const response = await listInstanceDatabases({
        path: { project_id: project, instance_id: instance },
      });
      if (response.error) {
        throw new Error(response.error.error?.msg ?? "Failed to load databases");
      }
      return response.data ?? [];
    },
  );
}

export function useDatabaseHosts(enabled: boolean) {
  return useSWR(enabled ? "admin/database-hosts" : null, async () => {
    const response = await listDatabaseHosts();
    return response.error ? [] : (response.data ?? []);
  });
}

export function useRouteDomains(enabled: boolean) {
  return useSWR(enabled ? "admin/route-domains" : null, async () => {
    const response = await listRouteDomainsAdmin();
    if (response.error) {
      throw new Error(response.error.error?.msg ?? "Failed to load domains");
    }
    return response.data ?? [];
  });
}

export function useNodeGroups(nodeId: string, enabled = true) {
  return useSWR(enabled ? ["admin/node-groups", nodeId] : null, async ([, id]) => {
    const response = await listNodeGroups({ path: { node_id: id } });
    if (response.error || !response.data) {
      throw new Error("Failed to load node groups");
    }
    return response.data;
  });
}

export function useGroupNames(enabled: boolean) {
  return useSWR(enabled ? "admin/group-names" : null, async () => {
    const response = await listGroups();
    return response.error || !response.data
      ? []
      : response.data.map((group) => group.name);
  });
}
