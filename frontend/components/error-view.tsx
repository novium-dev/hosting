import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

// Shared full-page layout for error / not-found screens, matching the app style.
export function ErrorView({
  icon: Icon,
  eyebrow,
  title,
  description,
  detail,
  actions,
}: {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  description: string;
  detail?: string;
  actions?: ReactNode;
}) {
  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto flex min-h-svh w-full max-w-3xl flex-col justify-center px-6 py-16">
        <div className="space-y-8">
          <div className="flex size-12 items-center justify-center rounded-md border bg-muted">
            <Icon className="size-6 text-destructive" />
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              {eyebrow}
            </p>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              {title}
            </h1>
            <p className="max-w-xl text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          </div>

          {detail && (
            <pre className="max-w-full overflow-x-auto rounded-md border bg-muted/50 px-4 py-3 font-mono text-xs text-muted-foreground">
              {detail}
            </pre>
          )}

          {actions && <div className="flex flex-wrap gap-3">{actions}</div>}
        </div>
      </div>
    </main>
  );
}
