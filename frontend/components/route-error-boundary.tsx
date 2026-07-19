import {
  isRouteErrorResponse,
  useNavigate,
  useRouteError,
} from "react-router-dom";
import { AlertTriangle, ArrowLeft, FileQuestion, Home, RotateCw } from "lucide-react";

import Link from "@/components/link";
import { Button } from "@/components/ui/button";
import { ErrorView } from "@/components/error-view";

export function NotFound() {
  const navigate = useNavigate();

  return (
    <ErrorView
      icon={FileQuestion}
      eyebrow="Error 404"
      title="Page not found"
      description="The page you're looking for doesn't exist or may have been moved."
      actions={
        <>
          <Button asChild>
            <Link href="/">
              <Home className="size-4" />
              Back to dashboard
            </Link>
          </Button>
          <Button variant="outline" onClick={() => navigate(-1)}>
            <ArrowLeft className="size-4" />
            Go back
          </Button>
        </>
      }
    />
  );
}

// React Router `errorElement`: renders the 404 page for missing routes and a
// styled fallback for any unexpected runtime/route error.
export function RouteErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error) && error.status === 404) {
    return <NotFound />;
  }

  const detail = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : undefined;

  return (
    <ErrorView
      icon={AlertTriangle}
      eyebrow="Something went wrong"
      title="An unexpected error occurred"
      description="Hephaestus ran into a problem rendering this page. Try reloading, or head back to your dashboard."
      detail={detail}
      actions={
        <>
          <Button onClick={() => window.location.reload()}>
            <RotateCw className="size-4" />
            Reload
          </Button>
          <Button asChild variant="outline">
            <Link href="/">
              <Home className="size-4" />
              Back to dashboard
            </Link>
          </Button>
        </>
      }
    />
  );
}
