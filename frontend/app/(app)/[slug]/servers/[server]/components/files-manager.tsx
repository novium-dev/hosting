"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ComponentType,
  type DragEvent,
  type ReactNode,
} from "react";
import { useRouter } from "@/lib/navigation";
import {
  AlertTriangle,
  Archive,
  Boxes,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  File,
  FilePlus,
  Folder,
  FolderInput,
  FolderPlus,
  Home,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Shield,
  RefreshCcw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  archiveFile,
  chmodFile,
  chownFile,
  copyFile,
  createDirectory,
  deleteFile,
  downloadUser,
  listFiles,
  renameFile,
  unarchiveFile,
  uploadUser,
  type ListFilesResponses,
} from "@/lib/api";
import { FileMode, modeToType } from "@/lib/files";
import { useServerTaskLock } from "@/stores/server-tasks";
import { taskLabel } from "@/lib/server-tasks";
import { TaskLockNotice } from "@/components/server/task-lock-notice";
import { isUploadAborted, uploadToSignedUrl } from "@/lib/file-upload";
import { appConfig } from "@/constants/config";
import {
  DISK_USAGE_EVENT,
  type DiskUsageEventDetail,
} from "./server-management-bar";
import UploadProgressPanel, {
  isUploadTaskActive,
  type UploadTask,
} from "./upload-progress";
import type { LucideIcon } from "lucide-react";
import { normalizePath } from "@/lib/files";

type FilesManagerProps = {
  serverId: string;
  slug: string;
  canWriteFiles: boolean;
  modpackInstalling?: boolean;
};

type FileRow = ListFilesResponses[200][number];

type ActionMenuItem = ComponentType<{
  children?: ReactNode;
  className?: string;
  disabled?: boolean;
  onSelect?: (event: Event) => void;
}>;

/*
Delete/archive/unarchive/upload are not in undo history yet, since true reversal is backend-dependent and can be destructive if guessed.
*/
type UndoableAction =
  | {
      type: "rename";
      from: string;
      to: string;
      label: string;
    }
  | {
      type: "copy";
      from: string;
      to: string;
      label: string;
    }
  | {
      type: "create-directory";
      path: string;
      label: string;
    };

type ArchiveCompression = "zstd" | "xz" | "zlib" | "lz4" | "gzip" | "bzip2";

const ARCHIVE_COMPRESSION_VALUES: ArchiveCompression[] = [
  "zstd",
  "xz",
  "zlib",
  "lz4",
  "gzip",
  "bzip2",
];

function joinPath(basePath: string, childName: string) {
  if (basePath === "/") {
    return `/${childName}`;
  }

  return `${basePath}/${childName}`;
}

function formatBytes(bytes: number, unknownLabel: string) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return unknownLabel;
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0];

  for (let i = 1; i < units.length && value >= 1024; i += 1) {
    value /= 1024;
    unit = units[i];
  }

  return `${value.toFixed(2)} ${unit}`;
}

function isDirectory(row: FileRow) {
  return modeToType(row.mode) === FileMode.DIR;
}

const PERMISSION_BITS = 0o7777;

const UPLOAD_DISMISS_DELAY = 2500;

function permissionBits(mode: number) {
  return mode & PERMISSION_BITS;
}

function formatMode(mode: number) {
  return permissionBits(mode).toString(8).padStart(4, "0");
}

function formatSymbolicMode(mode: number) {
  const flags = ["r", "w", "x"];

  return [6, 3, 0]
    .map((shift) =>
      flags
        .map((flag, index) =>
          (mode >> (shift + 2 - index)) & 1 ? flag : "-",
        )
        .join(""),
    )
    .join("");
}

type FileEntryKind = "directory" | "file" | "archive";

function getEntryKind(entry: FileRow): FileEntryKind {
  if (isDirectory(entry)) {
    return "directory";
  }

  if (entry.archive) {
    return "archive";
  }

  return "file";
}

function getFullPath(currentPath: string, entry: FileRow) {
  return normalizePath(joinPath(currentPath, entry.name));
}

/*
Sources keep their own name as the archive root, so an archive written inside one
of them has to be excluded under that name or it would pack itself.
*/
function archiveSelfExclusions(sources: string[], target: string) {
  return sources
    .filter((source) => target.startsWith(`${source}/`))
    .map(
      (source) =>
        `${source.split("/").pop() ?? ""}${target.slice(source.length)}`,
    );
}

function buildPathSegments(path: string) {
  if (path === "/") {
    return [] as Array<{ label: string; path: string }>;
  }

  const parts = path.split("/").filter(Boolean);
  const segments: Array<{ label: string; path: string }> = [];

  parts.forEach((part, index) => {
    segments.push({
      label: part,
      path: `/${parts.slice(0, index + 1).join("/")}`,
    });
  });

  return segments;
}

function getActionIcon(action: string): LucideIcon {
  switch (action) {
    case "Edit":
    case "View":
      return Pencil;
    case "Rename":
      return Pencil;
    case "Permissions":
      return Shield;
    case "Archive":
      return Archive;
    case "Unarchive":
      return FolderInput;
    case "Delete":
      return Trash2;
    case "Download":
      return Download;
    case "Copy":
      return Copy;
    default:
      return File;
  }
}

