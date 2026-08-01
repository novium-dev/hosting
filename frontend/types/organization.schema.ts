import { isReservedSlug } from "@/constants/reserved-slugs";
import { z } from "zod";

export const SLUG_PATTERN = /^[a-z0-9-]+$/;
export const SLUG_MAX_LENGTH = 64;

const slugSchema = z
  .string()
  .min(1, { message: "Slug is required" })
  .max(SLUG_MAX_LENGTH, {
    message: `Slug must be at most ${SLUG_MAX_LENGTH} characters`,
  })
  .regex(SLUG_PATTERN, {
    message:
      "Slug must contain only lowercase letters, numbers, and hyphens — no spaces or special characters",
  })
  .refine((slug) => !isReservedSlug(slug), {
    message: "This slug is reserved and cannot be used",
  });

export const createOrganizationSchema = z.object({
  name: z.string().min(1, { message: "Name is required" }),
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
