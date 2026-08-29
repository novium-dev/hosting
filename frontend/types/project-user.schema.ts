import { z } from "zod";

export const setProjectUserSchema = z.object({
  projectId: z.string().min(1, "Project ID is required"),
  email: z.string().email("Invalid email address"),
  permissions: z
    .number()
    .int()
    .min(0)
    .refine((permissions) => permissions > 0, {
      message: "Select at least one permission",
    }),
  expiresAt: z
    .string()
    .datetime()
    .nullable()
    .refine((expiresAt) => expiresAt === null || Date.parse(expiresAt) > Date.now(), {
      message: "The access expiry must be in the future",
    }),
});

export type SetProjectUser = z.infer<typeof setProjectUserSchema>;

export const removeProjectUserSchema = z.object({
  projectId: z.string().min(1, "Project ID is required"),
  userId: z.number().int("Invalid user id"),
});

export type RemoveProjectUser = z.infer<typeof removeProjectUserSchema>;
