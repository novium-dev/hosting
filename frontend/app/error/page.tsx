import { AlertTriangle, Home, RotateCw } from "lucide-react";

import Link from "@/components/link";
import { Button } from "@/components/ui/button";
import { ErrorView } from "@/components/error-view";
import { appConfig } from "@/constants/config";

export default function ErrorPage() {
  return (
    <ErrorView
      icon={AlertTriangle}
      eyebrow="Backend unavailable"
      title="The API returned an internal error."
      description={`${appConfig.appName} could not complete the request because the backend returned a server error. Try again, or return to your dashboard.`}
      actions={
        <>
          <Button onClick={() => window.location.reload()}>
            <RotateCw className="size-4" />
            Retry
          </Button>
          <Button
            variant="outline"
            render={<Link href="/" />}
            nativeButton={false}
          >
            <Home className="size-4" />
            Back to dashboard
          </Button>
        </>
      }
    />
  );
}
