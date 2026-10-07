"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Archive,
  Boxes,
  ChevronDown,
  FilePlus,
  FolderInput,
  FolderPlus,
  Plus,
  RefreshCcw,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import useSWR, { useSWRConfig } from "swr";
import { useTranslation } from "react-i18next";

import { TaskLockNotice } from "@/components/server/task-lock-notice";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { normalizePath } from "@/lib/files";
import { useServerTaskLock } from "@/stores/server-tasks";
import {
  DISK_USAGE_EVENT,
  type DiskUsageEventDetail,
} from "@/lib/server-status";
import type { EntryAction } from "./entry-actions";
import {
  ArchiveDialog,
  ConfirmDeleteDialog,
  NameDialog,
  PermissionsDialog,
} from "./file-dialogs";
import { FilesTable } from "./files-table";
import { PathBar } from "./path-bar";
import UploadProgressPanel from "./upload-progress";
import { useFileDrag } from "./use-file-drag";
import { useFileOperations } from "./use-file-operations";
import {
  filesKey,
  getFullPath,
  isDirectory,
  loadDirectory,
  stripArchiveExtension,
  type FileRow,
} from "./utils";

type FilesManagerProps = {
  serverId: string;
  slug: string;
  canWriteFiles: boolean;
  modpackInstalling?: boolean;
};

type FileDialog =
  | {
      type: "rename" | "copy" | "delete" | "unarchive" | "permissions";
      entry: FileRow;
    }
  | { type: "archive"; sources: string[]; name: string }
  | {
      type: "mass-move" | "mass-delete" | "create-directory" | "create-file";
    };

const NO_FILES: FileRow[] = [];

function useDiskUsage(serverId: string) {
  const [percent, setPercent] = useState<number | null>(null);

  useEffect(() => {
    const onDiskUsage = (event: Event) => {
      const { detail } = event as CustomEvent<DiskUsageEventDetail>;
      if (detail.serverId === serverId) {
        setPercent(detail.percent);
      }
    };

    window.addEventListener(DISK_USAGE_EVENT, onDiskUsage);

    return () => window.removeEventListener(DISK_USAGE_EVENT, onDiskUsage);
  }, [serverId]);

  return percent;
}

