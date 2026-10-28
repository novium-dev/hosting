import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  archiveFile,
  chmodFile,
  chownFile,
  copyFile,
  createDirectory,
  deleteFile,
  downloadUser,
  renameFile,
  unarchiveFile,
  uploadUser,
} from "@/lib/api";
import { apiErrorMessage } from "@/lib/api-error";
import { uploadToSignedUrl } from "@/lib/file-upload";
import { normalizePath } from "@/lib/files";
import { useRouter } from "@/lib/navigation";
import { taskLabel } from "@/lib/server-tasks";
import type { useServerTaskLock } from "@/stores/server-tasks";
import type { PermissionsInput } from "./file-dialogs";
import { useFileHistory } from "./use-file-history";
import { useFileUploads } from "./use-file-uploads";
import {
  archiveSelfExclusions,
  getFullPath,
  isDirectory,
  isInside,
  joinPath,
  permissionBits,
  watchedPath,
  type ArchiveCompression,
  type FileRow,
  type WatchedDirectory,
} from "./utils";

export function useFileOperations({
  serverId,
  slug,
  currentPath,
  watched,
  files,
  selectedEntries,
  canWriteFiles,
  modpackInstalling,
  storageLock,
  reload,
  onDone,
}: {
  serverId: string;
  slug: string;
  currentPath: string;
  watched: WatchedDirectory;
  files: FileRow[];
  selectedEntries: FileRow[];
  canWriteFiles: boolean;
  modpackInstalling: boolean;
  storageLock: ReturnType<typeof useServerTaskLock>;
  reload: (path?: string) => Promise<void>;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [isActionLoading, setIsActionLoading] = useState(false);
  const history = useFileHistory(serverId, () => reload());
  const uploads = useFileUploads(serverId, reload);
  const busy = isActionLoading || history.isApplying || uploads.isUploading;

  const ensureStorageUnlocked = () => {
    if (modpackInstalling) {
      toast.error(t("servers-management:mods.filesLockedToast"));
      return false;
    }

    if (!storageLock.locked || !storageLock.blocking) {
      return true;
    }

    toast.error(
      t("servers:tasks.busyStorage", {
        task: taskLabel(storageLock.blocking, t),
      }),
    );

    return false;
  };

  const ensureWritable = (deniedKey: string) => {
    if (canWriteFiles) {
      return true;
    }

    toast.error(t(`servers-management:filesManager.toasts.${deniedKey}`));
    return false;
  };

  const runAction = async (action: () => Promise<boolean | void>) => {
    setIsActionLoading(true);

    try {
      if ((await action()) !== false) {
        onDone();
        await reload();
      }
    } finally {
      setIsActionLoading(false);
    }
  };

  const failed = (error: unknown, fallbackKey: string) => {
    if (!error) {
      return false;
    }

    toast.error(
      apiErrorMessage(
        error,
        t(`servers-management:filesManager.toasts.${fallbackKey}`),
      ),
    );
    return true;
  };

  const server = { server_id: serverId };
  // History keeps absolute paths, the token only lives as long as the watch.
  const inCurrent = (name: string) => watchedPath(watched, currentPath, name);

  const uploadFiles = async (incoming: File[], directory = currentPath) => {
    if (
      incoming.length === 0 ||
      !ensureStorageUnlocked() ||
      !ensureWritable("noPermissionUpload")
    ) {
      return;
    }

    await uploads.upload(incoming, directory);
  };

  const moveEntry = async (entry: FileRow, directory: string) => {
    if (!ensureStorageUnlocked() || !ensureWritable("noPermissionMove")) {
      return;
    }

    const from = getFullPath(currentPath, entry);
    const target = normalizePath(directory);
    const to = joinPath(target, entry.name);

    if (from === to) {
      return;
    }

    if (isDirectory(entry) && isInside(target, from)) {
      toast.error(
        t("servers-management:filesManager.toasts.cannotMoveIntoItself"),
      );
      return;
    }

    await runAction(async () => {
      const { error } = await renameFile({ path: server, query: { from, to } });
      if (failed(error, "moveFailed")) {
        return false;
      }

      history.record({
        type: "rename",
        from,
        to,
        label: t("servers-management:filesManager.undo.actionLabels.move", {
          name: entry.name,
        }),
      });
      toast.success(
        t("servers-management:filesManager.toasts.moved", {
          name: entry.name,
        }),
      );
    });
  };

  const openEditor = (entry: FileRow) => {
    router.push(
      `/${slug}/servers/${serverId}/edit?path=${encodeURIComponent(getFullPath(currentPath, entry))}`,
    );
  };

  const rename = async (entry: FileRow, value: string) => {
    if (!ensureWritable("noPermissionRename")) {
      return;
    }

    const name = value.trim();
    if (!name || name === entry.name) {
      onDone();
      return;
    }

    const from = getFullPath(currentPath, entry);
    const to = joinPath(currentPath, name);

    await runAction(async () => {
      const { error } = await renameFile({
        path: server,
        query: { from: inCurrent(entry.name), to: inCurrent(name) },
      });
      if (failed(error, "renameFailed")) {
        return false;
      }

      history.record({
        type: "rename",
        from,
        to,
        label: t("servers-management:filesManager.undo.actionLabels.rename", {
          name: entry.name,
        }),
      });
      toast.success(t("servers-management:filesManager.toasts.renamed"));
    });
  };

  const copy = async (entry: FileRow, value: string) => {
    const name = value.trim();
    if (!ensureWritable("noPermissionCopy") || !name) {
      return;
    }

    const from = getFullPath(currentPath, entry);
    const to = joinPath(currentPath, name);

    await runAction(async () => {
      const { error } = await copyFile({
        path: server,
        query: { from: inCurrent(entry.name), to: inCurrent(name) },
      });
      if (failed(error, "copyFailed")) {
        return false;
      }

      history.record({
        type: "copy",
        from,
        to,
        label: t("servers-management:filesManager.undo.actionLabels.copy", {
          name: entry.name,
        }),
      });
      toast.success(t("servers-management:filesManager.toasts.copied"));
    });
  };

  const remove = async (entry: FileRow) => {
    if (!ensureWritable("noPermissionDelete")) {
      return;
    }

    await runAction(async () => {
      const { error } = await deleteFile({
        path: server,
        query: {
          file: inCurrent(entry.name),
          recursive: isDirectory(entry),
        },
      });
      if (failed(error, "deleteFailed")) {
        return false;
      }

      toast.success(t("servers-management:filesManager.toasts.deleted"));
    });
  };

  const archive = async (
    sources: string[],
    value: string,
    compression: ArchiveCompression,
  ) => {
    const name = value.trim();
    if (
      sources.length === 0 ||
      !ensureWritable("noPermissionArchive") ||
      !name
    ) {
      return;
    }

    const to = joinPath(currentPath, name);

    await runAction(async () => {
      const { error } = await archiveFile({
        path: server,
        query: { to: inCurrent(name), compression },
        body: { sources, exclude: archiveSelfExclusions(sources, to) },
      });
      if (failed(error, "archiveFailed")) {
        return false;
      }

      toast.success(t("servers-management:filesManager.toasts.archiveCreated"));
    });
  };

  const unarchive = async (entry: FileRow, value: string) => {
    const name = value.trim();
    if (!ensureWritable("noPermissionExtract") || !name) {
      return;
    }

    await runAction(async () => {
      const { error } = await unarchiveFile({
        path: server,
        query: {
          from: inCurrent(entry.name),
          to: inCurrent(name),
        },
      });
      if (failed(error, "unarchiveFailed")) {
        return false;
      }

      toast.success(
        t("servers-management:filesManager.toasts.archiveExtracted"),
      );
    });
  };

  const updatePermissions = async (entry: FileRow, input: PermissionsInput) => {
    if (!ensureWritable("noPermissionPermissions")) {
      return;
    }

    const modeInput = input.mode.trim();
    if (!/^[0-7]{3,4}$/.test(modeInput)) {
      toast.error(t("servers-management:filesManager.toasts.modeInvalid"));
      return;
    }

    const mode = Number.parseInt(modeInput, 8);
    const uid = Number.parseInt(input.uid.trim(), 10);
    const gid = Number.parseInt(input.gid.trim(), 10);
    if (
      !Number.isInteger(uid) ||
      uid < 0 ||
      !Number.isInteger(gid) ||
      gid < 0
    ) {
      toast.error(t("servers-management:filesManager.toasts.ownerInvalid"));
      return;
    }

    const file = inCurrent(entry.name);

    await runAction(async () => {
      if (mode !== permissionBits(entry.mode)) {
        const { error } = await chmodFile({
          path: server,
          query: { file, mode },
        });
        if (failed(error, "chmodFailed")) {
          return false;
        }
      }

      if (uid !== entry.uid || gid !== entry.gid) {
        const { error } = await chownFile({
          path: server,
          query: { file, uid, gid },
        });
        if (failed(error, "chownFailed")) {
          return false;
        }
      }

      toast.success(
        t("servers-management:filesManager.toasts.permissionsUpdated"),
      );
    });
  };

  const massDelete = async () => {
    if (!ensureWritable("noPermissionDelete") || selectedEntries.length === 0) {
      return;
    }

    await runAction(async () => {
      let failures = 0;

      for (const entry of selectedEntries) {
        const { error } = await deleteFile({
          path: server,
          query: {
            file: inCurrent(entry.name),
            recursive: isDirectory(entry),
          },
        });

        if (error) {
          failures += 1;
        }
      }

      if (failures > 0) {
        toast.error(
          t("servers-management:filesManager.toasts.massDeleteFailed", {
            count: failures,
          }),
        );
      } else {
        toast.success(
          t("servers-management:filesManager.toasts.massDeleted", {
            count: selectedEntries.length,
          }),
        );
      }
    });
  };

  const transferTo = async (
    kind: "move" | "copy",
    entries: FileRow[],
    directory: string,
    target: WatchedDirectory,
  ) => {
    const move = kind === "move";
    if (
      !ensureWritable(move ? "noPermissionMove" : "noPermissionCopy") ||
      entries.length === 0
    ) {
      return;
    }

    const destination = normalizePath(directory);

    await runAction(async () => {
      let failures = 0;
      let done = 0;

      for (const entry of entries) {
        const from = getFullPath(currentPath, entry);
        const to = joinPath(destination, entry.name);

        if (from === to) {
          continue;
        }

        if (isDirectory(entry) && isInside(destination, from)) {
          failures += 1;
          continue;
        }

        const query = {
          from: inCurrent(entry.name),
          to: watchedPath(target, destination, entry.name),
        };
        const { error } = move
          ? await renameFile({ path: server, query })
          : await copyFile({ path: server, query });
        if (error) {
          failures += 1;
          continue;
        }

        done += 1;
        history.record({
          type: move ? "rename" : "copy",
          from,
          to,
          label: t(
            `servers-management:filesManager.undo.actionLabels.${kind}`,
            { name: entry.name },
          ),
        });
      }

      if (failures > 0) {
        toast.error(
          t(
            `servers-management:filesManager.toasts.${move ? "massMoveFailed" : "massCopyFailed"}`,
            { count: failures },
          ),
        );
      } else {
        toast.success(
          t(
            `servers-management:filesManager.toasts.${move ? "massMoved" : "massCopied"}`,
            {
              count: done,
              path: destination,
            },
          ),
        );
      }
    });
  };

  const createFolder = async (value: string) => {
    const name = value.trim();
    if (!ensureWritable("noPermissionCreateDirectory") || !name) {
      return;
    }

    const directory = joinPath(currentPath, name);

    await runAction(async () => {
      const { error } = await createDirectory({
        path: server,
        query: { file: inCurrent(name), recursive: false },
      });
      if (failed(error, "createDirectoryFailed")) {
        return false;
      }

      history.record({
        type: "create-directory",
        path: directory,
        label: t("servers-management:filesManager.undo.actionLabels.create", {
          name,
        }),
      });
      toast.success(
        t("servers-management:filesManager.toasts.directoryCreated"),
      );
    });
  };

  const createFile = async (value: string) => {
    const fileName = value.trim();
    if (!ensureWritable("noPermissionCreateFile") || !fileName) {
      return;
    }

    if (files.some((entry) => entry.name === fileName)) {
      toast.error(
        t("servers-management:filesManager.toasts.fileAlreadyExists", {
          fileName,
        }),
      );
      return;
    }

    const file = joinPath(currentPath, fileName);

    setIsActionLoading(true);

    try {
      const urlResponse = await uploadUser({ path: server, query: { file } });

      if (urlResponse.error || !urlResponse.data?.url) {
        toast.error(
          apiErrorMessage(
            urlResponse.error,
            t("servers-management:filesManager.toasts.uploadUrlFailed", {
              fileName,
            }),
          ),
        );
        return;
      }

      const created = await uploadToSignedUrl({
        url: urlResponse.data.url,
        file: new Blob([], { type: "text/plain;charset=utf-8" }),
        fileName,
      });

      if (!created) {
        toast.error(
          t("servers-management:filesManager.toasts.createFileFailed"),
        );
        return;
      }

      toast.success(t("servers-management:filesManager.toasts.fileCreated"));
      onDone();
      router.push(
        `/${slug}/servers/${serverId}/edit?path=${encodeURIComponent(file)}`,
      );
    } catch {
      toast.error(t("servers-management:filesManager.toasts.createFileFailed"));
    } finally {
      setIsActionLoading(false);
    }
  };

  const download = async (entry: FileRow) => {
    setIsActionLoading(true);

    try {
      const response = await downloadUser({
        path: server,
        query: { file: getFullPath(currentPath, entry) },
      });

      if (response.error || !response.data?.url) {
        toast.error(
          apiErrorMessage(
            response.error,
            t("servers-management:filesManager.toasts.downloadUrlFailed"),
          ),
        );
        return;
      }

      window.open(response.data.url, "_blank", "noopener,noreferrer");
    } finally {
      setIsActionLoading(false);
    }
  };

  return {
    busy,
    uploads,
    ensureWritable,
    uploadFiles,
    moveEntry,
    openEditor,
    rename,
    copy,
    remove,
    archive,
    unarchive,
    updatePermissions,
    massDelete,
    transferTo,
    createFolder,
    createFile,
    download,
  };
}
