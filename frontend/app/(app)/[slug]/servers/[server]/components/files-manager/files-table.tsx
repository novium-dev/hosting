import { File, Folder, Loader2, MoreHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";
import { EntryActionItems, type EntryAction } from "./entry-actions";
import type { FileDrag } from "./use-file-drag";
import {
  formatBytes,
  formatMode,
  getFullPath,
  isDirectory,
  type FileRow,
} from "./utils";

export function FilesTable({
  currentPath,
  entries,
  hasFiles,
  isLoading,
  searchQuery,
  selectedNames,
  canWrite,
  actionsDisabled,
  drag,
  onToggleEntry,
  onToggleAll,
  onOpenDirectory,
  onOpenFile,
  onAction,
}: {
  currentPath: string;
  entries: FileRow[];
  hasFiles: boolean;
  isLoading: boolean;
  searchQuery: string;
  selectedNames: string[];
  canWrite: boolean;
  actionsDisabled: boolean;
  drag: FileDrag;
  onToggleEntry: (entry: FileRow) => void;
  onToggleAll: () => void;
  onOpenDirectory: (path: string) => void;
  onOpenFile: (entry: FileRow) => void;
  onAction: (entry: FileRow, action: EntryAction) => void;
}) {
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {t("servers-management:filesManager.loadingFiles")}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div
        {...drag.managerProps}
        className={cn(
          "rounded-lg border border-dashed p-8 text-center transition-colors",
          drag.isFileDropActive && "border-primary bg-primary/5",
        )}
      >
        <p className="text-sm text-muted-foreground">
          {hasFiles
            ? t("servers-management:filesManager.emptyState.noMatches", {
                query: searchQuery.trim(),
              })
            : t("servers-management:filesManager.emptyState.title")}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          {hasFiles
            ? t("servers-management:filesManager.emptyState.noMatchesHint")
            : t("servers-management:filesManager.emptyState.hint")}
        </p>
      </div>
    );
  }

  const allSelected = selectedNames.length === entries.length;

  return (
    <div
      {...drag.managerProps}
      className={cn(
        "overflow-hidden rounded-lg border transition-colors",
        drag.isFileDropActive && "border-primary bg-primary/5",
      )}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                checked={allSelected}
                indeterminate={!allSelected && selectedNames.length > 0}
                onCheckedChange={onToggleAll}
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
          {entries.map((entry) => {
            const directory = isDirectory(entry);
            const path = getFullPath(currentPath, entry);
            const Icon = directory ? Folder : File;

            return (
              <ContextMenu
                key={entry.relative_path || `${entry.name}-${entry.mode}`}
              >
                <ContextMenuTrigger
                  render={
                    <TableRow
                      className={cn(
                        directory &&
                          drag.dropTargetPath === path &&
                          "bg-primary/5",
                      )}
                      {...(directory ? drag.targetProps(path) : {})}
                    />
                  }
                >
                  <TableCell>
                    <Checkbox
                      checked={selectedNames.includes(entry.name)}
                      onCheckedChange={() => onToggleEntry(entry)}
                      aria-label={t(
                        "servers-management:filesManager.selection.selectEntry",
                        { name: entry.name },
                      )}
                    />
                  </TableCell>
                  <TableCell>
                    <button
                      type="button"
                      {...drag.entryProps(entry)}
                      onClick={() =>
                        directory ? onOpenDirectory(path) : onOpenFile(entry)
                      }
                      className={cn(
                        "inline-flex cursor-grab items-center gap-2 hover:text-primary active:cursor-grabbing",
                        directory && "font-medium",
                      )}
                    >
                      <Icon className="size-4" />
                      {entry.name}
                    </button>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {directory
                      ? "-"
                      : formatBytes(entry.size, t("common:status.unknown"))}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {formatMode(entry.mode)}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button type="button" size="sm" variant="ghost" />
                        }
                      >
                        <MoreHorizontal className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <EntryActionItems
                          entry={entry}
                          canWrite={canWrite}
                          disabled={actionsDisabled}
                          item={DropdownMenuItem}
                          onAction={onAction}
                        />
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-44">
                  <EntryActionItems
                    entry={entry}
                    canWrite={canWrite}
                    disabled={actionsDisabled}
                    item={ContextMenuItem}
                    onAction={onAction}
                  />
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
