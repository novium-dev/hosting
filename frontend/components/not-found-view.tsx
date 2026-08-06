import { useTranslation } from "react-i18next";

export function NotFoundView({
  title,
  description,
}: {
  title?: string;
  description?: string;
}) {
  const { t } = useTranslation(["app", "common"]);

  return (
    <div className="flex min-h-[50svh] flex-col items-center justify-center gap-2 text-center">
      <h1 className="text-2xl font-semibold">
        {title ?? t("common:state.notFound")}
      </h1>
      <p className="text-sm text-muted-foreground">
        {description ?? t("app:notFoundView.description")}
      </p>
    </div>
  );
}
