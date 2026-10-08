import { useRef, useState, type DragEvent } from "react";
import { normalizePath } from "@/lib/files";
import type { FileRow } from "./utils";

function hasDraggedFiles(event: DragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer.types).includes("Files");
}

function droppedFiles(event: DragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer.files ?? []);
}

export function useFileDrag({
  busy,
  onUpload,
  onMove,
}: {
  busy: boolean;
  onUpload: (files: File[], directory?: string) => Promise<void>;
  onMove: (entry: FileRow, directory: string) => Promise<void>;
}) {
  const [draggedEntry, setDraggedEntry] = useState<FileRow | null>(null);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const [isFileDropActive, setIsFileDropActive] = useState(false);
  const suppressClickRef = useRef(false);

  const entryProps = (entry: FileRow) => ({
    draggable: true,
    onDragStart: (event: DragEvent<HTMLElement>) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", entry.name);
      setDraggedEntry(entry);
    },
    onDragEnd: () => {
      suppressClickRef.current = true;
      setDraggedEntry(null);
      setDropTargetPath(null);

      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    },
  });

  const targetProps = (path: string) => {
    const target = normalizePath(path);

    return {
      onDragOver: (event: DragEvent<HTMLElement>) => {
        const fileDrag = hasDraggedFiles(event);
        if ((!draggedEntry && !fileDrag) || busy) {
          return;
        }

        event.preventDefault();
        event.dataTransfer.dropEffect = fileDrag ? "copy" : "move";
        setDropTargetPath(target);
      },
      onDragLeave: () => {
        setDropTargetPath((current) => (current === target ? null : current));
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        event.preventDefault();
        event.stopPropagation();
        setDropTargetPath(null);

        if (hasDraggedFiles(event) && !draggedEntry) {
          void onUpload(droppedFiles(event), target);
          return;
        }

        const entry = draggedEntry;
        setDraggedEntry(null);

        if (entry && !busy) {
          void onMove(entry, target);
        }
      },
    };
  };

  const isExternalFileDrag = (event: DragEvent<HTMLElement>) =>
    hasDraggedFiles(event) && !draggedEntry;

  const managerProps = {
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!isExternalFileDrag(event)) {
        return;
      }

      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setIsFileDropActive(true);
    },
    onDragLeave: () => setIsFileDropActive(false),
    onDrop: (event: DragEvent<HTMLElement>) => {
      if (!isExternalFileDrag(event)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setIsFileDropActive(false);
      void onUpload(droppedFiles(event));
    },
  };

  return {
    dropTargetPath,
    isFileDropActive,
    entryProps,
    targetProps,
    managerProps,
    isClickSuppressed: () => suppressClickRef.current,
  };
}

export type FileDrag = ReturnType<typeof useFileDrag>;
