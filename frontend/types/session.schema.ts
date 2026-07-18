import { z } from "zod";

export const revokeSessionSchema = z.object({
  token: z.string().min(1, { message: "Token is required" }),
});

export type RevokeSessionSchema = z.infer<typeof revokeSessionSchema>;
