import { auth } from "@/lib/auth";
import { deleteProject } from "@/lib/api";
import { authActionClient } from "@/lib/safe-action";
import { ActionError } from "@/types/safe-action.types";
import {
  createProjectSchema,
  deleteProjectSchema,
  updateProjectNameSchema,
  updateProjectSlugSchema,
} from "@/types/project.schema";
import {
  hasManagementPermission,
  ManagementPermission,
} from "@/lib/permissions";

export const createProjectAction = authActionClient
  .inputSchema(createProjectSchema)
  .action(async ({ parsedInput }) => {
    const { name, slug, owner } = parsedInput;
    const createdProject = await auth.api.createProject({
      body: { name, slug, owner },
    });
    return {
      success: true,
      message: "Project created successfully",
      data: createdProject,
    };
  });

export const updateProjectNameAction = authActionClient
  .inputSchema(updateProjectNameSchema)
  .action(async ({ parsedInput }) => {
    const { name } = parsedInput;
    const updatedProject = await auth.api.updateProject({
      body: { projectId: parsedInput.id, data: { name } },
    });
    return {
      success: true,
      message: "Project name updated successfully",
      data: updatedProject,
    };
  });

export const updateProjectSlugAction = authActionClient
  .inputSchema(updateProjectSlugSchema)
  .action(async ({ parsedInput }) => {
    const { slug } = parsedInput;
    await auth.api.updateProject({
      body: { projectId: parsedInput.id, data: { slug } },
    });
    // The slug (and thus the URL base) changed; hard-navigate to the new path.
    window.location.assign(`/${slug}/settings`);
    return { success: true, message: "Project slug updated successfully" };
  });

export const deleteProjectAction = authActionClient
  .inputSchema(deleteProjectSchema)
  .action(async ({ parsedInput }) => {
    const response = await deleteProject({
      path: { project_id: parsedInput.id },
    });
    if (response.error) {
      throw new ActionError(
        response.error.error?.msg || "Failed to delete the project",
      );
    }
    return { success: true, message: "Project deleted successfully" };
  });

export const getAllProjectsAction = authActionClient.action(async () => {
  const session = await auth.api.getSession();

  if (!session) {
    throw new Error("Unauthorized");
  }

  if (
    !hasManagementPermission(
      session.user.permissions,
      ManagementPermission.SERVER_MANAGE,
    )
  ) {
    throw new Error("Forbidden");
  }

  const allProjects = await auth.api.listAdminProjects();

  return {
    success: true,
    data: allProjects.map((project) => ({
      id: project.id,
      name: project.name,
      slug: project.slug,
    })),
  };
});
