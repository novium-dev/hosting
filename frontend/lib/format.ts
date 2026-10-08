export function formatCountdown(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

export function formatOptionalMib(value: number | null | undefined) {
  if (!value) return "—";
  return value >= 1024 ? `${(value / 1024).toFixed(1)} GiB` : `${value} MiB`;
}
