import z from "zod";
import { authActionClient } from "../lib/safe-action";
import { createNode } from "../lib/api";
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

const createNodeSchema = z.object({
  name: z.string().min(1, "Node name is required"),
  baseUrl: z.string().min(1, "Base URL is required"),
  ssh: z.number().int().min(1).max(65535),
  storages: z.array(storageEntrySchema).min(1, "At least one storage is required"),
  backups: z.array(backupEntrySchema),
});

export const createNodeAction = authActionClient
  .inputSchema(createNodeSchema)
  .action(async ({ parsedInput }) => {

    const storages: Record<string, ServerStorage> = Object.fromEntries(
      parsedInput.storages.map((entry) => [
        entry.name,
        entry.type === "btrfs"
          ? { btrfs: entry.path ?? "" }
          : "directory",
      ]),
    );

    const backups: Record<string, BackupStorage> = Object.fromEntries(
      parsedInput.backups.map((entry) => [
        entry.name,
        entry.type === "btrfs" ? { btrfs: entry.path ?? "" } : "archive",
      ]),
    );

    const response = await createNode({
      body: {
        name: parsedInput.name,
        config: {
          base_url: parsedInput.baseUrl,
          ssh: parsedInput.ssh,
          storages,
          backups,
        },
      },
    });

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
