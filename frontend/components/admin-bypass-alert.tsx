import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

export function AdminBypassAlert({ description }: { description: string }) {
  const { t } = useTranslation();

  return (
    <Alert>
      <ShieldAlert className="size-4" />
      <AlertTitle>{t("common:policy.adminBypassTitle")}</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
    </Alert>
  );
}
