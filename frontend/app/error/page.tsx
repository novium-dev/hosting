import Link from "next/link";
import { AlertTriangle, ArrowLeft, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function ErrorPage() {
  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto flex min-h-svh w-full max-w-3xl flex-col justify-center px-6 py-16">
        <div className="space-y-8">
          <div className="flex size-12 items-center justify-center rounded-md border bg-muted">
            <AlertTriangle className="size-6 text-destructive" />
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Backend unavailable
            </p>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              The API returned an internal error.
            </h1>
            <p className="max-w-xl text-sm leading-6 text-muted-foreground">
              Hephaestus could not complete the request because the backend
              returned a server error. Try again, or return to Hephaestus.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/">
                <ArrowLeft className="size-4" />
                Hephaestus
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="">
                <RotateCw className="size-4" />
                Retry
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}
