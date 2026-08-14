export type UploadProgressHandler = (loaded: number, total: number) => void;

type UploadResult = {
  ok: boolean;
  status: number;
};

function sendUpload(
  url: string,
  method: "PUT" | "POST",
  body: Blob | FormData,
  contentType: string | null,
  onProgress?: UploadProgressHandler,
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(method, url, true);

    if (contentType) {
      request.setRequestHeader("Content-Type", contentType);
    }

    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress?.(event.loaded, event.total);
      }
    });

    request.addEventListener("load", () => {
      resolve({
        ok: request.status >= 200 && request.status < 300,
        status: request.status,
      });
    });

    request.addEventListener("error", () => {
      reject(new Error("Upload request failed"));
    });

    request.addEventListener("abort", () => {
      reject(new Error("Upload aborted"));
    });

    request.send(body);
  });
}

export async function uploadToSignedUrl({
  url,
  file,
  fileName,
  onProgress,
}: {
  url: string;
  file: Blob;
  fileName: string;
  onProgress?: UploadProgressHandler;
}): Promise<boolean> {
  const put = await sendUpload(url, "PUT", file, file.type || null, onProgress);

  if (put.ok) {
    onProgress?.(file.size, file.size);
    return true;
  }

  const formData = new FormData();
  formData.append("file", file, fileName);
  onProgress?.(0, file.size);

  const post = await sendUpload(url, "POST", formData, null, onProgress);

  if (post.ok) {
    onProgress?.(file.size, file.size);
  }

  return post.ok;
}
