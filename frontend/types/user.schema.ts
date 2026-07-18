import { z } from "zod";

export const deleteUserSchema = z.object({});

export type DeleteUserForm = z.infer<typeof deleteUserSchema>;
