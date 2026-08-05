import type { EditorProps } from "@monaco-editor/react";
import Link from "@/components/link";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Download,
  FileArchive,
  FileCode,
  ImageIcon,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { downloadUser, statFile, uploadUser } from "@/lib/api";
import { FileMode, modeToType } from "@/lib/files";

type FileEditorProps = {
  serverId: string;
  slug: string;
  path: string | null;
  canWriteFiles: boolean;
};

type EditorMode = "loading" | "empty" | "archive" | "directory" | "image" | "text";

const LazyMonaco = lazy(() => import("@monaco-editor/react"));

function MonacoEditor(props: EditorProps) {
  const { t } = useTranslation();

  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {t("servers:fileEditor.loadingEditor")}
        </div>
      }
    >
      <LazyMonaco {...props} />
    </Suspense>
  );
}

function normalizePath(input: string) {
  const trimmed = input.trim();
  if (!trimmed || trimmed === "/") {
    return "/";
  }

  const cleaned = trimmed.replace(/\/+/g, "/").replace(/\/$/, "");
  return cleaned.startsWith("/") ? cleaned : `/${cleaned}`;
}

function getFileName(path: string) {
  return path.split("/").filter(Boolean).pop() ?? path;
}

function getLanguageFromFileName(fileName: string) {
  const extension = fileName.split(".").pop()?.toLowerCase();

  switch (extension) {
    case "c":
    case "h":
      return "c";
    case "cpp":
    case "cc":
    case "cxx":
    case "hpp":
      return "cpp";
    case "cs":
      return "csharp";
    case "css":
      return "css";
    case "dockerfile":
      return "dockerfile";
    case "go":
      return "go";
    case "html":
    case "htm":
      return "html";
    case "java":
      return "java";
    case "js":
    case "cjs":
    case "mjs":
      return "javascript";
    case "json":
      return "json";
    case "jsx":
      return "javascript";
    case "kt":
    case "kts":
      return "kotlin";
    case "lua":
      return "lua";
    case "md":
    case "markdown":
      return "markdown";
    case "php":
      return "php";
    case "py":
      return "python";
    case "rb":
      return "ruby";
    case "rs":
      return "rust";
    case "sh":
    case "bash":
    case "zsh":
      return "shell";
    case "sql":
      return "sql";
    case "toml":
      return "toml";
    case "ts":
    case "tsx":
      return "typescript";
    case "xml":
      return "xml";
    case "yaml":
    case "yml":
      return "yaml";
    default:
      return "plaintext";
  }
}

