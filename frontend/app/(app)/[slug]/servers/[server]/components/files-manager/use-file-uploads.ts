import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { appConfig } from "@/constants/config";
import { uploadUser } from "@/lib/api";
import { apiErrorMessage } from "@/lib/api-error";
import { isUploadAborted, uploadToSignedUrl } from "@/lib/file-upload";
import { isUploadTaskActive, type UploadTask } from "./upload-progress";
import { formatBytes, joinPath } from "./utils";

const DISMISS_DELAY = 2500;

function cancelActive(tasks: UploadTask[]) {
  return tasks.map((task) =>
    isUploadTaskActive(task) ? { ...task, status: "cancelled" as const } : task,
  );
}

export function useFileUploads(
  serverId: string,
  onUploaded: (directory: string) => Promise<void>,
) {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const dismissTimeoutRef = useRef<number | null>(null);
  const controllersRef = useRef(new Map<string, AbortController>());
  const runRef = useRef(0);

  const clearDismissTimeout = () => {
    if (dismissTimeoutRef.current !== null) {
      window.clearTimeout(dismissTimeoutRef.current);
      dismissTimeoutRef.current = null;
    }
  };

  useEffect(() => clearDismissTimeout, []);

  const scheduleDismiss = () => {
    clearDismissTimeout();
    dismissTimeoutRef.current = window.setTimeout(() => {
      dismissTimeoutRef.current = null;
      setTasks([]);
    }, DISMISS_DELAY);
  };

  const updateTask = (id: string, patch: Partial<UploadTask>) => {
    setTasks((previous) =>
      previous.map((task) => (task.id === id ? { ...task, ...patch } : task)),
    );
  };

  const cancel = (id: string) => {
    controllersRef.current.get(id)?.abort();

    setTasks((previous) =>
      previous.map((task) =>
        task.id === id && isUploadTaskActive(task)
          ? { ...task, status: "cancelled" }
          : task,
      ),
    );

    if (!tasks.some((task) => task.id !== id && isUploadTaskActive(task))) {
      scheduleDismiss();
    }
  };

  const cancelAll = () => {
    for (const controller of controllersRef.current.values()) {
      controller.abort();
    }

    setTasks(cancelActive);
    scheduleDismiss();
  };

  const dismiss = () => {
    clearDismissTimeout();
    setTasks([]);
  };

  const uploadOne = async (
    file: File,
    id: string,
    controller: AbortController,
    directory: string,
  ): Promise<"done" | "cancelled" | "error"> => {
    if (controller.signal.aborted) {
      return "cancelled";
    }

    updateTask(id, { status: "uploading" });

    const urlResponse = await uploadUser({
      path: { server_id: serverId },
      query: { file: joinPath(directory, file.name) },
    });

    if (controller.signal.aborted) {
      return "cancelled";
    }

    if (urlResponse.error || !urlResponse.data?.url) {
      toast.error(
        apiErrorMessage(
          urlResponse.error,
          t("servers-management:filesManager.toasts.uploadUrlFailed", {
            fileName: file.name,
          }),
        ),
      );
      return "error";
    }

    try {
      const uploaded = await uploadToSignedUrl({
        url: urlResponse.data.url,
        file,
        fileName: file.name,
        signal: controller.signal,
        onProgress: (loaded, total) => updateTask(id, { loaded, total }),
      });

      if (uploaded) {
        return "done";
      }
    } catch (error) {
      if (isUploadAborted(error) || controller.signal.aborted) {
        return "cancelled";
      }
    }

    toast.error(
      t("servers-management:filesManager.toasts.uploadFailedFile", {
        fileName: file.name,
      }),
    );
    return "error";
  };

  const upload = async (incoming: File[], directory: string) => {
    const { maxFileSize } = appConfig.uploads;
    const accepted =
      maxFileSize === null
        ? incoming
        : incoming.filter((file) => file.size <= maxFileSize);

    if (maxFileSize !== null && accepted.length < incoming.length) {
      const rejected = incoming.filter((file) => file.size > maxFileSize);

      toast.error(
        t("servers-management:filesManager.toasts.uploadTooLarge", {
          count: rejected.length,
          fileName: rejected[0]?.name,
          limit: formatBytes(maxFileSize, t("common:status.unknown")),
        }),
      );
    }

    if (accepted.length === 0) {
      return;
    }

    clearDismissTimeout();

    const runId = runRef.current + 1;
    runRef.current = runId;

    const queue = accepted.map((file) => ({
      file,
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      controller: new AbortController(),
    }));

    controllersRef.current = new Map(
      queue.map(({ id, controller }) => [id, controller]),
    );

    setTasks(
      queue.map(({ file, id }) => ({
        id,
        name: file.name,
        loaded: 0,
        total: file.size,
        status: "pending",
      })),
    );
    setIsUploading(true);

    const counts = { done: 0, cancelled: 0, error: 0 };

    try {
      for (const { file, id, controller } of queue) {
        const status = await uploadOne(file, id, controller, directory);
        counts[status] += 1;
        updateTask(
          id,
          status === "done" ? { status, loaded: file.size } : { status },
        );
      }

      if (counts.done > 0) {
        toast.success(
          t("servers-management:filesManager.toasts.uploaded", {
            count: counts.done,
          }),
        );
      }

      if (counts.cancelled > 0) {
        toast.info(
          t("servers-management:filesManager.toasts.uploadCancelled", {
            count: counts.cancelled,
          }),
        );
      }

      if (counts.done > 0 || counts.cancelled > 0) {
        await onUploaded(directory);
      }
    } catch {
      toast.error(t("servers-management:filesManager.toasts.uploadFailed"));
    } finally {
      if (runRef.current === runId) {
        for (const controller of controllersRef.current.values()) {
          controller.abort();
        }

        controllersRef.current.clear();
        setTasks(cancelActive);

        if (counts.error === 0) {
          scheduleDismiss();
        }

        setIsUploading(false);
      }
    }
  };

  return { tasks, isUploading, upload, cancel, cancelAll, dismiss };
}
