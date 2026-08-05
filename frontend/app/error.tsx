"use client";

import { AlertTriangle, RotateCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useTranslation(["app", "common"]);

  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto flex min-h-svh w-full max-w-3xl flex-col justify-center px-6 py-16">
        <div className="space-y-8">
          <div className="flex size-12 items-center justify-center rounded-md border bg-muted">
            <AlertTriangle className="size-6 text-destructive" />
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              {t("app:globalError.badge")}
            </p>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              {t("app:globalError.title")}
            </h1>
            <p className="max-w-xl text-sm leading-6 text-muted-foreground">
              {t("app:globalError.description")}
            </p>
          </div>

          <Button type="button" onClick={reset}>
            <RotateCw className="size-4" />
            {t("common:actions.retry")}
          </Button>
        </div>
      </div>
    </main>
  );
}
