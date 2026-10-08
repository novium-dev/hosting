import { apiErrorMessage } from "@/lib/api-error";
import { createServer, templateInfo } from "@/lib/api";
import { authActionClient } from "@/lib/safe-action";
import { ActionError } from "@/types/safe-action.types";
import { z } from "zod";

const templateInfoSchema = z.object({
  template: z.string().min(1, "Template is required"),
});

const createServerSchema = z.object({
  name: z.string().min(1, "Server name is required"),
  owner: z.string().min(1, "Project is required"),
  template: z.string().min(1, "Template is required"),
  node: z.string().min(1, "Node is required"),
  storage: z.string().min(1, "Storage is required"),
  internetAccess: z.boolean(),
  cpu: z.number().nullable(),
  ram: z.number().nullable(),
  disk: z.number().nullable(),
  swap: z.number().nullable(),
  backupLimit: z.number().nullable(),
  group: z.number().int().nullable(),
  ports: z.record(z.string(), z.number()),
  variables: z.record(z.string(), z.string()),
});

export const getTemplateInfoAction = authActionClient
  .inputSchema(templateInfoSchema)
  .action(async ({ parsedInput }) => {
    const response = await templateInfo({
      path: { template: parsedInput.template },
    });

    if (response.error) {
      throw new ActionError("Failed to load template details");
    }

    return {
      success: true,
      data: response.data,
    };
  });

export const createServerAction = authActionClient
  .inputSchema(createServerSchema)
  .action(async ({ parsedInput }) => {
    const response = await createServer({
      body: {
        name: parsedInput.name,
        project: parsedInput.owner,
        template: parsedInput.template,
        node: parsedInput.node,
        storage: parsedInput.storage,
        internet_access: parsedInput.internetAccess,
        backup_limit: parsedInput.backupLimit,
        group: parsedInput.group,
        ports: parsedInput.ports,
        variables: parsedInput.variables,
        resource: {
          cpu: parsedInput.cpu,
          ram: parsedInput.ram,
          disk: parsedInput.disk,
          swap: parsedInput.swap,
        },
      },
    });

    if (response.error) {
      throw new ActionError(
        apiErrorMessage(response.error, "Failed to create server"),
      );
    }

    console.log("Server created successfully:", response.data);

    return {
      success: true,
      data: response.data,
    };
  });
