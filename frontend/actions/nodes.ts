import z from "zod";
import { authActionClient } from "../lib/safe-action";
import { createNode, updateNodeRegistration } from "../lib/api";
import type { BackupStorage, ServerStorage } from "../lib/api";
import { ActionError } from "@/types/safe-action.types";

const storageEntrySchema = z
  .object({
    name: z.string().min(1, "Storage name is required"),
    type: z.enum(["directory", "btrfs"]),
    path: z.string().optional(),
  })
  .refine((entry) => entry.type !== "btrfs" || (entry.path?.length ?? 0) > 0, {
    message: "btrfs path is required",
    path: ["path"],
  });

const backupEntrySchema = z
  .object({
    name: z.string().min(1, "Backup name is required"),
    type: z.enum(["archive", "btrfs"]),
    path: z.string().optional(),
  })
  .refine((entry) => entry.type !== "btrfs" || (entry.path?.length ?? 0) > 0, {
    message: "btrfs path is required",
    path: ["path"],
  });

const nodeConfigSchema = z.object({
  name: z.string().min(1, "Node name is required"),
  region: z.string().min(1, "Region is required"),
  baseUrl: z.string().min(1, "Base URL is required"),
  defaultHost: z.string().min(1, "Default host is required"),
  // Optional SSH/SFTP endpoint. When unset, SSH/SFTP is disabled for the node.
  ssh: z
    .object({
      host: z.string().min(1, "SSH host is required"),
      port: z.number().int().min(1).max(65535),
    })
    .optional(),
  storages: z.array(storageEntrySchema).min(1, "At least one storage is required"),
  backups: z.array(backupEntrySchema),
});

const updateNodeRegistrationSchema = nodeConfigSchema.extend({
  code: z.string().min(1, "Setup code is required"),
});

function toBody(input: z.infer<typeof nodeConfigSchema>) {
  const storages: Record<string, ServerStorage> = Object.fromEntries(
    input.storages.map((entry) => [
      entry.name,
      entry.type === "btrfs" ? { btrfs: entry.path ?? "" } : "directory",
    ]),
  );

  const backups: Record<string, BackupStorage> = Object.fromEntries(
    input.backups.map((entry) => [
      entry.name,
      entry.type === "btrfs" ? { btrfs: entry.path ?? "" } : "archive",
    ]),
  );

  return {
    name: input.name,
    region: input.region,
    config: {
      base_url: input.baseUrl,
      default_host: input.defaultHost,
      ssh: input.ssh,
      storages,
      backups,
    },
  };
}

export const createNodeAction = authActionClient
  .inputSchema(nodeConfigSchema)
  .action(async ({ parsedInput }) => {
    const response = await createNode({ body: toBody(parsedInput) });

    if (response.error) {
      throw new ActionError(
        response.error.error?.msg || "Failed to create node",
      );
    }

    return {
      success: true,
      data: response.data,
    };
  });

export const updateNodeRegistrationAction = authActionClient
  .inputSchema(updateNodeRegistrationSchema)
  .action(async ({ parsedInput }) => {
    const { code, ...config } = parsedInput;

    const response = await updateNodeRegistration({
      path: { code },
      body: toBody(config),
    });

    if (response.error) {
      throw new ActionError(
        response.error.error?.msg || "Failed to update node registration",
      );
    }

    return { success: true };
  });
