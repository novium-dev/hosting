import { z } from "zod";

export const databaseTypes = [
  "postgres",
  "mariadb",
  "mongodb",
  "redis",
] as const;

export const powerActions = ["start", "stop", "restart", "kill"] as const;

export type PowerAction = (typeof powerActions)[number];

export const createInstanceSchema = z.object({
  projectId: z.string(),
  display: z
    .string()
    .min(1, "Name is required")
    .max(64, "Name is too long"),
  type: z.enum(databaseTypes),
});

export type CreateInstance = z.infer<typeof createInstanceSchema>;

export const instanceSchema = z.object({
  projectId: z.string(),
  instanceId: z.string(),
});

export type InstanceReference = z.infer<typeof instanceSchema>;

export const powerInstanceSchema = instanceSchema.extend({
  action: z.enum(powerActions),
});

export type PowerInstance = z.infer<typeof powerInstanceSchema>;

/** Matches the agent's rule: 1-63 ascii alphanumeric characters. */
const objectName = z
  .string()
  .min(1, "Name is required")
  .max(63, "Name is too long")
  .regex(/^[A-Za-z0-9]+$/, "Only letters and digits are allowed");

export const createDatabaseSchema = instanceSchema.extend({
  name: objectName,
});

export type CreateDatabase = z.infer<typeof createDatabaseSchema>;

export const deleteDatabaseSchema = instanceSchema.extend({
  databaseId: z.string(),
});

export const accessLevels = ["read", "write"] as const;

export type AccessLevel = (typeof accessLevels)[number];

export const userGrantSchema = z.object({
  database_uuid: z.string(),
  access: z.enum(accessLevels),
});

export const createUserSchema = instanceSchema.extend({
  /** The agent's identifier label: 2-23 ascii alphanumeric characters. */
  username: z
    .string()
    .min(2, "Username must be at least 2 characters")
    .max(23, "Username is too long")
    .regex(/^[A-Za-z0-9]+$/, "Only letters and digits are allowed"),
  grants: z.array(userGrantSchema).default([]),
});

export type CreateUser = z.infer<typeof createUserSchema>;

export const userSchema = instanceSchema.extend({
  userId: z.string(),
});

export const setUserGrantsSchema = userSchema.extend({
  grants: z.array(userGrantSchema).default([]),
});

export type SetUserGrants = z.infer<typeof setUserGrantsSchema>;
