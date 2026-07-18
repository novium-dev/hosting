"use server";

import { removeProjectUser, setProjectUser } from "@/lib/api";
import { projectRolePermissions } from "@/lib/permissions";
import { authActionClient } from "@/lib/safe-action";
import { ActionError } from "@/types/safe-action.types";
import {
  removeProjectUserSchema,
  setProjectUserSchema,
} from "@/types/project-user.schema";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

export const setProjectUserAction = authActionClient
  .inputSchema(setProjectUserSchema)
  .action(async ({ parsedInput }) => {
    const { projectId, email, role } = parsedInput;
    const requestHeaders = await headers();

    const response = await setProjectUser({
      headers: requestHeaders,
      path: { project_id: projectId },
      body: {
        email,
        permissions: projectRolePermissions[role],
      },
    });

    if (response.error) {
      throw new ActionError(
        response.error.error?.msg || "Failed to update project member",
      );
    }

    revalidatePath("/[slug]/members", "page");

    return { success: true };
  });

export const removeProjectUserAction = authActionClient
  .inputSchema(removeProjectUserSchema)
  .action(async ({ parsedInput }) => {
    const { projectId, userId } = parsedInput;
    const requestHeaders = await headers();

    const response = await removeProjectUser({
      headers: requestHeaders,
      path: { project_id: projectId, user_id: userId },
    });

    if (response.error) {
      throw new ActionError(
        response.error.error?.msg || "Failed to remove project member",
      );
    }

    revalidatePath("/[slug]/members", "page");

    return { success: true };
  });
