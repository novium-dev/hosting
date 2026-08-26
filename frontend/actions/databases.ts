import {
  createInstanceDatabase,
  createProjectInstance,
  createInstanceUser,
  deleteInstanceDatabase,
  deleteProjectInstance,
  deleteInstanceUser,
  powerProjectInstance,
  rotateInstanceUserPassword,
  setInstanceUserGrants,
} from "@/lib/api";
import { authActionClient } from "@/lib/safe-action";
import { ActionError } from "@/types/safe-action.types";
import {
  createDatabaseSchema,
  createInstanceSchema,
  createUserSchema,
  deleteDatabaseSchema,
  instanceSchema,
  powerInstanceSchema,
  setUserGrantsSchema,
  userSchema,
} from "@/types/database.schema";

export const createInstanceAction = authActionClient
  .inputSchema(createInstanceSchema)
  .action(async ({ parsedInput }) => {
    const { projectId, display, type } = parsedInput;

    const response = await createProjectInstance({
      path: { project_id: projectId },
      body: { display, type },
    });

    if (response.error || !response.data) {
      throw new ActionError(
        response.error?.error?.msg || "Failed to create the instance",
      );
    }

    return response.data;
  });

export const deleteInstanceAction = authActionClient
  .inputSchema(instanceSchema)
  .action(async ({ parsedInput }) => {
    const response = await deleteProjectInstance({
      path: {
        project_id: parsedInput.projectId,
        instance_id: parsedInput.instanceId,
      },
    });

    if (response.error) {
      throw new ActionError(
        response.error.error?.msg || "Failed to delete the instance",
      );
    }

    return { success: true };
  });

export const powerInstanceAction = authActionClient
  .inputSchema(powerInstanceSchema)
  .action(async ({ parsedInput }) => {
    const response = await powerProjectInstance({
      path: {
        project_id: parsedInput.projectId,
        instance_id: parsedInput.instanceId,
      },
      body: parsedInput.action,
    });

    if (response.error) {
      throw new ActionError(
        response.error.error?.msg || "Failed to change the power state",
      );
    }

    return { success: true };
  });

export const createDatabaseAction = authActionClient
  .inputSchema(createDatabaseSchema)
  .action(async ({ parsedInput }) => {
    const response = await createInstanceDatabase({
      path: {
        project_id: parsedInput.projectId,
        instance_id: parsedInput.instanceId,
      },
      body: { name: parsedInput.name },
    });

    if (response.error || !response.data) {
      throw new ActionError(
        response.error?.error?.msg || "Failed to create the database",
      );
    }

    return response.data;
  });

export const deleteDatabaseAction = authActionClient
  .inputSchema(deleteDatabaseSchema)
  .action(async ({ parsedInput }) => {
    const response = await deleteInstanceDatabase({
      path: {
        project_id: parsedInput.projectId,
        instance_id: parsedInput.instanceId,
        database_id: parsedInput.databaseId,
      },
    });

    if (response.error) {
      throw new ActionError(
        response.error.error?.msg || "Failed to delete the database",
      );
    }

    return { success: true };
  });

export const createUserAction = authActionClient
  .inputSchema(createUserSchema)
  .action(async ({ parsedInput }) => {
    const response = await createInstanceUser({
      path: {
        project_id: parsedInput.projectId,
        instance_id: parsedInput.instanceId,
      },
      body: {
        username: parsedInput.username,
        grants: parsedInput.grants,
      },
    });

    if (response.error || !response.data) {
      throw new ActionError(
        response.error?.error?.msg || "Failed to create the user",
      );
    }

    return response.data;
  });

export const setUserGrantsAction = authActionClient
  .inputSchema(setUserGrantsSchema)
  .action(async ({ parsedInput }) => {
    const response = await setInstanceUserGrants({
      path: {
        project_id: parsedInput.projectId,
        instance_id: parsedInput.instanceId,
        user_id: parsedInput.userId,
      },
      body: { grants: parsedInput.grants },
    });

    if (response.error || !response.data) {
      throw new ActionError(
        response.error?.error?.msg || "Failed to update the database access",
      );
    }

    return response.data;
  });

export const deleteUserAction = authActionClient
  .inputSchema(userSchema)
  .action(async ({ parsedInput }) => {
    const response = await deleteInstanceUser({
      path: {
        project_id: parsedInput.projectId,
        instance_id: parsedInput.instanceId,
        user_id: parsedInput.userId,
      },
    });

    if (response.error) {
      throw new ActionError(
        response.error.error?.msg || "Failed to delete the user",
      );
    }

    return { success: true };
  });

export const rotateUserPasswordAction = authActionClient
  .inputSchema(userSchema)
  .action(async ({ parsedInput }) => {
    const response = await rotateInstanceUserPassword({
      path: {
        project_id: parsedInput.projectId,
        instance_id: parsedInput.instanceId,
        user_id: parsedInput.userId,
      },
    });

    if (response.error || !response.data) {
      throw new ActionError(
        response.error?.error?.msg || "Failed to rotate the password",
      );
    }

    return response.data;
  });
