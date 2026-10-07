import { useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

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
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ARCHIVE_COMPRESSIONS,
  formatMode,
  formatSymbolicMode,
  withArchiveExtension,
  type ArchiveCompression,
  type FileRow,
} from "./utils";

type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  disabled: boolean;
};

function DialogForm({
  title,
  description,
  submitLabel,
  busy,
  disabled,
  onCancel,
  onSubmit,
  children,
}: {
  title: string;
  description: ReactNode;
  submitLabel: string;
  busy: boolean;
  disabled: boolean;
  onCancel: () => void;
  onSubmit: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <form onSubmit={submit} className="contents">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      {children}
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={busy}
        >
          {t("common:actions.cancel")}
        </Button>
        <Button type="submit" loading={busy} disabled={disabled}>
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

function NameForm({
  initialValue,
  placeholder,
  onSubmit,
  ...props
}: Omit<DialogProps, "open" | "onOpenChange"> & {
  title: string;
  description: ReactNode;
  submitLabel: string;
  initialValue: string;
  placeholder: string;
  onCancel: () => void;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState(initialValue);

  return (
    <DialogForm {...props} onSubmit={() => onSubmit(value)}>
      <Input
        autoFocus
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
      />
    </DialogForm>
  );
}

export function NameDialog({
  open,
  onOpenChange,
  ...props
}: DialogProps & {
  title: string;
  description: ReactNode;
  submitLabel: string;
  initialValue: string;
  placeholder: string;
  onSubmit: (value: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <NameForm {...props} onCancel={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function ArchiveForm({
  sources,
  initialName,
  onSubmit,
  ...props
}: Omit<DialogProps, "open" | "onOpenChange"> & {
  sources: string[];
  initialName: string;
  onCancel: () => void;
  onSubmit: (name: string, compression: ArchiveCompression) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName);
  const [compression, setCompression] = useState<ArchiveCompression>("zstd");
  const options = ARCHIVE_COMPRESSIONS.map((value) => ({
    value,
    label: t(
      `servers-management:filesManager.archiveDialog.compressionOptions.${value}`,
    ),
  }));

  return (
    <DialogForm
      {...props}
      title={t("servers-management:filesManager.archiveDialog.title")}
      description={t(
        "servers-management:filesManager.archiveDialog.description",
        { count: sources.length },
      )}
      submitLabel={t("common:resources.archive")}
      onSubmit={() => onSubmit(name, compression)}
    >
      <div className="max-h-40 overflow-y-auto rounded-md border bg-muted/40 p-2">
        <ul className="flex flex-col gap-1 font-mono text-xs text-muted-foreground">
          {sources.map((source) => (
            <li key={source}>{source}</li>
          ))}
        </ul>
      </div>
      <Input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder={t(
          "servers-management:filesManager.archiveDialog.namePlaceholder",
        )}
      />
      <Field>
        <FieldLabel htmlFor="archive-compression">
          {t("servers-management:filesManager.archiveDialog.compressionLabel")}
        </FieldLabel>
        <Select
          items={options}
          value={compression}
          onValueChange={(value) => {
            if (!value) {
              return;
            }

            setCompression(value);
            setName((previous) => withArchiveExtension(previous, value));
          }}
        >
          <SelectTrigger id="archive-compression">
            <SelectValue
              placeholder={t(
                "servers-management:filesManager.archiveDialog.compressionPlaceholder",
              )}
            />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </DialogForm>
  );
}

export function ArchiveDialog({
  open,
  onOpenChange,
  ...props
}: DialogProps & {
  sources: string[];
  initialName: string;
  onSubmit: (name: string, compression: ArchiveCompression) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <ArchiveForm {...props} onCancel={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

export type PermissionsInput = { mode: string; uid: string; gid: string };

function PermissionsForm({
  entry,
  onSubmit,
  ...props
}: Omit<DialogProps, "open" | "onOpenChange"> & {
  entry: FileRow;
  onCancel: () => void;
  onSubmit: (input: PermissionsInput) => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState(formatMode(entry.mode));
  const [uid, setUid] = useState(String(entry.uid));
  const [gid, setGid] = useState(String(entry.gid));
  const validMode = /^[0-7]{3,4}$/.test(mode.trim());

  return (
    <DialogForm
      {...props}
      title={t("servers-management:filesManager.permissionsDialog.title")}
      description={t(
        "servers-management:filesManager.permissionsDialog.description",
        { name: entry.name },
      )}
      submitLabel={t("common:actions.save")}
      onSubmit={() => onSubmit({ mode, uid, gid })}
    >
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor="permissions-mode">
            {t("servers-management:filesManager.permissionsDialog.modeLabel")}
          </FieldLabel>
          <Input
            id="permissions-mode"
            value={mode}
            onChange={(event) => setMode(event.target.value)}
            className="font-mono"
            placeholder="0644"
            disabled={props.disabled}
          />
          <p className="font-mono text-xs text-muted-foreground">
            {validMode
              ? formatSymbolicMode(Number.parseInt(mode.trim(), 8))
              : t("servers-management:filesManager.permissionsDialog.modeHint")}
          </p>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field>
            <FieldLabel htmlFor="permissions-uid">
              {t("servers-management:filesManager.permissionsDialog.uidLabel")}
            </FieldLabel>
            <Input
              id="permissions-uid"
              value={uid}
              onChange={(event) => setUid(event.target.value)}
              inputMode="numeric"
              disabled={props.disabled}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="permissions-gid">
              {t("servers-management:filesManager.permissionsDialog.gidLabel")}
            </FieldLabel>
            <Input
              id="permissions-gid"
              value={gid}
              onChange={(event) => setGid(event.target.value)}
              inputMode="numeric"
              disabled={props.disabled}
            />
          </Field>
        </div>
      </FieldGroup>
    </DialogForm>
  );
}

export function PermissionsDialog({
  open,
  onOpenChange,
  entry,
  ...props
}: DialogProps & {
  entry: FileRow | null;
  onSubmit: (input: PermissionsInput) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {entry ? (
          <PermissionsForm
            {...props}
            entry={entry}
            onCancel={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  busy,
  disabled,
  title,
  description,
  onConfirm,
}: DialogProps & {
  title: string;
  description: string;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            {description} {t("common:confirmDelete.cannotBeUndone")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>
            {t("common:actions.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={onConfirm}
            disabled={busy || disabled}
          >
            {t("common:actions.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
