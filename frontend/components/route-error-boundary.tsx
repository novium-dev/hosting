import {
  isRouteErrorResponse,
  useNavigate,
  useRouteError,
} from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  FileQuestion,
  Home,
  RotateCw,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import Link from "@/components/link";
import { Button } from "@/components/ui/button";
import { ErrorView } from "@/components/error-view";
import { appConfig } from "@/constants/config";

export function NotFound() {
  const navigate = useNavigate();
  const { t } = useTranslation(["app", "common"]);

  return (
    <ErrorView
      icon={FileQuestion}
      eyebrow={t("app:notFound.eyebrow")}
      title={t("app:notFound.title")}
      description={t("app:notFound.description")}
      actions={
        <>
          <Button render={<Link href="/" />} nativeButton={false}>
            <Home className="size-4" />
            {t("common:actions.backToDashboard")}
          </Button>
          <Button variant="outline" onClick={() => navigate(-1)}>
            <ArrowLeft className="size-4" />
            {t("common:actions.goBack")}
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
  const { t } = useTranslation(["app", "common"]);

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
      eyebrow={t("app:routeError.eyebrow")}
      title={t("app:routeError.title")}
      description={t("app:routeError.description", {
        appName: appConfig.appName,
      })}
      detail={detail}
      actions={
        <>
          <Button onClick={() => window.location.reload()}>
            <RotateCw className="size-4" />
            {t("common:actions.reload")}
          </Button>
          <Button
            variant="outline"
            render={<Link href="/" />}
            nativeButton={false}
          >
            <Home className="size-4" />
            {t("common:actions.backToDashboard")}
          </Button>
        </>
      }
    />
  );
}
