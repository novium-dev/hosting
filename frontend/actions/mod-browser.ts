import { z } from "zod";

import {
  installResource,
  listInstalledResources,
  listResourceVersions,
  resourceContext,
  searchResources,
  setResourceState,
  uninstallResource,
} from "@/lib/api";
import { authActionClient } from "@/lib/safe-action";
import { ActionError } from "@/types/safe-action.types";

// Every provider call goes through the backend, which normalizes the four
// providers into one shape and caches the upstream responses in Valkey.

const providerSchema = z.enum(["modrinth", "curseforge", "hangar", "spigot"]);
const loaderSchema = z.enum(["paper", "fabric", "forge", "neoforge"]);
const serverSchema = z.string().min(1);

function unwrap<T>(
  response: { data?: T; error?: { error?: { msg?: string } } },
  fallback: string,
): T {
  if (response.error || response.data === undefined) {
    throw new ActionError(response.error?.error?.msg ?? fallback);
  }

  return response.data;
}

export const getResourceContextAction = authActionClient
  .inputSchema(z.object({ serverId: serverSchema }))
  .action(async ({ parsedInput }) =>
    unwrap(
      await resourceContext({ path: { server_id: parsedInput.serverId } }),
      "Failed to load the resource browser",
    ),
  );

export const searchResourceProjectsAction = authActionClient
  .inputSchema(
    z.object({
      serverId: serverSchema,
      provider: providerSchema,
      query: z.string().max(120).default(""),
      loader: loaderSchema,
      gameVersion: z.string().optional(),
    }),
  )
  .action(async ({ parsedInput }) =>
    unwrap(
      await searchResources({
        path: { server_id: parsedInput.serverId },
        query: {
          provider: parsedInput.provider,
          query: parsedInput.query,
          loader: parsedInput.loader,
          game_version: parsedInput.gameVersion,
        },
      }),
      "Failed to search resources",
    ),
  );

export const listResourceVersionsAction = authActionClient
  .inputSchema(
    z.object({
      serverId: serverSchema,
      provider: providerSchema,
      project: z.string().min(1),
      loader: loaderSchema,
      gameVersion: z.string().optional(),
    }),
  )
  .action(async ({ parsedInput }) =>
    unwrap(
      await listResourceVersions({
        path: { server_id: parsedInput.serverId },
        query: {
          provider: parsedInput.provider,
          project: parsedInput.project,
          loader: parsedInput.loader,
          game_version: parsedInput.gameVersion,
        },
      }),
      "Failed to load versions",
    ),
  );

export const listInstalledResourcesAction = authActionClient
  .inputSchema(z.object({ serverId: serverSchema }))
  .action(async ({ parsedInput }) =>
    unwrap(
      await listInstalledResources({
        path: { server_id: parsedInput.serverId },
      }),
      "Failed to load installed resources",
    ),
  );

export const installResourceVersionAction = authActionClient
  .inputSchema(
    z.object({
      serverId: serverSchema,
      provider: providerSchema,
      project: z.string().min(1),
      version: z.string().min(1),
      loader: loaderSchema,
      title: z.string().optional(),
    }),
  )
  .action(async ({ parsedInput }) =>
    unwrap(
      await installResource({
        path: { server_id: parsedInput.serverId },
        body: {
          provider: parsedInput.provider,
          project: parsedInput.project,
          version: parsedInput.version,
          loader: parsedInput.loader,
          title: parsedInput.title,
        },
      }),
      "Failed to install resource",
    ),
  );

export const setResourceStateAction = authActionClient
  .inputSchema(
    z.object({
      serverId: serverSchema,
      resourceType: z.enum(["plugin", "modification", "data_pack"]),
      file: z.string().min(1),
      enabled: z.boolean(),
    }),
  )
  .action(async ({ parsedInput }) =>
    unwrap(
      await setResourceState({
        path: { server_id: parsedInput.serverId },
        query: {
          resource_type: parsedInput.resourceType,
          file: parsedInput.file,
          enabled: parsedInput.enabled,
        },
      }),
      "Failed to change the resource state",
    ),
  );

export const uninstallResourceAction = authActionClient
  .inputSchema(
    z.object({
      serverId: serverSchema,
      provider: providerSchema,
      project: z.string().min(1),
    }),
  )
  .action(async ({ parsedInput }) => {
    const response = await uninstallResource({
      path: { server_id: parsedInput.serverId },
      query: {
        provider: parsedInput.provider,
        project: parsedInput.project,
      },
    });

    if (response.error) {
      throw new ActionError(
        response.error.error?.msg ?? "Failed to remove resource",
      );
    }

    return { success: true };
  });
