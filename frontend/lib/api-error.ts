type ApiError = { error?: { msg?: string } };

export function apiErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "error" in error) {
    return (error as ApiError).error?.msg || fallback;
  }

  return fallback;
}
