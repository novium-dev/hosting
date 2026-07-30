import { resyncTemplate } from "@/lib/api";
import { authActionClient } from "@/lib/safe-action";
import { ActionError } from "@/types/safe-action.types";
import { resyncTemplateSchema } from "@/types/template.schema";

export const resyncTemplateAction = authActionClient
  .inputSchema(resyncTemplateSchema)
  .action(async ({ parsedInput }) => {
    const { template, restart } = parsedInput;

    const response = await resyncTemplate({
      body: { template, restart },
    });

    if (response.error || !response.data) {
      throw new ActionError(
        response.error?.error?.msg || "Failed to resync servers",
      );
    }

    return response.data;
  });
