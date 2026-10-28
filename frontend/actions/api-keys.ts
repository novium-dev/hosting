import { apiErrorMessage } from "@/lib/api-error";
import {
  createApiKey,
  deleteAnyApiKey,
  deleteApiKey,
  updateAnyApiKey,
  updateApiKey,
} from "@/lib/api";
import {
  allManagementPermissions,
  allServerPermissions,
  maskPermissions,
  mergePermissions,
  resolveManagementPermissions,
  resolveServerPermissions,
} from "@/lib/permissions";
import { authActionClient } from "@/lib/safe-action";
import { ActionError } from "@/types/safe-action.types";
import {
  createApiKeySchema,
  deleteApiKeySchema,
  updateApiKeySchema,
} from "@/types/api-key.schema";

/**
 * Expands implied dependencies in both permission scopes, keeping each scope to
 * its own bits — the backend normalises the same way, so what is stored matches
 * what was picked.
 */
function resolvePermissions(permissions: number) {
  const server = maskPermissions(permissions, allServerPermissions);
  const management = maskPermissions(permissions, allManagementPermissions);

  return mergePermissions(
    server === 0 ? 0 : resolveServerPermissions(server),
    resolveManagementPermissions(management),
  );
}

export const createApiKeyAction = authActionClient
  .inputSchema(createApiKeySchema)
  .action(async ({ parsedInput }) => {
    const { name, projectId, permissions } = parsedInput;

    const response = await createApiKey({
      body: {
        name,
        project: projectId,
        permissions: resolvePermissions(permissions),
      },
    });

    if (response.error || !response.data) {
      throw new ActionError(
        apiErrorMessage(response.error, "Failed to create API key"),
      );
    }

    return response.data;
  });

export const updateApiKeyAction = authActionClient
  .inputSchema(updateApiKeySchema)
  .action(async ({ parsedInput }) => {
    const { id, name, permissions, admin } = parsedInput;
    const body = { name, permissions: resolvePermissions(permissions) };

    const response = admin
      ? await updateAnyApiKey({ path: { api_key_id: id }, body })
      : await updateApiKey({ path: { api_key_id: id }, body });

    if (response.error) {
      throw new ActionError(
        apiErrorMessage(response.error, "Failed to update API key"),
      );
    }

    return { success: true };
  });

export const deleteApiKeyAction = authActionClient
  .inputSchema(deleteApiKeySchema)
  .action(async ({ parsedInput }) => {
    const { id, admin } = parsedInput;

    const response = admin
      ? await deleteAnyApiKey({ path: { api_key_id: id } })
      : await deleteApiKey({ path: { api_key_id: id } });

    if (response.error) {
      throw new ActionError(
        apiErrorMessage(response.error, "Failed to delete API key"),
      );
    }

    return { success: true };
  });
