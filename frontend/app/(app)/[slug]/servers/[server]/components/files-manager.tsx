"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { useRouter } from "@/lib/navigation";
import {
  AlertTriangle,
  Archive,
  ChevronRight,
  Copy,
  Download,
  File,
  Folder,
  FolderInput,
  FolderPlus,
  Loader2,
  MoreHorizontal,
  Pencil,
  Shield,
  RefreshCcw,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

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
import {
  DISK_USAGE_EVENT,
  type DiskUsageEventDetail,
} from "./server-management-bar";
import type { LucideIcon } from "lucide-react";

type FilesManagerProps = {
  serverId: string;
  slug: string;
  canWriteFiles: boolean;
};

type FileRow = ListFilesResponses[200][number];

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

const ARCHIVE_COMPRESSION_OPTIONS: Array<{
  value: ArchiveCompression;
  label: string;
}> = [
  { value: "zstd", label: "Zstandard (zstd)" },
  { value: "xz", label: "XZ" },
  { value: "zlib", label: "Zlib" },
  { value: "lz4", label: "LZ4" },
  { value: "gzip", label: "Gzip" },
  { value: "bzip2", label: "Bzip2" },
];

function normalizePath(input: string) {
  const trimmed = input.trim();
  if (!trimmed || trimmed === "/") {
    return "/";
  }

  const cleaned = trimmed.replace(/\/+/g, "/").replace(/\/$/, "");
  return cleaned.startsWith("/") ? cleaned : `/${cleaned}`;
}

function joinPath(basePath: string, childName: string) {
  if (basePath === "/") {
    return `/${childName}`;
  }

  return `${basePath}/${childName}`;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "Unknown";
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
}: FilesManagerProps) {
  const router = useRouter();
  const [currentPath, setCurrentPath] = useState("/");
  const [pathInput, setPathInput] = useState("/");
  const [files, setFiles] = useState<FileRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedEntry, setSelectedEntry] = useState<FileRow | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [unarchiveOpen, setUnarchiveOpen] = useState(false);
  const [createDirectoryOpen, setCreateDirectoryOpen] = useState(false);
  const [renameInput, setRenameInput] = useState("");
  const [copyInput, setCopyInput] = useState("");
  const [archiveNameInput, setArchiveNameInput] = useState("");
  const [archiveCompression, setArchiveCompression] =
    useState<ArchiveCompression>("zstd");
  const [unarchiveNameInput, setUnarchiveNameInput] = useState("");
  const [newDirectoryNameInput, setNewDirectoryNameInput] = useState("");
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [diskUsagePercent, setDiskUsagePercent] = useState<number | null>(null);
  const [draggedEntry, setDraggedEntry] = useState<FileRow | null>(null);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const [isFileDropActive, setIsFileDropActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const undoStackRef = useRef<UndoableAction[]>([]);
  const redoStackRef = useRef<UndoableAction[]>([]);
  const isHistoryPlaybackRef = useRef(false);
  const suppressEntryClickRef = useRef(false);

  const segments = useMemo(() => buildPathSegments(currentPath), [currentPath]);
  const parentPath = useMemo(() => {
    if (currentPath === "/") {
      return "/";
    }

    const parts = currentPath.split("/").filter(Boolean);
    parts.pop();

    return parts.length === 0 ? "/" : `/${parts.join("/")}`;
  }, [currentPath]);

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
      setCurrentPath(normalized);
      setPathInput(normalized);
    } catch {
      toast.error("Failed to load files for this path");
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const goToParent = () => {
    if (currentPath === "/") {
      return;
    }

    const parts = currentPath.split("/").filter(Boolean);
    parts.pop();

    const nextPath = parts.length === 0 ? "/" : `/${parts.join("/")}`;
    void refresh(nextPath);
  };

  const showPlaceholderAction = (name: string) => {
    toast.info(`${name} is a placeholder action for now.`);
  };

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
          response.error.error?.msg ?? `Failed to ${direction} rename`,
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
          toast.error(response.error.error?.msg ?? "Failed to undo copy");
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
        toast.error(response.error.error?.msg ?? "Failed to redo copy");
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
        toast.error(response.error.error?.msg ?? "Failed to undo create");
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
      toast.error(response.error.error?.msg ?? "Failed to redo create");
      return false;
    }

    return true;
  };

  const handleUndo = async () => {
    const action = undoStackRef.current.pop();
    if (!action) {
      toast.info("Nothing to undo");
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
      toast.success(`Undid: ${action.label}`);
      await refresh(currentPath, { preserveScroll: true });
    } finally {
      isHistoryPlaybackRef.current = false;
      setIsActionLoading(false);
    }
  };

  const handleRedo = async () => {
    const action = redoStackRef.current.pop();
    if (!action) {
      toast.info("Nothing to redo");
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
      toast.success(`Redid: ${action.label}`);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath]);

  const hasDraggedFiles = (event: DragEvent<HTMLElement>) =>
    Array.from(event.dataTransfer.types).includes("Files");

  const uploadFiles = async (
    incomingFiles: File[],
    targetDirectoryPath = currentPath,
  ) => {
    if (!canWriteFiles) {
      toast.error("You do not have permission to upload files");
      return;
    }

    if (incomingFiles.length === 0) {
      return;
    }

    setIsActionLoading(true);

    let successCount = 0;

    try {
      for (const file of incomingFiles) {
        const destinationPath = normalizePath(
          joinPath(targetDirectoryPath, file.name),
        );

        const uploadUrlResponse = await uploadUser({
          path: { server_id: serverId },
          query: {
            file: destinationPath,
          },
        });

        if (uploadUrlResponse.error || !uploadUrlResponse.data?.url) {
          toast.error(
            uploadUrlResponse.error?.error?.msg ??
              `Failed to get upload URL for ${file.name}`,
          );
          continue;
        }

        const putUpload = await fetch(uploadUrlResponse.data.url, {
          method: "PUT",
          body: file,
          headers: file.type ? { "Content-Type": file.type } : undefined,
        });

        if (!putUpload.ok) {
          const formData = new FormData();
          formData.append("file", file, file.name);

          const postUpload = await fetch(uploadUrlResponse.data.url, {
            method: "POST",
            body: formData,
          });

          if (!postUpload.ok) {
            toast.error(`Failed to upload ${file.name}`);
            continue;
          }
        }

        successCount += 1;
      }

      if (successCount > 0) {
        toast.success(
          successCount === 1
            ? "Uploaded 1 file"
            : `Uploaded ${successCount} files`,
        );
        await refresh(currentPath, { preserveScroll: true });
      }
    } catch {
      toast.error("Upload failed");
    } finally {
      setIsActionLoading(false);
      setIsFileDropActive(false);
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
    if (!canWriteFiles) {
      toast.error("You do not have permission to move files");
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
      toast.error("A directory cannot be moved into itself");
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
        toast.error(response.error.error?.msg ?? "Failed to move item");
        return;
      }

      pushUndoAction({
        type: "rename",
        from,
        to,
        label: `Move ${entry.name}`,
      });
      toast.success(`Moved ${entry.name}`);
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
      toast.error("You do not have permission to rename files");
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
        toast.error(response.error.error?.msg ?? "Failed to rename");
        return;
      }

      pushUndoAction({
        type: "rename",
        from,
        to,
        label: `Rename ${selectedEntry.name}`,
      });
      toast.success("Renamed successfully");
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
      toast.error("You do not have permission to copy files");
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
        toast.error(response.error.error?.msg ?? "Failed to copy");
        return;
      }

      pushUndoAction({
        type: "copy",
        from,
        to,
        label: `Copy ${selectedEntry.name}`,
      });
      toast.success("Copied successfully");
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
      toast.error("You do not have permission to delete files");
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
        toast.error(response.error.error?.msg ?? "Failed to delete");
        return;
      }

      toast.success("Deleted successfully");
      setDeleteOpen(false);
      await refresh(currentPath, { preserveScroll: true });
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleArchive = async () => {
    if (!selectedEntry) {
      return;
    }

    if (!canWriteFiles) {
      toast.error("You do not have permission to archive files");
      return;
    }

    if (!isDirectory(selectedEntry)) {
      toast.error("Archive is only supported for directories");
      return;
    }

    const targetName = archiveNameInput.trim();
    if (!targetName) {
      return;
    }

    const from = getFullPath(currentPath, selectedEntry);
    const to = normalizePath(joinPath(currentPath, targetName));

    setIsActionLoading(true);

    try {
      const response = await archiveFile({
        path: { server_id: serverId },
        query: {
          from,
          to,
          compression: archiveCompression,
        },
      });

      if (response.error) {
        toast.error(response.error.error?.msg ?? "Failed to archive");
        return;
      }

      toast.success("Archive created successfully");
      setArchiveOpen(false);
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
      toast.error("You do not have permission to extract files");
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
        toast.error(response.error.error?.msg ?? "Failed to unarchive");
        return;
      }

      toast.success("Archive extracted successfully");
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
        toast.error(response.error?.error?.msg ?? "Failed to get download URL");
        return;
      }

      window.open(response.data.url, "_blank", "noopener,noreferrer");
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleUpload = () => {
    if (!canWriteFiles) {
      toast.error("You do not have permission to upload files");
      return;
    }

    fileInputRef.current?.click();
  };

  const handleCreateDirectory = async () => {
    if (!canWriteFiles) {
      toast.error("You do not have permission to create directories");
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
        toast.error(response.error.error?.msg ?? "Failed to create directory");
        return;
      }

      pushUndoAction({
        type: "create-directory",
        path,
        label: `Create ${folderName}`,
      });
      toast.success("Directory created");
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
        setArchiveNameInput(`${entry.name}.tar.zst`);
        setArchiveCompression("zstd");
        setArchiveOpen(true);
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
        return;
      default:
        showPlaceholderAction(`${action} (${entry.name})`);
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
        ? ["Rename", "Permissions", "Unarchive", "Download", "Copy", "Delete"]
        : ["Permissions", "Download"];
    }

    return canWriteFiles
      ? ["Edit", "Rename", "Permissions", "Download", "Copy", "Delete"]
      : ["View", "Permissions", "Download"];
  };

  return (
    <Card>
      <CardHeader className="space-y-4">
        <div>
          <CardTitle>Files</CardTitle>
          <CardDescription>
            Browse server files and manage actions.
          </CardDescription>
        </div>

        {diskUsagePercent !== null && diskUsagePercent >= 80 ? (
          <Alert
            variant="destructive"
            className="border-destructive/40 bg-destructive/10"
          >
            <AlertTriangle className="size-4" />
            <AlertTitle>Disk usage is getting tight</AlertTitle>
            <AlertDescription>
              Disk is currently at {diskUsagePercent.toFixed(1)}% usage.
              Consider cleaning up files to avoid allocation issues.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={goToParent}
            onDragOver={(event) => handleDragOverTarget(event, parentPath)}
            onDragLeave={() => handleDragLeaveTarget(parentPath)}
            onDrop={(event) => {
              void handleDropToPath(event, parentPath);
            }}
            className={
              dropTargetPath === parentPath
                ? "border-primary bg-primary/10"
                : ""
            }
          >
            ..
          </Button>
          <div className="flex min-w-64 flex-1 items-center gap-2 rounded-md border px-2 py-1.5 text-sm">
            <button
              type="button"
              onClick={() => void refresh("/")}
              onDragOver={(event) => handleDragOverTarget(event, "/")}
              onDragLeave={() => handleDragLeaveTarget("/")}
              onDrop={(event) => {
                void handleDropToPath(event, "/");
              }}
              className={`rounded px-1 text-muted-foreground hover:text-foreground ${
                dropTargetPath === "/" ? "bg-primary/10 text-primary" : ""
              }`}
            >
              /
            </button>
            {segments.map((segment) => (
              <span
                key={segment.path}
                className="inline-flex items-center gap-1"
              >
                <ChevronRight className="size-3 text-muted-foreground" />
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
                  className={`rounded px-1 text-muted-foreground hover:text-foreground ${
                    dropTargetPath === segment.path
                      ? "bg-primary/10 text-primary"
                      : ""
                  }`}
                >
                  {segment.label}
                </button>
              </span>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={pathInput}
            onChange={(event) => setPathInput(event.target.value)}
            className="max-w-xl"
            placeholder="Enter path"
          />
          <Button type="button" onClick={() => void refresh(pathInput)}>
            Open Path
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void refresh()}
          >
            <RefreshCcw className="size-4" />
            Refresh
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              handleUpload();
            }}
            disabled={isActionLoading || !canWriteFiles}
          >
            <Upload className="size-4" />
            Upload
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setCreateDirectoryOpen(true)}
            disabled={isActionLoading || !canWriteFiles}
          >
            <FolderPlus className="size-4" />
            New Folder
          </Button>
        </div>
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
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading files...
          </div>
        ) : files.length === 0 ? (
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
              This directory is empty.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Drop files here to upload.
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
                  <TableHead>Name</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.map((entry) => {
                  const kind = getEntryKind(entry);
                  const directory = kind === "directory";

                  return (
                    <TableRow
                      key={entry.relative_path || `${entry.name}-${entry.mode}`}
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
                        {directory ? (
                          <button
                            type="button"
                            draggable
                            onDragStart={(event) =>
                              handleEntryDragStart(event, entry)
                            }
                            onDragEnd={handleEntryDragEnd}
                            onClick={() =>
                              void refresh(joinPath(currentPath, entry.name))
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
                        {directory ? "-" : formatBytes(entry.size)}
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button type="button" size="sm" variant="ghost">
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            {getActionsForEntry(entry).map((action) => {
                              const ActionIcon = getActionIcon(action);

                              return (
                                <DropdownMenuItem
                                  key={`${entry.relative_path}-${action}`}
                                  onSelect={() => {
                                    void onAction(entry, action);
                                  }}
                                  className={action === "Delete" ? "text-destructive focus:text-destructive" : undefined}
                                >
                                  <ActionIcon
                                    className={`size-4 ${action === "Delete" ? "text-destructive" : "text-muted-foreground"}`}
                                  />
                                  {action}
                                </DropdownMenuItem>
                              );
                            })}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
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
            <DialogTitle>Rename</DialogTitle>
            <DialogDescription>
              Rename {selectedEntry?.name ?? "this item"}.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={renameInput}
            onChange={(event) => setRenameInput(event.target.value)}
            placeholder="New name"
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRenameOpen(false)}
              disabled={isActionLoading}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                void handleRename();
              }}
              loading={isActionLoading}
            >
              Rename
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
            <DialogTitle>Copy</DialogTitle>
            <DialogDescription>
              Create a copy of {selectedEntry?.name ?? "this item"}.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={copyInput}
            onChange={(event) => setCopyInput(event.target.value)}
            placeholder="Copy name"
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCopyOpen(false)}
              disabled={isActionLoading}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                void handleCopy();
              }}
              loading={isActionLoading}
            >
              Copy
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
            <AlertDialogTitle>Delete item?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete {selectedEntry?.name ?? "this item"}
              {selectedEntry && isDirectory(selectedEntry)
                ? " recursively"
                : ""}
              . This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isActionLoading}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void handleDelete();
              }}
              disabled={isActionLoading}
            >
              Delete
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
            setArchiveCompression("gzip");
            setSelectedEntry(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive directory</DialogTitle>
            <DialogDescription>
              Create an archive from {selectedEntry?.name ?? "this directory"}.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={archiveNameInput}
            onChange={(event) => setArchiveNameInput(event.target.value)}
            placeholder="archive-name.tar.gz"
          />
          <div className="space-y-2">
            <p className="text-sm font-medium">Compression type</p>
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
                <SelectValue placeholder="Select compression" />
              </SelectTrigger>
              <SelectContent>
                {ARCHIVE_COMPRESSION_OPTIONS.map((option) => (
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
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                void handleArchive();
              }}
              loading={isActionLoading}
            >
              Archive
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
            <DialogTitle>Unarchive</DialogTitle>
            <DialogDescription>
              Extract {selectedEntry?.name ?? "this archive"} to a directory.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={unarchiveNameInput}
            onChange={(event) => setUnarchiveNameInput(event.target.value)}
            placeholder="target-directory"
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setUnarchiveOpen(false)}
              disabled={isActionLoading}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                void handleUnarchive();
              }}
              loading={isActionLoading}
            >
              Extract
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            <DialogTitle>Create directory</DialogTitle>
            <DialogDescription>
              Create a new folder inside {currentPath}.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={newDirectoryNameInput}
            onChange={(event) => setNewDirectoryNameInput(event.target.value)}
            placeholder="folder-name"
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreateDirectoryOpen(false)}
              disabled={isActionLoading}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                void handleCreateDirectory();
              }}
              loading={isActionLoading}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
