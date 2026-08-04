import {
  createProjectDatabase,
  deleteProjectDatabase,
  rotateProjectDatabasePassword,
} from "@/lib/api";
import { authActionClient } from "@/lib/safe-action";
import { ActionError } from "@/types/safe-action.types";
import {
  createDatabaseSchema,
  databaseSchema,
} from "@/types/database.schema";

export const createDatabaseAction = authActionClient
  .inputSchema(createDatabaseSchema)
  .action(async ({ parsedInput }) => {
    const { projectId, name, type } = parsedInput;

    const response = await createProjectDatabase({
      path: { project_id: projectId },
      body: { name, type },
    });

    if (response.error || !response.data) {
      throw new ActionError(
        response.error?.error?.msg || "Failed to create the database",
      );
    }

    return response.data;
  });

export const deleteDatabaseAction = authActionClient
  .inputSchema(databaseSchema)
  .action(async ({ parsedInput }) => {
    const { projectId, databaseId } = parsedInput;

    const response = await deleteProjectDatabase({
      path: { project_id: projectId, database_id: databaseId },
    });

    if (response.error) {
      throw new ActionError(
        response.error.error?.msg || "Failed to delete the database",
      );
    }

    return { success: true };
  });

export const rotateDatabasePasswordAction = authActionClient
  .inputSchema(databaseSchema)
  .action(async ({ parsedInput }) => {
    const { projectId, databaseId } = parsedInput;

    const response = await rotateProjectDatabasePassword({
      path: { project_id: projectId, database_id: databaseId },
    });

    if (response.error || !response.data) {
      throw new ActionError(
        response.error?.error?.msg || "Failed to rotate the password",
      );
    }

    return response.data;
  });
