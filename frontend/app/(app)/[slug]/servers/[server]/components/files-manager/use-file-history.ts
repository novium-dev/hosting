import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { copyFile, createDirectory, deleteFile, renameFile } from "@/lib/api";
import { apiErrorMessage } from "@/lib/api-error";

export type UndoableAction =
  | { type: "rename"; from: string; to: string; label: string }
  | { type: "copy"; from: string; to: string; label: string }
  | { type: "create-directory"; path: string; label: string };

type Direction = "undo" | "redo";

const FAILED_KEYS: Record<UndoableAction["type"], Record<Direction, string>> = {
  rename: {
    undo: "servers-management:filesManager.toasts.undoFailedRename",
    redo: "servers-management:filesManager.toasts.redoFailedRename",
  },
  copy: {
    undo: "servers-management:filesManager.toasts.undoFailedCopy",
    redo: "servers-management:filesManager.toasts.redoFailedCopy",
  },
  "create-directory": {
    undo: "servers-management:filesManager.toasts.undoFailedCreate",
    redo: "servers-management:filesManager.toasts.redoFailedCreate",
  },
};

async function replay(
  serverId: string,
  action: UndoableAction,
  direction: Direction,
): Promise<unknown> {
  const path = { server_id: serverId };

  switch (action.type) {
    case "rename": {
      const [from, to] =
        direction === "undo"
          ? [action.to, action.from]
          : [action.from, action.to];
      return (await renameFile({ path, query: { from, to } })).error;
    }
    case "copy":
      return direction === "undo"
        ? (
            await deleteFile({
              path,
              query: { file: action.to, recursive: true },
            })
          ).error
        : (
            await copyFile({
              path,
              query: { from: action.from, to: action.to },
            })
          ).error;
    case "create-directory":
      return direction === "undo"
        ? (
            await deleteFile({
              path,
              query: { file: action.path, recursive: true },
            })
          ).error
        : (
            await createDirectory({
              path,
              query: { file: action.path, recursive: false },
            })
          ).error;
  }
}

function isTextInput(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable)
  );
}

export function useFileHistory(
  serverId: string,
  onApplied: () => Promise<void>,
) {
  const { t } = useTranslation();
  const undoStack = useRef<UndoableAction[]>([]);
  const redoStack = useRef<UndoableAction[]>([]);
  const [isApplying, setIsApplying] = useState(false);

  const record = (action: UndoableAction) => {
    undoStack.current.push(action);
    redoStack.current = [];
  };

  const apply = async (direction: Direction) => {
    const source = direction === "undo" ? undoStack : redoStack;
    const target = direction === "undo" ? redoStack : undoStack;
    const action = source.current.pop();

    if (!action) {
      toast.info(
        t(
          direction === "undo"
            ? "servers-management:filesManager.toasts.nothingToUndo"
            : "servers-management:filesManager.toasts.nothingToRedo",
        ),
      );
      return;
    }

    setIsApplying(true);

    try {
      const error = await replay(serverId, action, direction);

      if (error) {
        source.current.push(action);
        toast.error(
          apiErrorMessage(error, t(FAILED_KEYS[action.type][direction])),
        );
        return;
      }

      target.current.push(action);
      toast.success(
        t(
          direction === "undo"
            ? "servers-management:filesManager.toasts.undid"
            : "servers-management:filesManager.toasts.redid",
          { label: action.label },
        ),
      );
      await onApplied();
    } finally {
      setIsApplying(false);
    }
  };

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (!(event.ctrlKey || event.metaKey) || isTextInput(event.target)) {
      return;
    }

    const key = event.key.toLowerCase();

    if (key === "z" && !event.shiftKey) {
      event.preventDefault();
      void apply("undo");
    } else if (key === "y" || (key === "z" && event.shiftKey)) {
      event.preventDefault();
      void apply("redo");
    }
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener("keydown", listener);

    return () => window.removeEventListener("keydown", listener);
  }, []);

  return { record, isApplying };
}