function isImageFile(fileName: string) {
  return /\.(apng|avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i.test(fileName);
}

function formatBytes(bytes: number | null, unknownLabel: string) {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) {
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

export function FileEditor({
  serverId,
  slug,
  path,
  canWriteFiles,
}: FileEditorProps) {
  const { t } = useTranslation();
  const normalizedPath = useMemo(() => (path ? normalizePath(path) : ""), [path]);
  const fileName = useMemo(
    () =>
      normalizedPath
        ? getFileName(normalizedPath)
        : t("servers:fileEditor.defaultTitle"),
    [normalizedPath, t],
  );
  const language = useMemo(() => getLanguageFromFileName(fileName), [fileName]);
  const filesHref = `/${slug}/servers/${serverId}/files`;

  const [mode, setMode] = useState<EditorMode>(path ? "loading" : "empty");
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [size, setSize] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const hasUnsavedChanges = content !== savedContent;

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!normalizedPath) {
        setMode("empty");
        return;
      }

      setMode("loading");
      setDownloadUrl(null);
      setContent("");
      setSavedContent("");
      setSize(null);

      try {
        const statResponse = await statFile({
          path: { server_id: serverId },
          query: { file: normalizedPath },
        });

        if (statResponse.error || !statResponse.data) {
          toast.error(
            statResponse.error?.error?.msg ??
              t("servers:fileEditor.toasts.inspectFailed"),
          );
          setMode("empty");
          return;
        }

        if (cancelled) {
          return;
        }

        setSize(statResponse.data.size);

        if (modeToType(statResponse.data.mode) === FileMode.DIR) {
          setMode("directory");
          return;
        }

        if (statResponse.data.archive) {
          const downloadResponse = await downloadUser({
            path: { server_id: serverId },
            query: { file: normalizedPath },
          });

          if (!downloadResponse.error && downloadResponse.data?.url) {
            setDownloadUrl(downloadResponse.data.url);
          }

          setMode("archive");
          return;
        }

        const downloadResponse = await downloadUser({
          path: { server_id: serverId },
          query: { file: normalizedPath },
        });

        if (downloadResponse.error || !downloadResponse.data?.url) {
          toast.error(
            downloadResponse.error?.error?.msg ??
              t("servers:fileEditor.toasts.downloadUrlFailed"),
          );
          setMode("empty");
          return;
        }

        if (cancelled) {
          return;
        }

        setDownloadUrl(downloadResponse.data.url);

        if (isImageFile(fileName)) {
          setMode("image");
          return;
        }

        const fileResponse = await fetch(downloadResponse.data.url);

        if (!fileResponse.ok) {
          throw new Error("Download URL request failed");
        }

        const nextContent = await fileResponse.text();

        if (cancelled) {
          return;
        }

        setContent(nextContent);
        setSavedContent(nextContent);
        setMode("text");
      } catch {
        if (!cancelled) {
          toast.error(t("servers:fileEditor.toasts.loadFailed"));
          setMode("empty");
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [fileName, normalizedPath, serverId, t]);

  const saveFile = async () => {
    if (!canWriteFiles || !normalizedPath || mode !== "text") {
      return;
    }

    setIsSaving(true);

    try {
      const uploadUrlResponse = await uploadUser({
        path: { server_id: serverId },
        query: { file: normalizedPath },
      });

      if (uploadUrlResponse.error || !uploadUrlResponse.data?.url) {
        toast.error(
          uploadUrlResponse.error?.error?.msg ??
            t("servers:fileEditor.toasts.uploadUrlFailed"),
        );
        return;
      }

      const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
      const putUpload = await fetch(uploadUrlResponse.data.url, {
        method: "PUT",
        body: blob,
        headers: { "Content-Type": "text/plain;charset=utf-8" },
      });

      if (!putUpload.ok) {
        const formData = new FormData();
        formData.append("file", blob, fileName);

        const postUpload = await fetch(uploadUrlResponse.data.url, {
          method: "POST",
          body: formData,
        });

        if (!postUpload.ok) {
          throw new Error("Upload URL request failed");
        }
      }

      setSavedContent(content);
      toast.success(t("servers:fileEditor.toasts.saveSuccess"));
    } catch {
      toast.error(t("servers:fileEditor.toasts.saveFailed"));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              {mode === "image" ? (
                <ImageIcon className="size-4" />
              ) : mode === "archive" ? (
                <FileArchive className="size-4" />
              ) : (
                <FileCode className="size-4" />
              )}
              <span className="truncate">{fileName}</span>
            </CardTitle>
            <CardDescription className="truncate">
              {normalizedPath || t("servers:fileEditor.defaultDescription")}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {normalizedPath ? (
              <Badge variant="secondary">
                {formatBytes(size, t("common:status.unknown"))}
              </Badge>
            ) : null}
            <Button asChild type="button" variant="outline">
              <Link href={filesHref}>{t("servers:fileEditor.backToFiles")}</Link>
            </Button>
            {downloadUrl ? (
              <Button asChild type="button" variant="outline">
                <a href={downloadUrl} target="_blank" rel="noreferrer">
                  <Download className="size-4" />
                  {t("common:actions.download")}
                </a>
              </Button>
            ) : null}
            <Button
              type="button"
              onClick={() => {
                void saveFile();
              }}
              disabled={
                !canWriteFiles ||
                mode !== "text" ||
                !hasUnsavedChanges ||
                isSaving
              }
              loading={isSaving}
            >
              {t("common:actions.save")}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {mode === "loading" ? (
          <div className="flex h-[68vh] items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t("servers:fileEditor.loadingFile")}
          </div>
        ) : mode === "empty" ? (
          <div className="p-6">
            <Alert>
              <AlertTriangle className="size-4" />
              <AlertTitle>{t("servers:fileEditor.noFileSelected.title")}</AlertTitle>
              <AlertDescription>
                {t("servers:fileEditor.noFileSelected.description")}
              </AlertDescription>
            </Alert>
          </div>
        ) : mode === "directory" ? (
          <div className="p-6">
            <Alert>
              <AlertTriangle className="size-4" />
              <AlertTitle>
                {t("servers:fileEditor.directorySelected.title")}
              </AlertTitle>
              <AlertDescription>
                {t("servers:fileEditor.directorySelected.description")}
              </AlertDescription>
            </Alert>
          </div>
        ) : mode === "archive" ? (
          <div className="p-6">
            <Alert>
              <FileArchive className="size-4" />
              <AlertTitle>
                {t("servers:fileEditor.archiveDisabled.title")}
              </AlertTitle>
              <AlertDescription>
                {t("servers:fileEditor.archiveDisabled.description")}
              </AlertDescription>
            </Alert>
          </div>
        ) : mode === "image" ? (
          <div className="flex h-[68vh] items-center justify-center bg-muted/30 p-4">
            {downloadUrl ? (
              <img
                src={downloadUrl}
                alt={fileName}
                className="max-h-full max-w-full rounded-md object-contain"
              />
            ) : null}
          </div>
        ) : (
          <div className="h-[68vh]">
            <MonacoEditor
              height="100%"
              language={language}
              path={normalizedPath}
              value={content}
              theme="vs-dark"
              options={{
                automaticLayout: true,
                minimap: { enabled: false },
                readOnly: !canWriteFiles,
                scrollBeyondLastLine: false,
                wordWrap: "on",
              }}
              onChange={(value) => setContent(value ?? "")}
            />
          </div>
        )}
      </CardContent>

      {!canWriteFiles && mode === "text" ? (
        <CardFooter className="border-t py-3 text-sm text-muted-foreground">
          {t("servers:fileEditor.readOnlyNotice")}
        </CardFooter>
      ) : null}
    </Card>
  );
}
