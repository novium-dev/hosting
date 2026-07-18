import { z } from "zod";

import { getResource, ResourceType } from "@/lib/api";
import { authActionClient } from "@/lib/safe-action";
import { ActionError } from "@/types/safe-action.types";
import { getResourceProvider } from "@/lib/mod-browser/providers";
import "@/lib/mod-browser/modrinth";

const providerSchema = z.literal("modrinth");
const loaderSchema = z.enum(["paper", "fabric", "forge", "neoforge"]);

export const searchResourceProjectsAction = authActionClient
  .inputSchema(
    z.object({
      provider: providerSchema,
      query: z.string().max(120).default(""),
      loader: loaderSchema,
    }),
  )
  .action(async ({ parsedInput }) => {
    const provider = getResourceProvider(parsedInput.provider);

    return provider.searchProjects({
      query: parsedInput.query.trim(),
      loader: parsedInput.loader,
    });
  });

export const listResourceVersionsAction = authActionClient
  .inputSchema(
    z.object({
      provider: providerSchema,
      projectId: z.string().min(1),
      loader: loaderSchema,
    }),
  )
  .action(async ({ parsedInput }) => {
    const provider = getResourceProvider(parsedInput.provider);

    return provider.listVersions({
      projectId: parsedInput.projectId,
      loader: parsedInput.loader,
    });
  });

export const installResourceVersionAction = authActionClient
  .inputSchema(
    z.object({
      serverId: z.string().min(1),
      slug: z.string().min(1),
      provider: providerSchema,
      resourceType: z.enum([ResourceType.PLUGIN, ResourceType.MODIFICATION]),
      versionId: z.string().min(1),
    }),
  )
  .action(async ({ parsedInput }) => {

    const response = await getResource({
      path: { server_id: parsedInput.serverId },
      body: {
        provider: parsedInput.provider,
        type: parsedInput.resourceType,
        version: parsedInput.versionId,
      },
    });

    if (response.error) {
      throw new ActionError(
        response.error.error?.msg ?? "Failed to install resource",
      );
    }

    return { success: true };
  });