export function FilesManager({
  serverId,
  slug,
  canWriteFiles,
  modpackInstalling = false,
}: FilesManagerProps) {
  const { t } = useTranslation();
  const storageLock = useServerTaskLock(serverId, "storage", "read");
  const filesBlocked = storageLock.locked || modpackInstalling;

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
  const router = useRouter();
  const [currentPath, setCurrentPath] = useState("/");
  const [pathInput, setPathInput] = useState("/");
  const [isEditingPath, setIsEditingPath] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [files, setFiles] = useState<FileRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedEntry, setSelectedEntry] = useState<FileRow | null>(null);
  const [selectedNames, setSelectedNames] = useState<string[]>([]);
  const [renameOpen, setRenameOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [unarchiveOpen, setUnarchiveOpen] = useState(false);
  const [createDirectoryOpen, setCreateDirectoryOpen] = useState(false);
  const [createFileOpen, setCreateFileOpen] = useState(false);
  const [renameInput, setRenameInput] = useState("");
  const [copyInput, setCopyInput] = useState("");
  const [archiveNameInput, setArchiveNameInput] = useState("");
  const [archiveSources, setArchiveSources] = useState<string[]>([]);
  const [archiveCompression, setArchiveCompression] =
    useState<ArchiveCompression>("zstd");
  const [unarchiveNameInput, setUnarchiveNameInput] = useState("");
  const [newDirectoryNameInput, setNewDirectoryNameInput] = useState("");
  const [newFileNameInput, setNewFileNameInput] = useState("");
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [permissionsModeInput, setPermissionsModeInput] = useState("");
  const [permissionsUidInput, setPermissionsUidInput] = useState("");
  const [permissionsGidInput, setPermissionsGidInput] = useState("");
  const [massDeleteOpen, setMassDeleteOpen] = useState(false);
  const [massMoveOpen, setMassMoveOpen] = useState(false);
  const [massMoveInput, setMassMoveInput] = useState("");
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [diskUsagePercent, setDiskUsagePercent] = useState<number | null>(null);
  const [draggedEntry, setDraggedEntry] = useState<FileRow | null>(null);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const [isFileDropActive, setIsFileDropActive] = useState(false);
  const [uploadTasks, setUploadTasks] = useState<UploadTask[]>([]);
  const uploadDismissTimeoutRef = useRef<number | null>(null);
  const uploadControllersRef = useRef(new Map<string, AbortController>());
  const uploadRunRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const undoStackRef = useRef<UndoableAction[]>([]);
  const redoStackRef = useRef<UndoableAction[]>([]);
  const isHistoryPlaybackRef = useRef(false);
  const suppressEntryClickRef = useRef(false);

  const archiveCompressionOptions = useMemo<
    Array<{ value: ArchiveCompression; label: string }>
  >(
    () =>
      ARCHIVE_COMPRESSION_VALUES.map((value) => ({
        value,
        label: t(`servers-management:filesManager.archiveDialog.compressionOptions.${value}`),
      })),
    [t],
  );

  const actionLabelKeys: Record<string, string> = {
    Edit: "common:actions.edit",
    View: "servers-management:filesManager.contextMenu.view",
    Rename: "common:actions.rename",
    Permissions: "servers-management:filesManager.contextMenu.permissions",
    Archive: "common:resources.archive",
    Unarchive: "servers-management:filesManager.contextMenu.unarchive",
    Delete: "common:actions.delete",
    Download: "common:actions.download",
    Copy: "common:actions.copy",
  };

  const selectedEntries = useMemo(
    () => files.filter((entry) => selectedNames.includes(entry.name)),
    [files, selectedNames],
  );

  const visibleFiles = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    if (!query) {
      return files;
    }

    return files.filter((entry) => entry.name.toLowerCase().includes(query));
  }, [files, searchQuery]);

  const allSelected =
    visibleFiles.length > 0 && selectedNames.length === visibleFiles.length;

  const clearSelection = () => setSelectedNames([]);

  const toggleEntrySelection = (entry: FileRow) => {
    setSelectedNames((previous) =>
      previous.includes(entry.name)
        ? previous.filter((name) => name !== entry.name)
        : [...previous, entry.name],
    );
  };

  const toggleSelectAll = () => {
    setSelectedNames((previous) =>
      previous.length === visibleFiles.length
        ? []
        : visibleFiles.map((entry) => entry.name),
    );
  };

  const segments = useMemo(() => buildPathSegments(currentPath), [currentPath]);
  const refresh = async (
    targetPath = currentPath,
    options?: { preserveScroll?: boolean },
  ) => {
    const normalized = normalizePath(targetPath);
    const previousScrollY =
      options?.preserveScroll && typeof window !== "undefined"
        ? window.scrollY
        : null;

    setIsLoading(true);

    try {
      const response = await listFiles({
        path: { server_id: serverId },
        query: { file: normalized },
      });

      if (response.error || !response.data) {
        throw new Error("Failed to load files");
      }

      const sorted = [...response.data].sort((a, b) => {
        const aDir = isDirectory(a);
        const bDir = isDirectory(b);

        if (aDir !== bDir) {
          return aDir ? -1 : 1;
        }

        return a.name.localeCompare(b.name);
      });

      setFiles(sorted);
      setSelectedNames([]);
      if (normalized !== currentPath) {
        setSearchQuery("");
      }

      setCurrentPath(normalized);
      setPathInput(normalized);
      setIsEditingPath(false);
    } catch {
      toast.error(t("servers-management:filesManager.toasts.loadFailed"));
    } finally {
      setIsLoading(false);

      if (previousScrollY !== null && typeof window !== "undefined") {
        requestAnimationFrame(() => {
          window.scrollTo({ top: previousScrollY, behavior: "auto" });
        });
      }
    }
  };

  useEffect(() => {
    void refresh("/");
  }, [serverId]);

  useEffect(() => {
    const onDiskUsage = (event: Event) => {
      const customEvent = event as CustomEvent<DiskUsageEventDetail>;
      if (customEvent.detail.serverId !== serverId) {
        return;
      }

      setDiskUsagePercent(customEvent.detail.percent);
    };

    window.addEventListener(DISK_USAGE_EVENT, onDiskUsage as EventListener);

    return () => {
      window.removeEventListener(
        DISK_USAGE_EVENT,
        onDiskUsage as EventListener,
      );
    };
  }, [serverId]);

  const openEditor = (entry: FileRow) => {
    const path = getFullPath(currentPath, entry);

    router.push(
      `/${slug}/servers/${serverId}/edit?path=${encodeURIComponent(path)}`,
    );
  };

  const pushUndoAction = (action: UndoableAction) => {
    if (isHistoryPlaybackRef.current) {
      return;
    }

    undoStackRef.current.push(action);
    redoStackRef.current = [];
  };

  const performUndoableAction = async (
    action: UndoableAction,
    direction: "undo" | "redo",
  ) => {
    if (action.type === "rename") {
      const from = direction === "undo" ? action.to : action.from;
      const to = direction === "undo" ? action.from : action.to;

      const response = await renameFile({
        path: { server_id: serverId },
        query: { from, to },
      });

      if (response.error) {
        toast.error(
          response.error.error?.msg ??
            (direction === "undo"
              ? t("servers-management:filesManager.toasts.undoFailedRename")
              : t("servers-management:filesManager.toasts.redoFailedRename")),
        );
        return false;
      }

      return true;
    }

    if (action.type === "copy") {
      if (direction === "undo") {
        const response = await deleteFile({
          path: { server_id: serverId },
          query: {
            file: action.to,
            recursive: true,
          },
        });

        if (response.error) {
          toast.error(
            response.error.error?.msg ??
              t("servers-management:filesManager.toasts.undoFailedCopy"),
          );
          return false;
        }

        return true;
      }

      const response = await copyFile({
        path: { server_id: serverId },
        query: {
          from: action.from,
          to: action.to,
        },
      });

      if (response.error) {
        toast.error(
          response.error.error?.msg ??
            t("servers-management:filesManager.toasts.redoFailedCopy"),
        );
        return false;
      }

      return true;
    }

    if (direction === "undo") {
      const response = await deleteFile({
        path: { server_id: serverId },
        query: {
          file: action.path,
          recursive: true,
        },
      });

      if (response.error) {
        toast.error(
          response.error.error?.msg ??
            t("servers-management:filesManager.toasts.undoFailedCreate"),
        );
        return false;
      }

      return true;
    }

    const response = await createDirectory({
      path: { server_id: serverId },
      query: {
        file: action.path,
        recursive: false,
      },
    });

    if (response.error) {
      toast.error(
        response.error.error?.msg ??
          t("servers-management:filesManager.toasts.redoFailedCreate"),
      );
      return false;
    }

    return true;
  };

  const handleUndo = async () => {
    const action = undoStackRef.current.pop();
    if (!action) {
      toast.info(t("servers-management:filesManager.toasts.nothingToUndo"));
      return;
    }

    setIsActionLoading(true);
    isHistoryPlaybackRef.current = true;

    try {
      const success = await performUndoableAction(action, "undo");
      if (!success) {
        undoStackRef.current.push(action);
        return;
      }

      redoStackRef.current.push(action);
      toast.success(
        t("servers-management:filesManager.toasts.undid", {
          label: action.label,
        }),
      );
      await refresh(currentPath, { preserveScroll: true });
    } finally {
      isHistoryPlaybackRef.current = false;
      setIsActionLoading(false);
    }
  };

  const handleRedo = async () => {
    const action = redoStackRef.current.pop();
    if (!action) {
      toast.info(t("servers-management:filesManager.toasts.nothingToRedo"));
      return;
    }

    setIsActionLoading(true);
    isHistoryPlaybackRef.current = true;

    try {
      const success = await performUndoableAction(action, "redo");
      if (!success) {
        redoStackRef.current.push(action);
        return;
      }

      undoStackRef.current.push(action);
      toast.success(
        t("servers-management:filesManager.toasts.redid", {
          label: action.label,
        }),
      );
      await refresh(currentPath, { preserveScroll: true });
    } finally {
      isHistoryPlaybackRef.current = false;
      setIsActionLoading(false);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      const undoPressed = key === "z" && !event.shiftKey;
      const redoPressed = key === "y" || (key === "z" && event.shiftKey);

      if (undoPressed) {
        event.preventDefault();
        void handleUndo();
        return;
      }

      if (redoPressed) {
        event.preventDefault();
        void handleRedo();
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [currentPath]);

  useEffect(() => {
    return () => {
      if (uploadDismissTimeoutRef.current !== null) {
        window.clearTimeout(uploadDismissTimeoutRef.current);
      }
    };
  }, []);

  const hasDraggedFiles = (event: DragEvent<HTMLElement>) =>
    Array.from(event.dataTransfer.types).includes("Files");

  const updateUploadTask = (id: string, patch: Partial<UploadTask>) => {
    setUploadTasks((previous) =>
      previous.map((task) => (task.id === id ? { ...task, ...patch } : task)),
    );
  };

  const clearUploadDismissTimeout = () => {
    if (uploadDismissTimeoutRef.current !== null) {
      window.clearTimeout(uploadDismissTimeoutRef.current);
      uploadDismissTimeoutRef.current = null;
    }
  };

  const scheduleUploadDismiss = () => {
    clearUploadDismissTimeout();

    uploadDismissTimeoutRef.current = window.setTimeout(() => {
      uploadDismissTimeoutRef.current = null;
      setUploadTasks([]);
    }, UPLOAD_DISMISS_DELAY);
  };

  const cancelUploadTask = (id: string) => {
    uploadControllersRef.current.get(id)?.abort();

    setUploadTasks((previous) =>
      previous.map((task) =>
        task.id === id && isUploadTaskActive(task)
          ? { ...task, status: "cancelled" }
          : task,
      ),
    );

    const remainsActive = uploadTasks.some(
      (task) => task.id !== id && isUploadTaskActive(task),
    );

    if (!remainsActive) {
      scheduleUploadDismiss();
    }
  };

  const cancelAllUploads = () => {
    for (const controller of uploadControllersRef.current.values()) {
      controller.abort();
    }

    setUploadTasks((previous) =>
      previous.map((task) =>
        isUploadTaskActive(task) ? { ...task, status: "cancelled" } : task,
      ),
    );

    scheduleUploadDismiss();
  };

  const uploadFiles = async (
    incomingFiles: File[],
    targetDirectoryPath = currentPath,
  ) => {
    if (!ensureStorageUnlocked()) {
      return;
    }

    if (!canWriteFiles) {
      toast.error(
        t("servers-management:filesManager.toasts.noPermissionUpload"),
      );
      return;
    }

    if (incomingFiles.length === 0) {
      return;
    }

    const { maxFileSize } = appConfig.uploads;
    const files =
      maxFileSize === null
        ? incomingFiles
        : incomingFiles.filter((file) => file.size <= maxFileSize);

    if (maxFileSize !== null && files.length < incomingFiles.length) {
      const rejected = incomingFiles.filter((file) => file.size > maxFileSize);

      toast.error(
        t("servers-management:filesManager.toasts.uploadTooLarge", {
          count: rejected.length,
          fileName: rejected[0]?.name,
          limit: formatBytes(maxFileSize, t("common:status.unknown")),
        }),
      );
    }

    if (files.length === 0) {
      return;
    }

    clearUploadDismissTimeout();

    const runId = uploadRunRef.current + 1;
    uploadRunRef.current = runId;

    const queue = files.map((file) => ({
      file,
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      controller: new AbortController(),
    }));

    uploadControllersRef.current = new Map(
      queue.map(({ id, controller }) => [id, controller]),
    );

    setUploadTasks(
      queue.map(({ file, id }) => ({
        id,
        name: file.name,
        loaded: 0,
        total: file.size,
        status: "pending" as const,
      })),
    );

    setIsActionLoading(true);

    let successCount = 0;
    let cancelledCount = 0;
    let errorCount = 0;

    try {
      for (const { file, id, controller } of queue) {
        if (controller.signal.aborted) {
          updateUploadTask(id, { status: "cancelled" });
          cancelledCount += 1;
          continue;
        }

        const destinationPath = normalizePath(
          joinPath(targetDirectoryPath, file.name),
        );

        updateUploadTask(id, { status: "uploading" });

        const uploadUrlResponse = await uploadUser({
          path: { server_id: serverId },
          query: {
            file: destinationPath,
          },
        });

        if (controller.signal.aborted) {
          updateUploadTask(id, { status: "cancelled" });
          cancelledCount += 1;
          continue;
        }

        if (uploadUrlResponse.error || !uploadUrlResponse.data?.url) {
          updateUploadTask(id, { status: "error" });
          errorCount += 1;
          toast.error(
            uploadUrlResponse.error?.error?.msg ??
              t("servers-management:filesManager.toasts.uploadUrlFailed", {
                fileName: file.name,
              }),
          );
          continue;
        }

        let uploaded = false;
        let cancelled = false;

        try {
          uploaded = await uploadToSignedUrl({
            url: uploadUrlResponse.data.url,
            file,
            fileName: file.name,
            signal: controller.signal,
            onProgress: (loaded, total) => {
              updateUploadTask(id, { loaded, total });
            },
          });
        } catch (error) {
          cancelled = isUploadAborted(error) || controller.signal.aborted;
          uploaded = false;
        }

        if (cancelled) {
          updateUploadTask(id, { status: "cancelled" });
          cancelledCount += 1;
          continue;
        }

        if (!uploaded) {
          updateUploadTask(id, { status: "error" });
          errorCount += 1;
          toast.error(
            t("servers-management:filesManager.toasts.uploadFailedFile", {
              fileName: file.name,
            }),
          );
          continue;
        }

        updateUploadTask(id, { status: "done", loaded: file.size });
        successCount += 1;
      }

      if (successCount > 0) {
        toast.success(
          t("servers-management:filesManager.toasts.uploaded", {
            count: successCount,
          }),
        );
      }

      if (cancelledCount > 0) {
        toast.info(
          t("servers-management:filesManager.toasts.uploadCancelled", {
            count: cancelledCount,
          }),
        );
      }

      if (successCount > 0 || cancelledCount > 0) {
        await refresh(currentPath, { preserveScroll: true });
      }
    } catch {
      toast.error(t("servers-management:filesManager.toasts.uploadFailed"));
    } finally {
      if (uploadRunRef.current === runId) {
        for (const controller of uploadControllersRef.current.values()) {
          controller.abort();
        }

        uploadControllersRef.current.clear();

        setUploadTasks((previous) =>
          previous.map((task) =>
            isUploadTaskActive(task) ? { ...task, status: "cancelled" } : task,
          ),
        );

        if (errorCount === 0) {
          scheduleUploadDismiss();
        }

        setIsActionLoading(false);
        setIsFileDropActive(false);
      }
    }
  };

  const handlePickerUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files;
    if (!selected || selected.length === 0) {
      return;
    }

    await uploadFiles(Array.from(selected));
    event.target.value = "";
  };

  const moveEntryToPath = async (
    entry: FileRow,
    targetDirectoryPath: string,
  ) => {
    if (!ensureStorageUnlocked()) {
      return;
    }

    if (!canWriteFiles) {
      toast.error(t("servers-management:filesManager.toasts.noPermissionMove"));
      return;
    }

    const from = getFullPath(currentPath, entry);
    const normalizedTarget = normalizePath(targetDirectoryPath);
    const to = normalizePath(joinPath(normalizedTarget, entry.name));

    if (from === to) {
      return;
    }

    if (
      isDirectory(entry) &&
      (normalizedTarget === from || normalizedTarget.startsWith(`${from}/`))
    ) {
      toast.error(
        t("servers-management:filesManager.toasts.cannotMoveIntoItself"),
      );
      return;
    }

    setIsActionLoading(true);

    try {
      const response = await renameFile({
        path: { server_id: serverId },
        query: {
          from,
          to,
        },
      });

      if (response.error) {
        toast.error(
          response.error.error?.msg ??
            t("servers-management:filesManager.toasts.moveFailed"),
        );
        return;
      }

      pushUndoAction({
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
      await refresh(currentPath, { preserveScroll: true });
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleEntryDragStart = (
    event: DragEvent<HTMLElement>,
    entry: FileRow,
  ) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", entry.name);
    setDraggedEntry(entry);
  };

  const handleEntryDragEnd = () => {
    suppressEntryClickRef.current = true;
    setDraggedEntry(null);
    setDropTargetPath(null);

    window.setTimeout(() => {
      suppressEntryClickRef.current = false;
    }, 0);
  };

  const handleFileClick = (entry: FileRow) => {
    if (suppressEntryClickRef.current) {
      return;
    }

    openEditor(entry);
  };

  const handleDragOverTarget = (
    event: DragEvent<HTMLElement>,
    targetPath: string,
  ) => {
    const fileDrag = hasDraggedFiles(event);
    if ((!draggedEntry && !fileDrag) || isActionLoading) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = fileDrag ? "copy" : "move";
    setDropTargetPath(normalizePath(targetPath));
  };

  const handleDragLeaveTarget = (targetPath: string) => {
    const normalized = normalizePath(targetPath);
    setDropTargetPath((current) => (current === normalized ? null : current));
  };

  const handleDropToPath = async (
    event: DragEvent<HTMLElement>,
    targetPath: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();

    if (hasDraggedFiles(event) && !draggedEntry) {
      setDropTargetPath(null);
      const droppedFiles = Array.from(event.dataTransfer.files ?? []);
      await uploadFiles(droppedFiles, normalizePath(targetPath));
      return;
    }

    const entry = draggedEntry;
    setDropTargetPath(null);
    setDraggedEntry(null);

    if (!entry || isActionLoading) {
      return;
    }

    await moveEntryToPath(entry, targetPath);
  };

  const handleManagerDragOver = (event: DragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event) || draggedEntry) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsFileDropActive(true);
  };

  const handleManagerDragLeave = () => {
    setIsFileDropActive(false);
  };

  const handleManagerDrop = async (event: DragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event) || draggedEntry) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const droppedFiles = Array.from(event.dataTransfer.files ?? []);
    await uploadFiles(droppedFiles);
  };

  const handleRename = async () => {
    if (!selectedEntry) {
      return;
    }

    if (!canWriteFiles) {
      toast.error(
        t("servers-management:filesManager.toasts.noPermissionRename"),
      );
      return;
    }

    const nextName = renameInput.trim();
    if (!nextName || nextName === selectedEntry.name) {
      setRenameOpen(false);
      return;
    }

    const from = getFullPath(currentPath, selectedEntry);
    const to = normalizePath(joinPath(currentPath, nextName));

    setIsActionLoading(true);

    try {
      const response = await renameFile({
        path: { server_id: serverId },
        query: {
          from,
          to,
        },
      });

      if (response.error) {
        toast.error(
          response.error.error?.msg ??
            t("servers-management:filesManager.toasts.renameFailed"),
        );
        return;
      }

      pushUndoAction({
        type: "rename",
        from,
        to,
        label: t("servers-management:filesManager.undo.actionLabels.rename", {
          name: selectedEntry.name,
        }),
      });
      toast.success(t("servers-management:filesManager.toasts.renamed"));
      setRenameOpen(false);
      await refresh(currentPath, { preserveScroll: true });
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!selectedEntry) {
      return;
    }

    if (!canWriteFiles) {
      toast.error(t("servers-management:filesManager.toasts.noPermissionCopy"));
      return;
    }

    const targetName = copyInput.trim();
    if (!targetName) {
      return;
    }

    const from = getFullPath(currentPath, selectedEntry);
    const to = normalizePath(joinPath(currentPath, targetName));

    setIsActionLoading(true);

    try {
      const response = await copyFile({
        path: { server_id: serverId },
        query: {
          from,
          to,
        },
      });

      if (response.error) {
        toast.error(
          response.error.error?.msg ??
            t("servers-management:filesManager.toasts.copyFailed"),
        );
        return;
      }

      pushUndoAction({
        type: "copy",
        from,
        to,
        label: t("servers-management:filesManager.undo.actionLabels.copy", {
          name: selectedEntry.name,
        }),
      });
      toast.success(t("servers-management:filesManager.toasts.copied"));
      setCopyOpen(false);
      await refresh(currentPath, { preserveScroll: true });
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedEntry) {
      return;
    }

    if (!canWriteFiles) {
      toast.error(
        t("servers-management:filesManager.toasts.noPermissionDelete"),
      );
      return;
    }

    const file = getFullPath(currentPath, selectedEntry);
    const recursive = isDirectory(selectedEntry);

    setIsActionLoading(true);

    try {
      const response = await deleteFile({
        path: { server_id: serverId },
        query: {
          file,
          recursive,
        },
      });

      if (response.error) {
        toast.error(
          response.error.error?.msg ??
            t("servers-management:filesManager.toasts.deleteFailed"),
        );
        return;
      }

      toast.success(t("servers-management:filesManager.toasts.deleted"));
      setDeleteOpen(false);
      await refresh(currentPath, { preserveScroll: true });
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleArchive = async () => {
    if (archiveSources.length === 0) {
      return;
    }

    if (!canWriteFiles) {
      toast.error(
        t("servers-management:filesManager.toasts.noPermissionArchive"),
      );
      return;
    }

    const targetName = archiveNameInput.trim();
    if (!targetName) {
      return;
    }

    const to = normalizePath(joinPath(currentPath, targetName));

    setIsActionLoading(true);

    try {
      const response = await archiveFile({
        path: { server_id: serverId },
        query: {
          to,
          compression: archiveCompression,
        },
        body: {
          sources: archiveSources,
          exclude: archiveSelfExclusions(archiveSources, to),
        },
      });

      if (response.error) {
        toast.error(
          response.error.error?.msg ??
            t("servers-management:filesManager.toasts.archiveFailed"),
        );
        return;
      }

      toast.success(t("servers-management:filesManager.toasts.archiveCreated"));
      setArchiveOpen(false);
      clearSelection();
      await refresh(currentPath, { preserveScroll: true });
    } finally {
      setIsActionLoading(false);
    }
  };

  const openArchiveDialog = (sources: string[], suggestedName: string) => {
    setArchiveSources(sources);
    setArchiveCompression("zstd");
    setArchiveNameInput(`${suggestedName}.tar.zst`);
    setArchiveOpen(true);
  };

  const openPermissionsDialog = (entry: FileRow) => {
    setSelectedEntry(entry);
    setPermissionsModeInput(formatMode(entry.mode));
    setPermissionsUidInput(String(entry.uid));
    setPermissionsGidInput(String(entry.gid));
    setPermissionsOpen(true);
  };

  const handlePermissions = async () => {
    if (!selectedEntry) {
      return;
    }

    if (!canWriteFiles) {
      toast.error(
        t("servers-management:filesManager.toasts.noPermissionPermissions"),
      );
      return;
    }

    const mode = Number.parseInt(permissionsModeInput.trim(), 8);
    if (
      !/^[0-7]{3,4}$/.test(permissionsModeInput.trim()) ||
      Number.isNaN(mode)
    ) {
      toast.error(t("servers-management:filesManager.toasts.modeInvalid"));
      return;
    }

    const uid = Number.parseInt(permissionsUidInput.trim(), 10);
    const gid = Number.parseInt(permissionsGidInput.trim(), 10);
    if (
      !Number.isInteger(uid) ||
      uid < 0 ||
      !Number.isInteger(gid) ||
      gid < 0
    ) {
      toast.error(t("servers-management:filesManager.toasts.ownerInvalid"));
      return;
    }

    const file = getFullPath(currentPath, selectedEntry);

    setIsActionLoading(true);

    try {
      if (mode !== permissionBits(selectedEntry.mode)) {
        const response = await chmodFile({
          path: { server_id: serverId },
          query: { file, mode },
        });

        if (response.error) {
          toast.error(
            response.error.error?.msg ??
              t("servers-management:filesManager.toasts.chmodFailed"),
          );
          return;
        }
      }

      if (uid !== selectedEntry.uid || gid !== selectedEntry.gid) {
        const response = await chownFile({
          path: { server_id: serverId },
          query: { file, uid, gid },
        });

        if (response.error) {
          toast.error(
            response.error.error?.msg ??
              t("servers-management:filesManager.toasts.chownFailed"),
          );
          return;
        }
      }

      toast.success(
        t("servers-management:filesManager.toasts.permissionsUpdated"),
      );
      setPermissionsOpen(false);
      await refresh(currentPath, { preserveScroll: true });
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleMassDelete = async () => {
    if (!canWriteFiles) {
      toast.error(
        t("servers-management:filesManager.toasts.noPermissionDelete"),
      );
      return;
    }

    const entries = selectedEntries;
    if (entries.length === 0) {
      return;
    }

    setIsActionLoading(true);

    try {
      let failed = 0;

      for (const entry of entries) {
        const response = await deleteFile({
          path: { server_id: serverId },
          query: {
            file: getFullPath(currentPath, entry),
            recursive: isDirectory(entry),
          },
        });

        if (response.error) {
          failed += 1;
        }
      }

      if (failed > 0) {
        toast.error(
          t("servers-management:filesManager.toasts.massDeleteFailed", {
            count: failed,
          }),
        );
      } else {
        toast.success(
          t("servers-management:filesManager.toasts.massDeleted", {
            count: entries.length,
          }),
        );
      }

      setMassDeleteOpen(false);
      clearSelection();
      await refresh(currentPath, { preserveScroll: true });
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleMassMove = async () => {
    if (!canWriteFiles) {
      toast.error(t("servers-management:filesManager.toasts.noPermissionMove"));
      return;
    }

    const entries = selectedEntries;
    const target = normalizePath(massMoveInput);
    if (entries.length === 0 || !massMoveInput.trim()) {
      return;
    }

    setIsActionLoading(true);

    try {
      let failed = 0;
      let moved = 0;

      for (const entry of entries) {
        const from = getFullPath(currentPath, entry);
        const to = normalizePath(joinPath(target, entry.name));

        if (from === to) {
          continue;
        }

        if (
          isDirectory(entry) &&
          (target === from || target.startsWith(`${from}/`))
        ) {
          failed += 1;
          continue;
        }

        const response = await renameFile({
          path: { server_id: serverId },
          query: { from, to },
        });

        if (response.error) {
          failed += 1;
        } else {
          moved += 1;
        }
      }

      if (failed > 0) {
        toast.error(
          t("servers-management:filesManager.toasts.massMoveFailed", {
            count: failed,
          }),
        );
      } else {
        toast.success(
          t("servers-management:filesManager.toasts.massMoved", {
            count: moved,
            path: target,
          }),
        );
      }

      setMassMoveOpen(false);
      clearSelection();
      await refresh(currentPath, { preserveScroll: true });
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleUnarchive = async () => {
    if (!selectedEntry) {
      return;
    }

    if (!canWriteFiles) {
      toast.error(
        t("servers-management:filesManager.toasts.noPermissionExtract"),
      );
      return;
    }

    const targetName = unarchiveNameInput.trim();
    if (!targetName) {
      return;
    }

    const from = getFullPath(currentPath, selectedEntry);
    const to = normalizePath(joinPath(currentPath, targetName));

    setIsActionLoading(true);

    try {
      const response = await unarchiveFile({
        path: { server_id: serverId },
        query: {
          from,
          to,
        },
      });

      if (response.error) {
        toast.error(
          response.error.error?.msg ??
            t("servers-management:filesManager.toasts.unarchiveFailed"),
        );
        return;
      }

      toast.success(
        t("servers-management:filesManager.toasts.archiveExtracted"),
      );
      setUnarchiveOpen(false);
      await refresh(currentPath, { preserveScroll: true });
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleDownload = async (entry: FileRow) => {
    const file = getFullPath(currentPath, entry);

    setIsActionLoading(true);

    try {
      const response = await downloadUser({
        path: { server_id: serverId },
        query: {
          file,
        },
      });

      if (response.error || !response.data?.url) {
        toast.error(
          response.error?.error?.msg ??
            t("servers-management:filesManager.toasts.downloadUrlFailed"),
        );
        return;
      }

      window.open(response.data.url, "_blank", "noopener,noreferrer");
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleUpload = () => {
    if (!canWriteFiles) {
      toast.error(
        t("servers-management:filesManager.toasts.noPermissionUpload"),
      );
      return;
    }

    fileInputRef.current?.click();
  };

  const handleCreateFile = async () => {
    if (!canWriteFiles) {
      toast.error(
        t("servers-management:filesManager.toasts.noPermissionCreateFile"),
      );
      return;
    }

    const fileName = newFileNameInput.trim();
    if (!fileName) {
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

    const path = normalizePath(joinPath(currentPath, fileName));

    setIsActionLoading(true);

    try {
      const uploadUrlResponse = await uploadUser({
        path: { server_id: serverId },
        query: { file: path },
      });

      if (uploadUrlResponse.error || !uploadUrlResponse.data?.url) {
        toast.error(
          uploadUrlResponse.error?.error?.msg ??
            t("servers-management:filesManager.toasts.uploadUrlFailed", {
              fileName,
            }),
        );
        return;
      }

      const created = await uploadToSignedUrl({
        url: uploadUrlResponse.data.url,
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
      setCreateFileOpen(false);
      setNewFileNameInput("");
      router.push(
        `/${slug}/servers/${serverId}/edit?path=${encodeURIComponent(path)}`,
      );
    } catch {
      toast.error(t("servers-management:filesManager.toasts.createFileFailed"));
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleCreateDirectory = async () => {
    if (!canWriteFiles) {
      toast.error(
        t("servers-management:filesManager.toasts.noPermissionCreateDirectory"),
      );
      return;
    }

    const folderName = newDirectoryNameInput.trim();
    if (!folderName) {
      return;
    }

    const path = normalizePath(joinPath(currentPath, folderName));

    setIsActionLoading(true);

    try {
      const response = await createDirectory({
        path: { server_id: serverId },
        query: {
          file: path,
          recursive: false,
        },
      });

      if (response.error) {
        toast.error(
          response.error.error?.msg ??
            t("servers-management:filesManager.toasts.createDirectoryFailed"),
        );
        return;
      }

      pushUndoAction({
        type: "create-directory",
        path,
        label: t("servers-management:filesManager.undo.actionLabels.create", {
          name: folderName,
        }),
      });
      toast.success(
        t("servers-management:filesManager.toasts.directoryCreated"),
      );
      setCreateDirectoryOpen(false);
      await refresh(currentPath, { preserveScroll: true });
    } finally {
      setIsActionLoading(false);
    }
  };

  const onAction = async (entry: FileRow, action: string) => {
    switch (action) {
      case "Edit":
      case "View":
        openEditor(entry);
        return;
      case "Rename":
        setSelectedEntry(entry);
        setRenameInput(entry.name);
        setRenameOpen(true);
        return;
      case "Copy":
        setSelectedEntry(entry);
        setCopyInput(`${entry.name}.copy`);
        setCopyOpen(true);
        return;
      case "Delete":
        setSelectedEntry(entry);
        setDeleteOpen(true);
        return;
      case "Archive":
        setSelectedEntry(entry);
        openArchiveDialog([getFullPath(currentPath, entry)], entry.name);
        return;
      case "Permissions":
        openPermissionsDialog(entry);
        return;
      case "Unarchive":
        setSelectedEntry(entry);
        setUnarchiveNameInput(
          entry.name.replace(
            /\.(tar\.(gz|zst|xz|zlib|lz4|bz2)|tgz|tbz2|zip)$/i,
            "",
          ),
        );
        setUnarchiveOpen(true);
        return;
      case "Download":
        await handleDownload(entry);
    }
  };

  const getActionsForEntry = (entry: FileRow) => {
    const kind = getEntryKind(entry);

    if (kind === "directory") {
      return canWriteFiles
        ? ["Rename", "Permissions", "Archive", "Delete"]
        : ["Permissions"];
    }

    if (kind === "archive") {
      return canWriteFiles
        ? [
            "Rename",
            "Permissions",
            "Unarchive",
            "Archive",
            "Download",
            "Copy",
            "Delete",
          ]
        : ["Permissions", "Download"];
    }

    return canWriteFiles
      ? [
          "Edit",
          "Rename",
          "Permissions",
          "Archive",
          "Download",
          "Copy",
          "Delete",
        ]
      : ["View", "Permissions", "Download"];
  };

  const renderEntryActions = (entry: FileRow, Item: ActionMenuItem) =>
    getActionsForEntry(entry).map((action) => {
      const ActionIcon = getActionIcon(action);
      const destructive = action === "Delete";

      return (
        <Item
          key={`${entry.relative_path}-${action}`}
          disabled={filesBlocked}
          onSelect={() => {
            void onAction(entry, action);
          }}
          className={
            destructive ? "text-destructive focus:text-destructive" : undefined
          }
        >
          <ActionIcon
            className={`size-4 ${destructive ? "text-destructive" : "text-muted-foreground"}`}
          />
          {t(actionLabelKeys[action] ?? action)}
        </Item>
      );
    });

  return (
    <Card>
      <CardHeader className="space-y-4">
        <div>
          <CardTitle>{t("servers-management:filesManager.title")}</CardTitle>
          <CardDescription>
            {t("servers-management:filesManager.description")}
          </CardDescription>
        </div>

        {diskUsagePercent !== null && diskUsagePercent >= 80 ? (
          <Alert
            variant="destructive"
            className="border-destructive/40 bg-destructive/10"
          >
            <AlertTriangle className="size-4" />
            <AlertTitle>
              {t("servers-management:filesManager.diskUsageAlert.title")}
            </AlertTitle>
            <AlertDescription>
              {t("servers-management:filesManager.diskUsageAlert.description", {
                percent: diskUsagePercent.toFixed(1),
              })}
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex h-9 min-w-64 flex-1 items-center gap-1 rounded-md border bg-transparent px-1 text-sm">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={`size-7 shrink-0 text-muted-foreground hover:text-foreground ${
                dropTargetPath === "/" ? "bg-primary/10 text-primary" : ""
              }`}
              aria-label={t("servers-management:filesManager.goToRoot")}
              title={t("servers-management:filesManager.goToRoot")}
              disabled={filesBlocked}
              onClick={() => void refresh("/")}
              onDragOver={(event) => handleDragOverTarget(event, "/")}
              onDragLeave={() => handleDragLeaveTarget("/")}
              onDrop={(event) => {
                void handleDropToPath(event, "/");
              }}
            >
              <Home className="size-4" />
            </Button>
            {isEditingPath ? (
              <Input
                autoFocus
                value={pathInput}
                onChange={(event) => setPathInput(event.target.value)}
                onBlur={() => {
                  setPathInput(currentPath);
                  setIsEditingPath(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void refresh(pathInput);
                  }

                  if (event.key === "Escape") {
                    setPathInput(currentPath);
                    setIsEditingPath(false);
                  }
                }}
                className="h-7 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
                placeholder={t(
                  "servers-management:filesManager.pathInputPlaceholder",
                )}
              />
            ) : (
              <>
                <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
                  {segments.map((segment, index) => (
                    <span
                      key={segment.path}
                      className="inline-flex items-center gap-1"
                    >
                      <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                      <button
                        type="button"
                        onClick={() => void refresh(segment.path)}
                        onDragOver={(event) =>
                          handleDragOverTarget(event, segment.path)
                        }
                        onDragLeave={() => handleDragLeaveTarget(segment.path)}
                        onDrop={(event) => {
                          void handleDropToPath(event, segment.path);
                        }}
                        className={`truncate rounded px-1 py-0.5 hover:text-foreground ${
                          dropTargetPath === segment.path
                            ? "bg-primary/10 text-primary"
                            : index === segments.length - 1
                              ? "font-medium text-foreground"
                              : "text-muted-foreground"
                        }`}
                      >
                        {segment.label}
                      </button>
                    </span>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setIsEditingPath(true)}
                  disabled={filesBlocked}
                  aria-label={t("servers-management:filesManager.editPath")}
                  title={t("servers-management:filesManager.editPath")}
                  className="h-7 flex-1 cursor-text rounded"
                />
              </>
            )}
          </div>

          <div className="relative w-full sm:w-56">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="pr-8 pl-8"
              placeholder={t(
                "servers-management:filesManager.searchPlaceholder",
              )}
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                aria-label={t("common:actions.clear")}
                className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={() => void refresh()}
            disabled={filesBlocked}
          >
            <RefreshCcw className="size-4" />
            {t("common:actions.refresh")}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                disabled={isActionLoading || !canWriteFiles || filesBlocked}
              >
                <Plus className="size-4" />
                <ChevronDown className="size-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => {
                  handleUpload();
                }}
              >
                <Upload className="size-4 text-muted-foreground" />
                {t("common:actions.upload")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setCreateFileOpen(true)}>
                <FilePlus className="size-4 text-muted-foreground" />
                {t("servers-management:filesManager.newFileButton")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setCreateDirectoryOpen(true)}>
                <FolderPlus className="size-4 text-muted-foreground" />
                {t("servers-management:filesManager.newFolderButton")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {storageLock.locked || modpackInstalling ? (
          <div className="flex flex-wrap items-center gap-2">
            <TaskLockNotice lock={storageLock} />
            {modpackInstalling ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Boxes className="size-3.5 shrink-0" />
                {t("servers-management:mods.filesLockedNotice")}
              </p>
            ) : null}
          </div>
        ) : null}
      </CardHeader>

      <CardContent>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            void handlePickerUpload(event);
          }}
        />
        <UploadProgressPanel
          tasks={uploadTasks}
          onCancelTask={cancelUploadTask}
          onCancelAll={cancelAllUploads}
          onDismiss={() => {
            clearUploadDismissTimeout();
            setUploadTasks([]);
          }}
        />
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t("servers-management:filesManager.loadingFiles")}
          </div>
        ) : visibleFiles.length === 0 ? (
          <div
            onDragOver={handleManagerDragOver}
            onDragLeave={handleManagerDragLeave}
            onDrop={(event) => {
              void handleManagerDrop(event);
            }}
            className={`rounded-lg border border-dashed p-8 text-center transition-colors ${
              isFileDropActive ? "border-primary bg-primary/5" : ""
            }`}
          >
            <p className="text-sm text-muted-foreground">
              {files.length === 0
                ? t("servers-management:filesManager.emptyState.title")
                : t("servers-management:filesManager.emptyState.noMatches", {
                    query: searchQuery.trim(),
                  })}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {files.length === 0
                ? t("servers-management:filesManager.emptyState.hint")
                : t("servers-management:filesManager.emptyState.noMatchesHint")}
            </p>
          </div>
        ) : (
          <div
            className={`overflow-hidden rounded-lg border transition-colors ${
              isFileDropActive ? "border-primary bg-primary/5" : ""
            }`}
            onDragOver={handleManagerDragOver}
            onDragLeave={handleManagerDragLeave}
            onDrop={(event) => {
              void handleManagerDrop(event);
            }}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={
                        allSelected ||
                        (selectedNames.length > 0 && "indeterminate")
                      }
                      onCheckedChange={toggleSelectAll}
                      aria-label={t(
                        "servers-management:filesManager.selection.selectAll",
                      )}
                    />
                  </TableHead>
                  <TableHead>{t("common:labels.name")}</TableHead>
                  <TableHead>{t("common:labels.size")}</TableHead>
                  <TableHead>
                    {t("servers-management:filesManager.modeColumn")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("common:labels.actions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleFiles.map((entry) => {
                  const kind = getEntryKind(entry);
                  const directory = kind === "directory";

                  return (
                    <ContextMenu
                      key={entry.relative_path || `${entry.name}-${entry.mode}`}
                    >
                      <ContextMenuTrigger asChild>
                        <TableRow
                          className={
                            directory &&
                            dropTargetPath ===
                              normalizePath(joinPath(currentPath, entry.name))
                              ? "bg-primary/5"
                              : ""
                          }
                          onDragOver={
                            directory
                              ? (event) =>
                                  handleDragOverTarget(
                                    event,
                                    normalizePath(
                                      joinPath(currentPath, entry.name),
                                    ),
                                  )
                              : undefined
                          }
                          onDragLeave={
                            directory
                              ? () =>
                                  handleDragLeaveTarget(
                                    normalizePath(
                                      joinPath(currentPath, entry.name),
                                    ),
                                  )
                              : undefined
                          }
                          onDrop={
                            directory
                              ? (event) => {
                                  void handleDropToPath(
                                    event,
                                    normalizePath(
                                      joinPath(currentPath, entry.name),
                                    ),
                                  );
                                }
                              : undefined
                          }
                        >
                          <TableCell>
                            <Checkbox
                              checked={selectedNames.includes(entry.name)}
                              onCheckedChange={() => toggleEntrySelection(entry)}
                              aria-label={t(
                                "servers-management:filesManager.selection.selectEntry",
                                { name: entry.name },
                              )}
                            />
                          </TableCell>
                          <TableCell>
                            {directory ? (
                              <button
                                type="button"
                                draggable
                                onDragStart={(event) =>
                                  handleEntryDragStart(event, entry)
                                }
                                onDragEnd={handleEntryDragEnd}
                                onClick={() =>
                                  void refresh(
                                    joinPath(currentPath, entry.name),
                                  )
                                }
                                className="inline-flex cursor-grab items-center gap-2 font-medium hover:text-primary active:cursor-grabbing"
                              >
                                <Folder className="size-4" />
                                {entry.name}
                              </button>
                            ) : (
                              <button
                                type="button"
                                draggable
                                onDragStart={(event) =>
                                  handleEntryDragStart(event, entry)
                                }
                                onDragEnd={handleEntryDragEnd}
                                onClick={() => handleFileClick(entry)}
                                className="inline-flex cursor-grab items-center gap-2 hover:text-primary active:cursor-grabbing"
                              >
                                <File className="size-4" />
                                {entry.name}
                              </button>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {directory
                              ? "-"
                              : formatBytes(
                                  entry.size,
                                  t("common:status.unknown"),
                                )}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {formatMode(entry.mode)}
                          </TableCell>
                          <TableCell className="text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button type="button" size="sm" variant="ghost">
                                  <MoreHorizontal className="size-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-44">
                                {renderEntryActions(entry, DropdownMenuItem)}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      </ContextMenuTrigger>
                      <ContextMenuContent className="w-44">
                        {renderEntryActions(entry, ContextMenuItem)}
                      </ContextMenuContent>
                    </ContextMenu>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {selectedNames.length > 0 ? (
          <div className="fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-background/95 p-2 shadow-lg backdrop-blur">
              <span className="px-2 text-sm text-muted-foreground">
                {t("servers-management:filesManager.selection.selected", {
                  count: selectedNames.length,
                })}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={isActionLoading || !canWriteFiles || filesBlocked}
                onClick={() => {
                  setMassMoveInput(currentPath);
                  setMassMoveOpen(true);
                }}
              >
                <FolderInput className="size-4" />
                {t("common:actions.move")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={isActionLoading || !canWriteFiles || filesBlocked}
                onClick={() =>
                  openArchiveDialog(
                    selectedEntries.map((entry) =>
                      getFullPath(currentPath, entry),
                    ),
                    currentPath === "/"
                      ? "archive"
                      : (currentPath.split("/").pop() ?? "archive"),
                  )
                }
              >
                <Archive className="size-4" />
                {t("common:resources.archive")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="text-destructive hover:text-destructive"
                disabled={isActionLoading || !canWriteFiles || filesBlocked}
                onClick={() => setMassDeleteOpen(true)}
              >
                <Trash2 className="size-4" />
                {t("common:actions.delete")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={clearSelection}
              >
                <X className="size-4" />
                {t("servers-management:filesManager.selection.clear")}
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>

      <Dialog
        open={renameOpen}
        onOpenChange={(open) => {
          setRenameOpen(open);
          if (!open) {
            setRenameInput("");
            setSelectedEntry(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("common:actions.rename")}</DialogTitle>
            <DialogDescription>
              {t("servers-management:filesManager.renameDialog.description", {
                name:
                  selectedEntry?.name ??
                  t("servers-management:filesManager.fallbacks.thisItem"),
              })}
            </DialogDescription>
          </DialogHeader>
          <Input
            value={renameInput}
            onChange={(event) => setRenameInput(event.target.value)}
            placeholder={t(
              "servers-management:filesManager.renameDialog.placeholder",
            )}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRenameOpen(false)}
              disabled={isActionLoading}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => {
                void handleRename();
              }}
              loading={isActionLoading}
              disabled={filesBlocked}
            >
              {t("common:actions.rename")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={copyOpen}
        onOpenChange={(open) => {
          setCopyOpen(open);
          if (!open) {
            setCopyInput("");
            setSelectedEntry(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("common:actions.copy")}</DialogTitle>
            <DialogDescription>
              {t("servers-management:filesManager.copyDialog.description", {
                name:
                  selectedEntry?.name ??
                  t("servers-management:filesManager.fallbacks.thisItem"),
              })}
            </DialogDescription>
          </DialogHeader>
          <Input
            value={copyInput}
            onChange={(event) => setCopyInput(event.target.value)}
            placeholder={t(
              "servers-management:filesManager.copyDialog.placeholder",
            )}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCopyOpen(false)}
              disabled={isActionLoading}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => {
                void handleCopy();
              }}
              loading={isActionLoading}
              disabled={filesBlocked}
            >
              {t("common:actions.copy")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open) {
            setSelectedEntry(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("servers-management:filesManager.deleteDialog.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("servers-management:filesManager.deleteDialog.description", {
                name:
                  selectedEntry?.name ??
                  t("servers-management:filesManager.fallbacks.thisItem"),
                recursiveSuffix:
                  selectedEntry && isDirectory(selectedEntry)
                    ? t(
                        "servers-management:filesManager.deleteDialog.recursiveSuffix",
                      )
                    : "",
              })}{" "}
              {t("common:confirmDelete.cannotBeUndone")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isActionLoading}>
              {t("common:actions.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void handleDelete();
              }}
              disabled={isActionLoading || filesBlocked}
            >
              {t("common:actions.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={archiveOpen}
        onOpenChange={(open) => {
          setArchiveOpen(open);
          if (!open) {
            setArchiveNameInput("");
            setArchiveSources([]);
            setArchiveCompression("zstd");
            setSelectedEntry(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("servers-management:filesManager.archiveDialog.title")}
            </DialogTitle>
            <DialogDescription>
              {t("servers-management:filesManager.archiveDialog.description", {
                count: archiveSources.length,
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-40 overflow-y-auto rounded-md border bg-muted/40 p-2">
            <ul className="space-y-1 font-mono text-xs text-muted-foreground">
              {archiveSources.map((source) => (
                <li key={source}>{source}</li>
              ))}
            </ul>
          </div>
          <Input
            value={archiveNameInput}
            onChange={(event) => setArchiveNameInput(event.target.value)}
            placeholder={t(
              "servers-management:filesManager.archiveDialog.namePlaceholder",
            )}
          />
          <div className="space-y-2">
            <p className="text-sm font-medium">
              {t(
                "servers-management:filesManager.archiveDialog.compressionLabel",
              )}
            </p>
            <Select
              value={archiveCompression}
              onValueChange={(value) => {
                setArchiveCompression(value as ArchiveCompression);

                setArchiveNameInput((prev) => {
                  const baseName = prev.replace(
                    /\.(tar\.(gz|zst|xz|zlib|lz4|bz2)|tgz|tbz2|zip)$/i,
                    "",
                  );
                  let extension = "";

                  switch (value) {
                    case "zstd":
                      extension = ".tar.zst";
                      break;
                    case "xz":
                      extension = ".tar.xz";
                      break;
                    case "zlib":
                      extension = ".tar.zlib";
                      break;
                    case "lz4":
                      extension = ".tar.lz4";
                      break;
                    case "bzip2":
                      extension = ".tar.bz2";
                      break;
                    case "gzip":
                    default:
                      extension = ".tar.gz";
                  }

                  return `${baseName}${extension}`;
                });
              }}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={t(
                    "servers-management:filesManager.archiveDialog.compressionPlaceholder",
                  )}
                />
              </SelectTrigger>
              <SelectContent>
                {archiveCompressionOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setArchiveOpen(false)}
              disabled={isActionLoading}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => {
                void handleArchive();
              }}
              loading={isActionLoading}
              disabled={filesBlocked}
            >
              {t("common:resources.archive")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={unarchiveOpen}
        onOpenChange={(open) => {
          setUnarchiveOpen(open);
          if (!open) {
            setUnarchiveNameInput("");
            setSelectedEntry(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("servers-management:filesManager.unarchiveDialog.title")}
            </DialogTitle>
            <DialogDescription>
              {t(
                "servers-management:filesManager.unarchiveDialog.description",
                {
                  name:
                    selectedEntry?.name ??
                    t("servers-management:filesManager.fallbacks.thisArchive"),
                },
              )}
            </DialogDescription>
          </DialogHeader>
          <Input
            value={unarchiveNameInput}
            onChange={(event) => setUnarchiveNameInput(event.target.value)}
            placeholder={t(
              "servers-management:filesManager.unarchiveDialog.placeholder",
            )}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setUnarchiveOpen(false)}
              disabled={isActionLoading}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => {
                void handleUnarchive();
              }}
              loading={isActionLoading}
              disabled={filesBlocked}
            >
              {t(
                "servers-management:filesManager.unarchiveDialog.submitButton",
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={permissionsOpen}
        onOpenChange={(open) => {
          setPermissionsOpen(open);
          if (!open) {
            setSelectedEntry(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("servers-management:filesManager.permissionsDialog.title")}
            </DialogTitle>
            <DialogDescription>
              {t(
                "servers-management:filesManager.permissionsDialog.description",
                {
                  name:
                    selectedEntry?.name ??
                    t("servers-management:filesManager.fallbacks.thisItem"),
                },
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm font-medium">
              {t("servers-management:filesManager.permissionsDialog.modeLabel")}
            </p>
            <Input
              value={permissionsModeInput}
              onChange={(event) => setPermissionsModeInput(event.target.value)}
              className="font-mono"
              placeholder="0644"
              disabled={!canWriteFiles || filesBlocked}
            />
            <p className="font-mono text-xs text-muted-foreground">
              {/^[0-7]{3,4}$/.test(permissionsModeInput.trim())
                ? formatSymbolicMode(
                    Number.parseInt(permissionsModeInput.trim(), 8),
                  )
                : t(
                    "servers-management:filesManager.permissionsDialog.modeHint",
                  )}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <p className="text-sm font-medium">
                {t("servers-management:filesManager.permissionsDialog.uidLabel")}
              </p>
              <Input
                value={permissionsUidInput}
                onChange={(event) => setPermissionsUidInput(event.target.value)}
                inputMode="numeric"
                disabled={!canWriteFiles || filesBlocked}
              />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">
                {t("servers-management:filesManager.permissionsDialog.gidLabel")}
              </p>
              <Input
                value={permissionsGidInput}
                onChange={(event) => setPermissionsGidInput(event.target.value)}
                inputMode="numeric"
                disabled={!canWriteFiles || filesBlocked}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPermissionsOpen(false)}
              disabled={isActionLoading}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => {
                void handlePermissions();
              }}
              loading={isActionLoading}
              disabled={!canWriteFiles || filesBlocked}
            >
              {t("common:actions.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={massMoveOpen}
        onOpenChange={(open) => {
          setMassMoveOpen(open);
          if (!open) {
            setMassMoveInput("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("servers-management:filesManager.massMoveDialog.title")}
            </DialogTitle>
            <DialogDescription>
              {t("servers-management:filesManager.massMoveDialog.description", {
                count: selectedNames.length,
              })}
            </DialogDescription>
          </DialogHeader>
          <Input
            value={massMoveInput}
            onChange={(event) => setMassMoveInput(event.target.value)}
            placeholder={t(
              "servers-management:filesManager.massMoveDialog.placeholder",
            )}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setMassMoveOpen(false)}
              disabled={isActionLoading}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => {
                void handleMassMove();
              }}
              loading={isActionLoading}
              disabled={filesBlocked}
            >
              {t("common:actions.move")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={massDeleteOpen} onOpenChange={setMassDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("servers-management:filesManager.massDeleteDialog.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "servers-management:filesManager.massDeleteDialog.description",
                { count: selectedNames.length },
              )}{" "}
              {t("common:confirmDelete.cannotBeUndone")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isActionLoading}>
              {t("common:actions.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleMassDelete();
              }}
              disabled={isActionLoading || filesBlocked}
              className="bg-destructive hover:bg-destructive/90"
            >
              {t("common:actions.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={createDirectoryOpen}
        onOpenChange={(open) => {
          setCreateDirectoryOpen(open);
          if (!open) {
            setNewDirectoryNameInput("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("servers-management:filesManager.createDirectoryDialog.title")}
            </DialogTitle>
            <DialogDescription>
              {t(
                "servers-management:filesManager.createDirectoryDialog.description",
                { path: currentPath },
              )}
            </DialogDescription>
          </DialogHeader>
          <Input
            value={newDirectoryNameInput}
            onChange={(event) => setNewDirectoryNameInput(event.target.value)}
            placeholder={t(
              "servers-management:filesManager.createDirectoryDialog.placeholder",
            )}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreateDirectoryOpen(false)}
              disabled={isActionLoading}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => {
                void handleCreateDirectory();
              }}
              loading={isActionLoading}
              disabled={filesBlocked}
            >
              {t("common:actions.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={createFileOpen}
        onOpenChange={(open) => {
          setCreateFileOpen(open);
          if (!open) {
            setNewFileNameInput("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("servers-management:filesManager.createFileDialog.title")}
            </DialogTitle>
            <DialogDescription>
              {t(
                "servers-management:filesManager.createFileDialog.description",
                { path: currentPath },
              )}
            </DialogDescription>
          </DialogHeader>
          <Input
            value={newFileNameInput}
            onChange={(event) => setNewFileNameInput(event.target.value)}
            placeholder={t(
              "servers-management:filesManager.createFileDialog.placeholder",
            )}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreateFileOpen(false)}
              disabled={isActionLoading}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => {
                void handleCreateFile();
              }}
              loading={isActionLoading}
              disabled={filesBlocked}
            >
              {t("common:actions.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
