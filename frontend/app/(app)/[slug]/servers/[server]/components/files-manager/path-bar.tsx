import { useState } from "react";
import { ChevronRight, Home } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { FileDrag } from "./use-file-drag";
import { buildPathSegments } from "./utils";

function PathInput({
  initialPath,
  onSubmit,
  onCancel,
}: {
  initialPath: string;
  onSubmit: (path: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialPath);

  return (
    <Input
      autoFocus
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={onCancel}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onSubmit(value);
        }

        if (event.key === "Escape") {
          onCancel();
        }
      }}
      className="h-7 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
      placeholder={t("servers-management:filesManager.pathInputPlaceholder")}
    />
  );
}

export function PathBar({
  currentPath,
  disabled,
  drag,
  onNavigate,
}: {
  currentPath: string;
  disabled: boolean;
  drag: FileDrag;
  onNavigate: (path: string) => void;
}) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const segments = buildPathSegments(currentPath);

  return (
    <div className="flex h-9 min-w-64 flex-1 items-center gap-1 rounded-md border bg-transparent px-1 text-sm">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn(
          "size-7 shrink-0 text-muted-foreground hover:text-foreground",
          drag.dropTargetPath === "/" && "bg-primary/10 text-primary",
        )}
        aria-label={t("servers-management:filesManager.goToRoot")}
        title={t("servers-management:filesManager.goToRoot")}
        disabled={disabled}
        onClick={() => onNavigate("/")}
        {...drag.targetProps("/")}
      >
        <Home className="size-4" />
      </Button>
      {isEditing ? (
        <PathInput
          initialPath={currentPath}
          onSubmit={(path) => {
            setIsEditing(false);
            onNavigate(path);
          }}
          onCancel={() => setIsEditing(false)}
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
                  onClick={() => onNavigate(segment.path)}
                  {...drag.targetProps(segment.path)}
                  className={cn(
                    "truncate rounded px-1 py-0.5 hover:text-foreground",
                    drag.dropTargetPath === segment.path
                      ? "bg-primary/10 text-primary"
                      : index === segments.length - 1
                        ? "font-medium text-foreground"
                        : "text-muted-foreground",
                  )}
                >
                  {segment.label}
                </button>
              </span>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            disabled={disabled}
            aria-label={t("servers-management:filesManager.editPath")}
            title={t("servers-management:filesManager.editPath")}
            className="h-7 flex-1 cursor-text rounded"
          />
        </>
      )}
    </div>
  );
}
