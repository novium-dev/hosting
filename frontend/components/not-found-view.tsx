export function NotFoundView({
  title = "Not found",
  description = "This page doesn't exist or you don't have access to it.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="flex min-h-[50svh] flex-col items-center justify-center gap-2 text-center">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
