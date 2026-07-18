import { z } from "zod";

import { roleSchema } from "./organization.schema";

export const setProjectUserSchema = z.object({
  projectId: z.string().min(1, "Project ID is required"),
  email: z.string().email("Invalid email address"),
  role: roleSchema,
});

export type SetProjectUser = z.infer<typeof setProjectUserSchema>;

export const removeProjectUserSchema = z.object({
  projectId: z.string().min(1, "Project ID is required"),
  userId: z.number().int("Invalid user id"),
});

export type RemoveProjectUser = z.infer<typeof removeProjectUserSchema>;
