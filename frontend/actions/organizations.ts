import { auth } from "@/lib/auth";
import { authActionClient } from "@/lib/safe-action";
import {
  createOrganizationSchema,
  updateOrganizationNameSchema,
  updateOrganizationSlugSchema,
} from "@/types/organization.schema";
import {
  hasManagementPermission,
  ManagementPermission,
} from "@/lib/permissions";

export const createOrganizationAction = authActionClient
  .inputSchema(createOrganizationSchema)
  .action(async ({ parsedInput }) => {
    const { name, slug } = parsedInput;
    const createdOrganization = await auth.api.createOrganization({
      body: { name, slug },
    });
    return {
      success: true,
      message: "Organization created successfully",
      data: createdOrganization,
    };
  });

export const updateOrganizationNameAction = authActionClient
  .inputSchema(updateOrganizationNameSchema)
  .action(async ({ parsedInput }) => {
    const { name } = parsedInput;
    const updatedOrganization = await auth.api.updateOrganization({
      body: { organizationId: parsedInput.id, data: { name } },
    });
    return {
      success: true,
      message: "Organization name updated successfully",
      data: updatedOrganization,
    };
  });

export const updateOrganizationSlugAction = authActionClient
  .inputSchema(updateOrganizationSlugSchema)
  .action(async ({ parsedInput }) => {
    const { slug } = parsedInput;
    await auth.api.updateOrganization({
      body: { organizationId: parsedInput.id, data: { slug } },
    });
    // The slug (and thus the URL base) changed; hard-navigate to the new path.
    window.location.assign(`/${slug}/settings`);
    return { success: true, message: "Organization slug updated successfully" };
  });

export const getAllOrganizationsAction = authActionClient.action(async () => {
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

  const allOrganizations = await auth.api.listAdminOrganizations();

  return {
    success: true,
    data: allOrganizations.map((org) => ({
      id: org.id,
      name: org.name,
      slug: org.slug,
    })),
  };
});
