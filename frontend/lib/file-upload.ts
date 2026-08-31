export type UploadProgressHandler = (loaded: number, total: number) => void;

type UploadResult = {
  ok: boolean;
  status: number;
};

export class UploadAbortedError extends Error {
  constructor() {
    super("Upload aborted");
    this.name = "UploadAbortedError";
  }
}

export function isUploadAborted(error: unknown) {
  return error instanceof UploadAbortedError;
}

function sendUpload(
  url: string,
  method: "PUT" | "POST",
  body: Blob | FormData,
  contentType: string | null,
  onProgress?: UploadProgressHandler,
  signal?: AbortSignal,
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new UploadAbortedError());
      return;
    }

    const request = new XMLHttpRequest();
    request.open(method, url, true);

    if (contentType) {
      request.setRequestHeader("Content-Type", contentType);
    }

    const abortRequest = () => {
      request.abort();
    };

    signal?.addEventListener("abort", abortRequest);

    const cleanup = () => {
      signal?.removeEventListener("abort", abortRequest);
    };

    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress?.(event.loaded, event.total);
      }
    });

    request.addEventListener("load", () => {
      cleanup();
      resolve({
        ok: request.status >= 200 && request.status < 300,
        status: request.status,
      });
    });

    request.addEventListener("error", () => {
      cleanup();
      reject(new Error("Upload request failed"));
    });

    request.addEventListener("abort", () => {
      cleanup();
      reject(new UploadAbortedError());
    });

    request.send(body);
  });
}

export async function uploadToSignedUrl({
  url,
  file,
  fileName,
  onProgress,
  signal,
}: {
  url: string;
  file: Blob;
  fileName: string;
  onProgress?: UploadProgressHandler;
  signal?: AbortSignal;
}): Promise<boolean> {
  const put = await sendUpload(
    url,
    "PUT",
    file,
    file.type || null,
    onProgress,
    signal,
  );

  if (put.ok) {
    onProgress?.(file.size, file.size);
    return true;
  }

  if (signal?.aborted) {
    throw new UploadAbortedError();
  }

  const formData = new FormData();
  formData.append("file", file, fileName);
  onProgress?.(0, file.size);

  const post = await sendUpload(url, "POST", formData, null, onProgress, signal);

  if (post.ok) {
    onProgress?.(file.size, file.size);
  }

  return post.ok;
}
