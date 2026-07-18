// Runtimes disagree on how they hand back a compressed `fetch` response:
//   - Node/undici leaves `zstd` bodies encoded, with `Content-Encoding` intact.
//   - Bun transparently decodes the body but STILL keeps `Content-Encoding`.
// Trusting the header therefore double-decodes on Bun (its decoder throws on the
// already-plain bytes) and under-decodes on Node. So we read the bytes, attempt
// the matching decoder, fall back to the original bytes when they turn out to be
// plain already, and always drop the encoding header so nothing decodes twice.
//
// Node built-ins are imported dynamically (and marked ignore) so this module
// stays importable from browser-bundled files; the branch never runs client
// side, where the platform decompresses responses itself.

const DECODER_BY_ENCODING: Record<string, string> = {
  zstd: "zstdDecompressSync",
  gzip: "gunzipSync",
  "x-gzip": "gunzipSync",
  br: "brotliDecompressSync",
  deflate: "inflateSync",
};

export async function normalizeCompressedResponse(
  response: Response,
): Promise<Response> {
  const encoding = response.headers
    .get("content-encoding")
    ?.trim()
    .toLowerCase();

  if (!encoding || encoding === "identity" || !response.body) {
    return response;
  }

  const decoderName = DECODER_BY_ENCODING[encoding];
  const buffer = new Uint8Array(await response.arrayBuffer());
  let body = buffer;

  if (decoderName) {
    const zlib = (await import(
      /* webpackIgnore: true */ /* turbopackIgnore: true */ "node:zlib"
    )) as unknown as Record<
      string,
      ((buf: Uint8Array) => Uint8Array) | undefined
    >;

    const decode = zlib[decoderName];
    if (typeof decode === "function") {
      try {
        body = new Uint8Array(decode(buffer));
      } catch {
        // The bytes were already decoded by the runtime (e.g. Bun); the stale
        // Content-Encoding header is the only thing that lied. Keep them as-is.
        body = buffer;
      }
    }
  }

  const headers = new Headers(response.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
