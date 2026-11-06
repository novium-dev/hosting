import { displayNameSchema } from "@/lib/display-name";
import { z } from "zod";

export const createApiKeySchema = z.object({
  name: displayNameSchema("Name is required"),
  /** The project the key is scoped to; omitted for an instance-wide key. */
  projectId: z.string().optional(),
  permissions: z
    .number()
    .int()
    .min(0)
    .refine((permissions) => permissions > 0, {
      message: "Select at least one permission",
    }),
});

export type CreateApiKey = z.infer<typeof createApiKeySchema>;

export const updateApiKeySchema = z.object({
  id: z.number().int(),
  /** Update through the admin route, which can reach other users' keys. */
  admin: z.boolean().optional(),
  name: displayNameSchema("Name is required"),
  permissions: z
    .number()
    .int()
    .min(0)
    .refine((permissions) => permissions > 0, {
      message: "Select at least one permission",
    }),
});

export type UpdateApiKey = z.infer<typeof updateApiKeySchema>;

export const deleteApiKeySchema = z.object({
  id: z.number().int(),
  /** Delete through the admin route, which can reach other users' keys. */
  admin: z.boolean().optional(),
});

export type DeleteApiKey = z.infer<typeof deleteApiKeySchema>;
