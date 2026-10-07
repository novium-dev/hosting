import useSWR, { type SWRConfiguration } from "swr";
import {
  availablePorts,
  listDatabaseHosts,
  listGroups,
  listInstanceDatabases,
  listNodeGroups,
  listProjectInstances,
  listRouteDomainsAdmin,
  serverInfo,
  templateInfo,
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

export function useGroups(enabled: boolean) {
  return useSWR(enabled ? "admin/groups" : null, async () => {
    const response = await listGroups();
    if (response.error || !response.data) {
      throw new Error("Failed to load groups");
    }
    return response.data;
  });
}

export function useTemplateInfo(template: string | null | undefined) {
  return useSWR(template ? ["template-info", template] : null, async ([, name]) => {
    const response = await templateInfo({ path: { template: name } });
    if (response.error || !response.data) {
      throw new Error("Failed to load template details");
    }
    return response.data;
  });
}

export function useAvailablePorts(nodeId: string | null | undefined) {
  return useSWR(nodeId ? ["admin/available-ports", nodeId] : null, async ([, id]) => {
    const response = await availablePorts({ path: { node_id: id } });
    if (response.error || !response.data) {
      throw new Error("Failed to load available ports");
    }
    return response.data;
  });
}
