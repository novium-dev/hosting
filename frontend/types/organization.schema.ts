import { isReservedSlug } from "@/constants/reserved-slugs";
import { z } from "zod";

const slugSchema = z
  .string()
  .min(1, { message: "Slug is required" })
  .regex(/^[a-z0-9-]+$/, {
    message: "Slug must contain only lowercase letters, numbers, and hyphens",
  })
  .refine((slug) => !isReservedSlug(slug), {
    message: "This slug is reserved and cannot be used",
  });

export const createOrganizationSchema = z.object({
  name: z.string(),
  slug: slugSchema,
});

export type CreateOrganization = z.infer<typeof createOrganizationSchema>;

export const updateOrganizationNameSchema = z.object({
  id: z.string().min(1, "Organization ID is required"),
  name: z.string(),
});

export type UpdateOrganizationName = z.infer<
  typeof updateOrganizationNameSchema
>;

export const updateOrganizationSlugSchema = z.object({
  id: z.string().min(1, "Organization ID is required"),
  slug: slugSchema,
});
