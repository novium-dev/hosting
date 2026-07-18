export const SESSION_COOKIE_NAME = "session";

export function getCookieValue(cookieHeader: string | null | undefined, name: string) {
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(";");
  for (const cookie of cookies) {
    const [key, ...value] = cookie.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }

  return null;
}

export function getSessionTokenFromCookie(cookieHeader: string | null | undefined) {
  return getCookieValue(cookieHeader, SESSION_COOKIE_NAME);
}
