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
});

export type SetProjectUser = z.infer<typeof setProjectUserSchema>;

export const removeProjectUserSchema = z.object({
  projectId: z.string().min(1, "Project ID is required"),
  userId: z.number().int("Invalid user id"),
});

export type RemoveProjectUser = z.infer<typeof removeProjectUserSchema>;