export function FilesManager({
  serverId,
  slug,
  canWriteFiles,
  modpackInstalling = false,
}: FilesManagerProps) {
  const { t } = useTranslation();
  const { mutate } = useSWRConfig();
  const storageLock = useServerTaskLock(serverId, "storage", "read");
  const filesBlocked = storageLock.locked || modpackInstalling;
  const diskUsagePercent = useDiskUsage(serverId);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [currentPath, setCurrentPath] = useState("/");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedNames, setSelectedNames] = useState<string[]>([]);
  const [dialog, setDialog] = useState<FileDialog | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const [listedServerId, setListedServerId] = useState(serverId);
  if (listedServerId !== serverId) {
    setListedServerId(serverId);
    setCurrentPath("/");
    setSearchQuery("");
    setSelectedNames([]);
  }

  const { data: files = NO_FILES, isLoading } = useSWR(
    filesKey(serverId, currentPath),
    () => loadDirectory(serverId, currentPath),
    {
      onError: () => {
        toast.error(t("servers-management:filesManager.toasts.loadFailed"));
      },
    },
  );

  const query = searchQuery.trim().toLowerCase();
  const visibleFiles = query
    ? files.filter((entry) => entry.name.toLowerCase().includes(query))
    : files;
  const selectedEntries = files.filter((entry) =>
    selectedNames.includes(entry.name),
  );
  const dialogEntry = dialog && "entry" in dialog ? dialog.entry : null;

  const navigate = (path: string) => {
    const normalized = normalizePath(path);
    if (normalized === currentPath) {
      return;
    }

    setCurrentPath(normalized);
    setSearchQuery("");
    setSelectedNames([]);
  };

  const reload = async (path = currentPath) => {
    const scrollY = window.scrollY;

    await mutate(filesKey(serverId, path));
    setSelectedNames([]);

    requestAnimationFrame(() => {
      window.scrollTo({ top: scrollY, behavior: "auto" });
    });
  };

  const closeDialog = () => setDialogOpen(false);

  const operations = useFileOperations({
    serverId,
    slug,
    currentPath,
    files,
    selectedEntries,
    canWriteFiles,
    modpackInstalling,
    storageLock,
    reload,
    onDone: closeDialog,
  });
  const {
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
    massMove,
    createFolder,
    createFile,
    download,
  } = operations;

  const openDialog = (next: FileDialog) => {
    setDialog(next);
    setDialogOpen(true);
  };

  const drag = useFileDrag({ busy, onUpload: uploadFiles, onMove: moveEntry });

  const openUploadPicker = () => {
    if (ensureWritable("noPermissionUpload")) {
      fileInputRef.current?.click();
    }
  };

  const onAction = (entry: FileRow, action: EntryAction) => {
    switch (action) {
      case "edit":
      case "view":
        openEditor(entry);
        return;
      case "archive":
        openDialog({
          type: "archive",
          sources: [getFullPath(currentPath, entry)],
          name: entry.name,
        });
        return;
      case "download":
        void download(entry);
        return;
      default:
        openDialog({ type: action, entry });
    }
  };

  const onOpenChange = (open: boolean) => {
    if (!open) {
      closeDialog();
    }
  };

  const toggleEntry = (entry: FileRow) => {
    setSelectedNames((previous) =>
      previous.includes(entry.name)
        ? previous.filter((name) => name !== entry.name)
        : [...previous, entry.name],
    );
  };

  const toggleAll = () => {
    setSelectedNames((previous) =>
      previous.length === visibleFiles.length
        ? []
        : visibleFiles.map((entry) => entry.name),
    );
  };

  const selectionDisabled = busy || !canWriteFiles || filesBlocked;
  const dialogProps = { busy, disabled: filesBlocked, onOpenChange };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-4">
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
          <PathBar
            key={currentPath}
            currentPath={currentPath}
            disabled={filesBlocked}
            drag={drag}
            onNavigate={navigate}
          />

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
            onClick={() => void reload()}
            disabled={filesBlocked}
          >
            <RefreshCcw className="size-4" />
            {t("common:actions.refresh")}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  disabled={selectionDisabled}
                />
              }
            >
              <Plus className="size-4" />
              <ChevronDown className="size-4 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={openUploadPicker}>
                <Upload className="size-4 text-muted-foreground" />
                {t("common:actions.upload")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => openDialog({ type: "create-file" })}
              >
                <FilePlus className="size-4 text-muted-foreground" />
                {t("servers-management:filesManager.newFileButton")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => openDialog({ type: "create-directory" })}
              >
                <FolderPlus className="size-4 text-muted-foreground" />
                {t("servers-management:filesManager.newFolderButton")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {filesBlocked ? (
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
            const selected = Array.from(event.target.files ?? []);
            event.target.value = "";
            void uploadFiles(selected);
          }}
        />
        <UploadProgressPanel
          tasks={uploads.tasks}
          onCancelTask={uploads.cancel}
          onCancelAll={uploads.cancelAll}
          onDismiss={uploads.dismiss}
        />
        <FilesTable
          currentPath={currentPath}
          entries={visibleFiles}
          hasFiles={files.length > 0}
          isLoading={isLoading}
          searchQuery={searchQuery}
          selectedNames={selectedNames}
          canWrite={canWriteFiles}
          actionsDisabled={filesBlocked}
          drag={drag}
          onToggleEntry={toggleEntry}
          onToggleAll={toggleAll}
          onOpenDirectory={navigate}
          onOpenFile={(entry) => {
            if (!drag.isClickSuppressed()) {
              openEditor(entry);
            }
          }}
          onAction={onAction}
        />

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
                disabled={selectionDisabled}
                onClick={() => openDialog({ type: "mass-move" })}
              >
                <FolderInput className="size-4" />
                {t("common:actions.move")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={selectionDisabled}
                onClick={() =>
                  openDialog({
                    type: "archive",
                    sources: selectedEntries.map((entry) =>
                      getFullPath(currentPath, entry),
                    ),
                    name:
                      currentPath === "/"
                        ? "archive"
                        : (currentPath.split("/").pop() ?? "archive"),
                  })
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
                disabled={selectionDisabled}
                onClick={() => openDialog({ type: "mass-delete" })}
              >
                <Trash2 className="size-4" />
                {t("common:actions.delete")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setSelectedNames([])}
              >
                <X className="size-4" />
                {t("servers-management:filesManager.selection.clear")}
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>

      <NameDialog
        {...dialogProps}
        open={dialogOpen && dialog?.type === "rename"}
        title={t("common:actions.rename")}
        description={t(
          "servers-management:filesManager.renameDialog.description",
          { name: dialogEntry?.name },
        )}
        submitLabel={t("common:actions.rename")}
        initialValue={dialogEntry?.name ?? ""}
        placeholder={t(
          "servers-management:filesManager.renameDialog.placeholder",
        )}
        onSubmit={(value) => dialogEntry && void rename(dialogEntry, value)}
      />

      <NameDialog
        {...dialogProps}
        open={dialogOpen && dialog?.type === "copy"}
        title={t("common:actions.copy")}
        description={t(
          "servers-management:filesManager.copyDialog.description",
          {
            name: dialogEntry?.name,
          },
        )}
        submitLabel={t("common:actions.copy")}
        initialValue={dialogEntry ? `${dialogEntry.name}.copy` : ""}
        placeholder={t(
          "servers-management:filesManager.copyDialog.placeholder",
        )}
        onSubmit={(value) => dialogEntry && void copy(dialogEntry, value)}
      />

      <NameDialog
        {...dialogProps}
        open={dialogOpen && dialog?.type === "unarchive"}
        title={t("servers-management:filesManager.unarchiveDialog.title")}
        description={t(
          "servers-management:filesManager.unarchiveDialog.description",
          { name: dialogEntry?.name },
        )}
        submitLabel={t(
          "servers-management:filesManager.unarchiveDialog.submitButton",
        )}
        initialValue={
          dialogEntry ? stripArchiveExtension(dialogEntry.name) : ""
        }
        placeholder={t(
          "servers-management:filesManager.unarchiveDialog.placeholder",
        )}
        onSubmit={(value) => dialogEntry && void unarchive(dialogEntry, value)}
      />

      <NameDialog
        {...dialogProps}
        open={dialogOpen && dialog?.type === "mass-move"}
        title={t("servers-management:filesManager.massMoveDialog.title")}
        description={t(
          "servers-management:filesManager.massMoveDialog.description",
          { count: selectedNames.length },
        )}
        submitLabel={t("common:actions.move")}
        initialValue={currentPath}
        placeholder={t(
          "servers-management:filesManager.massMoveDialog.placeholder",
        )}
        onSubmit={(value) => void massMove(value)}
      />

      <NameDialog
        {...dialogProps}
        open={dialogOpen && dialog?.type === "create-directory"}
        title={t("servers-management:filesManager.createDirectoryDialog.title")}
        description={t(
          "servers-management:filesManager.createDirectoryDialog.description",
          { path: currentPath },
        )}
        submitLabel={t("common:actions.create")}
        initialValue=""
        placeholder={t(
          "servers-management:filesManager.createDirectoryDialog.placeholder",
        )}
        onSubmit={(value) => void createFolder(value)}
      />

      <NameDialog
        {...dialogProps}
        open={dialogOpen && dialog?.type === "create-file"}
        title={t("servers-management:filesManager.createFileDialog.title")}
        description={t(
          "servers-management:filesManager.createFileDialog.description",
          { path: currentPath },
        )}
        submitLabel={t("common:actions.create")}
        initialValue=""
        placeholder={t(
          "servers-management:filesManager.createFileDialog.placeholder",
        )}
        onSubmit={(value) => void createFile(value)}
      />

      <ArchiveDialog
        {...dialogProps}
        open={dialogOpen && dialog?.type === "archive"}
        sources={dialog?.type === "archive" ? dialog.sources : []}
        initialName={dialog?.type === "archive" ? `${dialog.name}.tar.zst` : ""}
        onSubmit={(name, compression) =>
          dialog?.type === "archive" &&
          void archive(dialog.sources, name, compression)
        }
      />

      <PermissionsDialog
        {...dialogProps}
        disabled={!canWriteFiles || filesBlocked}
        open={dialogOpen && dialog?.type === "permissions"}
        entry={dialog?.type === "permissions" ? dialog.entry : null}
        onSubmit={(input) =>
          dialogEntry && void updatePermissions(dialogEntry, input)
        }
      />

      <ConfirmDeleteDialog
        {...dialogProps}
        open={dialogOpen && dialog?.type === "delete"}
        title={t("servers-management:filesManager.deleteDialog.title")}
        description={t(
          "servers-management:filesManager.deleteDialog.description",
          {
            name: dialogEntry?.name,
            recursiveSuffix:
              dialogEntry && isDirectory(dialogEntry)
                ? t(
                    "servers-management:filesManager.deleteDialog.recursiveSuffix",
                  )
                : "",
          },
        )}
        onConfirm={() => dialogEntry && void remove(dialogEntry)}
      />

      <ConfirmDeleteDialog
        {...dialogProps}
        open={dialogOpen && dialog?.type === "mass-delete"}
        title={t("servers-management:filesManager.massDeleteDialog.title")}
        description={t(
          "servers-management:filesManager.massDeleteDialog.description",
          { count: selectedNames.length },
        )}
        onConfirm={() => void massDelete()}
      />
    </Card>
  );
}
