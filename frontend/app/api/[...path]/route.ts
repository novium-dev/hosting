import { normalizeCompressedResponse } from "@/lib/decompress";
import { getSessionTokenFromCookie, SESSION_COOKIE_NAME } from "@/lib/session";
import {
  clearCachedSessionUser,
  getSessionCacheKey,
} from "@/lib/session-cache";
import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

async function handler(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const path = await params.then((x) => x.path.join("/"));

  const url = new URL(`/${path}`, API_URL);
  request.nextUrl.searchParams.forEach((value, key) => {
    url.searchParams.append(key, value);
  });

  const rheaders = new Headers(request.headers);
  rheaders.delete("host");
  // Ask the backend not to compress this internal hop. When honored the body
  // streams straight through; if it compresses anyway, normalizeCompressedResponse
  // below decodes it. This avoids forwarding a body whose encoding the runtime
  // already stripped or altered (e.g. Bun decodes zstd but keeps the header),
  // which would make the browser try to decode plain bytes.
  rheaders.set("accept-encoding", "identity");

  if (!rheaders.get("authorization")) {
    const sessionToken = getSessionTokenFromCookie(rheaders.get("cookie"));
    if (sessionToken) {
      rheaders.set("Authorization", `Session ${sessionToken}`);
    }
  }

  try {
    const rawResponse = await fetch(url.toString(), {
      method: request.method,
      headers: rheaders,
      body: request.body,
      duplex: "half",
      redirect: "manual",
    } as RequestInit);
    const response = await normalizeCompressedResponse(rawResponse);
    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete("content-encoding");
    responseHeaders.delete("content-length");
    responseHeaders.delete("transfer-encoding");

    const nextResponse = new NextResponse(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });

    if (path === "auth/logout") {
      nextResponse.cookies.delete(SESSION_COOKIE_NAME);
      clearCachedSessionUser(
        getSessionCacheKey({
          authorization: rheaders.get("authorization"),
          cookie: rheaders.get("cookie"),
        }),
      );
    }

    return nextResponse;
  } catch (error) {
    console.error("Proxy error:", error);
    return NextResponse.json(
      { error: "Failed to proxy request" },
      { status: 500 },
    );
  }
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;
export const HEAD = handler;
export const OPTIONS = handler;
