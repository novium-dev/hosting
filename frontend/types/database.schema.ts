import { z } from "zod";

export const databaseTypes = [
  "postgres",
  "mariadb",
  "mongodb",
  "redis",
] as const;

export const createDatabaseSchema = z.object({
  projectId: z.string(),
  /** Mirrors the backend's validation: 2-20 lowercase letters or digits. */
  name: z
    .string()
    .min(2, "Name must be at least 2 characters")
    .max(20, "Name is too long")
    .regex(/^[a-z0-9]+$/, "Only lowercase letters and digits are allowed"),
  type: z.enum(databaseTypes),
});

export type CreateDatabase = z.infer<typeof createDatabaseSchema>;

export const databaseSchema = z.object({
  projectId: z.string(),
  databaseId: z.string(),
});

export type DatabaseReference = z.infer<typeof databaseSchema>;
