import { apiErrorMessage } from "@/lib/api-error";
import { refreshTemplateCache, resyncTemplate } from "@/lib/api";
import { authActionClient } from "@/lib/safe-action";
import { ActionError } from "@/types/safe-action.types";
import {
  refreshTemplateCacheSchema,
  resyncTemplateSchema,
} from "@/types/template.schema";

export const resyncTemplateAction = authActionClient
  .inputSchema(resyncTemplateSchema)
  .action(async ({ parsedInput }) => {
    const { template, restart } = parsedInput;

    const response = await resyncTemplate({
      body: { template, restart },
    });

    if (response.error || !response.data) {
      throw new ActionError(
        apiErrorMessage(response.error, "Failed to resync servers"),
      );
    }

    return response.data;
  });

export const refreshTemplateCacheAction = authActionClient
  .inputSchema(refreshTemplateCacheSchema)
  .action(async ({ parsedInput }) => {
    const response = await refreshTemplateCache({
      body: { template: parsedInput.template },
    });

    if (response.error || !response.data) {
      throw new ActionError(
        apiErrorMessage(response.error, "Failed to refresh template cache"),
      );
    }

    return response.data;
  });
