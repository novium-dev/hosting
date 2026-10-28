import { useState, type ReactNode } from "react";
import { ArrowUp, ChevronRight, Folder, Home, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useServerFiles } from "@/hooks/use-shared-queries";
import { cn } from "@/lib/utils";
import { useFilesWatch } from "./use-files-watch";
import {
  buildPathSegments,
  isDirectory,
  joinPath,
  type WatchedDirectory,
} from "./utils";

type FolderPickerProps = {
  serverId: string;
  busy: boolean;
  disabled: boolean;
  title: string;
  description: ReactNode;
  submitLabel: string;
  initialPath: string;
  onSubmit: (directory: string, target: WatchedDirectory) => void;
};

function FolderPicker({
  serverId,
  busy,
  disabled,
  title,
  description,
  submitLabel,
  initialPath,
  onSubmit,
  onCancel,
}: FolderPickerProps & { onCancel: () => void }) {
  const { t } = useTranslation();
  const [path, setPath] = useState(initialPath);
  const segments = buildPathSegments(path);

  const { data: files, isLoading, error } = useServerFiles(serverId, path);
  const directories = (files ?? []).filter(isDirectory);

  // A second watch, so the chosen target is referenced by its own token.
  const watched = useFilesWatch({
    serverId,
    path,
    enabled: true,
    hold: busy,
    onPathChange: setPath,
  });

  const parent = segments.at(-2)?.path ?? "/";

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>

      <div className="flex min-w-0 items-center gap-1 rounded-md border px-1 text-sm">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={t("servers-management:filesManager.goToRoot")}
          title={t("servers-management:filesManager.goToRoot")}
          disabled={busy}
          onClick={() => setPath("/")}
        >
          <Home className="size-4" />
        </Button>
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto py-1">
          {segments.map((segment, index) => (
            <span key={segment.path} className="inline-flex items-center gap-1">
              <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
              <button
                type="button"
                disabled={busy}
                onClick={() => setPath(segment.path)}
                className={cn(
                  "truncate rounded px-1 py-0.5 hover:text-foreground",
                  index === segments.length - 1
                    ? "font-medium text-foreground"
                    : "text-muted-foreground",
                )}
              >
                {segment.label}
              </button>
            </span>
          ))}
        </div>
      </div>

      <ScrollArea className="h-64 rounded-md border">
        <div className="flex flex-col p-1">
          {path !== "/" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => setPath(parent)}
              className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ArrowUp className="size-4 shrink-0" />
              {t("servers-management:filesManager.folderPicker.parent")}
            </button>
          ) : null}
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
            </div>
          ) : error ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t("servers-management:filesManager.toasts.loadFailed")}
            </p>
          ) : directories.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t("servers-management:filesManager.folderPicker.empty")}
            </p>
          ) : (
            directories.map((entry) => (
              <button
                key={entry.name}
                type="button"
                disabled={busy}
                onClick={() => setPath(joinPath(path, entry.name))}
                className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
              >
                <Folder className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{entry.name}</span>
              </button>
            ))
          )}
        </div>
      </ScrollArea>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={busy}
        >
          {t("common:actions.cancel")}
        </Button>
        <Button
          type="button"
          loading={busy}
          disabled={disabled || Boolean(error)}
          onClick={() => onSubmit(path, watched)}
        >
          {submitLabel}
        </Button>
      </DialogFooter>
    </>
  );
}

export function FolderPickerDialog({
  open,
  onOpenChange,
  ...props
}: FolderPickerProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <FolderPicker {...props} onCancel={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
