import type { ComponentType, ReactNode } from "react";
import {
  Archive,
  Copy,
  Download,
  FolderInput,
  Pencil,
  Shield,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { getEntryKind, type FileRow } from "./utils";

export type EntryAction =
  | "edit"
  | "view"
  | "rename"
  | "permissions"
  | "archive"
  | "unarchive"
  | "download"
  | "copy"
  | "delete";

type ActionMenuItem = ComponentType<{
  children?: ReactNode;
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
}>;

const ACTIONS: Record<EntryAction, { icon: LucideIcon; label: string }> = {
  edit: { icon: Pencil, label: "common:actions.edit" },
  view: {
    icon: Pencil,
    label: "servers-management:filesManager.contextMenu.view",
  },
  rename: { icon: Pencil, label: "common:actions.rename" },
  permissions: {
    icon: Shield,
    label: "servers-management:filesManager.contextMenu.permissions",
  },
  archive: { icon: Archive, label: "common:resources.archive" },
  unarchive: {
    icon: FolderInput,
    label: "servers-management:filesManager.contextMenu.unarchive",
  },
  download: { icon: Download, label: "common:actions.download" },
  copy: { icon: Copy, label: "common:actions.copy" },
  delete: { icon: Trash2, label: "common:actions.delete" },
};

function actionsFor(entry: FileRow, canWrite: boolean): EntryAction[] {
  switch (getEntryKind(entry)) {
    case "directory":
      return canWrite
        ? ["rename", "permissions", "archive", "delete"]
        : ["permissions"];
    case "archive":
      return canWrite
        ? [
            "rename",
            "permissions",
            "unarchive",
            "archive",
            "download",
            "copy",
            "delete",
          ]
        : ["permissions", "download"];
    case "file":
      return canWrite
        ? [
            "edit",
            "rename",
            "permissions",
            "archive",
            "download",
            "copy",
            "delete",
          ]
        : ["view", "permissions", "download"];
  }
}

export function EntryActionItems({
  entry,
  canWrite,
  disabled,
  item: Item,
  onAction,
}: {
  entry: FileRow;
  canWrite: boolean;
  disabled: boolean;
  item: ActionMenuItem;
  onAction: (entry: FileRow, action: EntryAction) => void;
}) {
  const { t } = useTranslation();

  return actionsFor(entry, canWrite).map((action) => {
    const { icon: Icon, label } = ACTIONS[action];
    const destructive = action === "delete";

    return (
      <Item
        key={action}
        disabled={disabled}
        onClick={() => onAction(entry, action)}
        className={
          destructive ? "text-destructive focus:text-destructive" : undefined
        }
      >
        <Icon
          className={cn(
            "size-4",
            destructive ? "text-destructive" : "text-muted-foreground",
          )}
        />
        {t(label)}
      </Item>
    );
  });
}
