import { apiErrorMessage } from "@/lib/api-error";
import { z } from "zod";

import {
  installResource,
  listInstalledResources,
  listResourceUpdates,
  updateAllResources,
  updateResource,
  listResourceVersions,
  resourceContext,
  searchResources,
  setResourceState,
  uninstallResource,
  installModpack,
  modpackStatus,
  modpackVersions,
  unlinkModpack,
} from "@/lib/api";
import { authActionClient } from "@/lib/safe-action";
import { ActionError } from "@/types/safe-action.types";

// Every provider call goes through the backend, which normalizes the four
// providers into one shape and caches the upstream responses in Valkey.

const providerSchema = z.enum(["modrinth", "curseforge", "hangar", "spigot"]);
const loaderSchema = z.enum([
  "paper",
  "fabric",
  "forge",
  "neoforge",
  "velocity",
  "bungeecord",
]);
const kindSchema = z.enum(["resource", "modpack"]);
const serverSchema = z.string().min(1);

function unwrap<T>(
  response: { data?: T; error?: { error?: { msg?: string } } },
  fallback: string,
): T {
  if (response.error || response.data === undefined) {
    throw new ActionError(apiErrorMessage(response.error, fallback));
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
      kind: kindSchema.default("resource"),
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
          kind: parsedInput.kind,
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
      kind: kindSchema.default("resource"),
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
          kind: parsedInput.kind,
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
      pageUrl: z.string().optional(),
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
          page_url: parsedInput.pageUrl,
        },
      }),
      "Failed to install resource",
    ),
  );

export const listResourceUpdatesAction = authActionClient
  .inputSchema(
    z.object({
      serverId: serverSchema,
      allowPrerelease: z.boolean().default(false),
    }),
  )
  .action(async ({ parsedInput }) =>
    unwrap(
      await listResourceUpdates({
        path: { server_id: parsedInput.serverId },
        query: { allow_prerelease: parsedInput.allowPrerelease },
      }),
      "Failed to check for updates",
    ),
  );

export const updateResourceAction = authActionClient
  .inputSchema(
    z.object({
      serverId: serverSchema,
      provider: providerSchema,
      project: z.string().min(1),
      allowPrerelease: z.boolean().default(false),
    }),
  )
  .action(async ({ parsedInput }) =>
    unwrap(
      await updateResource({
        path: { server_id: parsedInput.serverId },
        query: {
          provider: parsedInput.provider,
          project: parsedInput.project,
          allow_prerelease: parsedInput.allowPrerelease,
        },
      }),
      "Failed to update resource",
    ),
  );

export const updateAllResourcesAction = authActionClient
  .inputSchema(
    z.object({
      serverId: serverSchema,
      allowPrerelease: z.boolean().default(false),
    }),
  )
  .action(async ({ parsedInput }) =>
    unwrap(
      await updateAllResources({
        path: { server_id: parsedInput.serverId },
        query: { allow_prerelease: parsedInput.allowPrerelease },
      }),
      "Failed to update resources",
    ),
  );

export const installModpackAction = authActionClient
  .inputSchema(
    z.object({
      serverId: serverSchema,
      provider: providerSchema,
      project: z.string().min(1),
      version: z.string().min(1),
      loader: loaderSchema,
      title: z.string().optional(),
      versionNumber: z.string().optional(),
      iconUrl: z.string().optional(),
      pageUrl: z.string().optional(),
      backup: z.boolean(),
      mode: z.enum(["keep", "reset"]),
      syncPlatform: z.boolean(),
    }),
  )
  .action(async ({ parsedInput }) =>
    unwrap(
      await installModpack({
        path: { server_id: parsedInput.serverId },
        body: {
          provider: parsedInput.provider,
          project: parsedInput.project,
          version: parsedInput.version,
          loader: parsedInput.loader,
          title: parsedInput.title,
          version_number: parsedInput.versionNumber,
          icon_url: parsedInput.iconUrl,
          page_url: parsedInput.pageUrl,
          backup: parsedInput.backup,
          mode: parsedInput.mode,
          sync_platform: parsedInput.syncPlatform,
          // The dialog is the confirmation; the backend refuses without this.
          confirm: true,
        },
      }),
      "Failed to start the modpack installation",
    ),
  );

export const modpackStatusAction = authActionClient
  .inputSchema(z.object({ serverId: serverSchema }))
  .action(async ({ parsedInput }) =>
    unwrap(
      await modpackStatus({ path: { server_id: parsedInput.serverId } }),
      "Failed to read the modpack status",
    ),
  );

export const modpackVersionsAction = authActionClient
  .inputSchema(
    z.object({
      serverId: serverSchema,
      allowPrerelease: z.boolean().default(false),
    }),
  )
  .action(async ({ parsedInput }) =>
    unwrap(
      await modpackVersions({
        path: { server_id: parsedInput.serverId },
        query: { allow_prerelease: parsedInput.allowPrerelease },
      }),
      "Failed to load the modpack versions",
    ),
  );

export const unlinkModpackAction = authActionClient
  .inputSchema(z.object({ serverId: serverSchema }))
  .action(async ({ parsedInput }) => {
    const response = await unlinkModpack({
      path: { server_id: parsedInput.serverId },
    });

    if (response.error) {
      throw new ActionError(
        apiErrorMessage(response.error, "Failed to unlink the modpack"),
      );
    }

    return { success: true };
  });

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
        apiErrorMessage(response.error, "Failed to remove resource"),
      );
    }

    return { success: true };
  });
