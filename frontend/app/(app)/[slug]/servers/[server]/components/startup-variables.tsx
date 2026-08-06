"use client";

import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  useVariableEditor,
  VariableFields,
  variableValuesToStrings,
} from "@/components/server/variables-editor";
import { serverVariables, updateVariables } from "@/lib/api";

type StartupVariablesProps = {
  canViewSecrets: boolean;
  serverId: string;
};

type VariablePayload = Awaited<ReturnType<typeof serverVariables>>["data"];

export function StartupVariables({
  canViewSecrets,
  serverId,
}: StartupVariablesProps) {
  const { t } = useTranslation();
  const [payload, setPayload] = useState<VariablePayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const {
    errors: variableErrors,
    hasChanges,
    isFieldDirty,
    markSaved,
    nestedPath,
    onNestedChange,
    reset,
    setVariables,
    variables,
  } = useVariableEditor(payload ?? null);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      setIsLoading(true);

      try {
        const response = await serverVariables({
          path: { server_id: serverId },
        });

        if (response.error || !response.data) {
          throw new Error(t("servers:startup.toasts.loadFailed"));
        }

        if (!mounted) {
          return;
        }

        setPayload(response.data);
        reset(response.data);
      } catch {
        if (mounted) {
          toast.error(t("servers:startup.toasts.loadFailed"));
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      mounted = false;
    };
  }, [serverId, reset, t]);

  const saveVariables = async () => {
    setIsSaving(true);

    try {
      if (Object.keys(variableErrors).length > 0) {
        toast.error(t("servers:startup.toasts.invalidVariables"));
        return;
      }

      const body = variableValuesToStrings(variables);

      const response = await updateVariables({
        path: { server_id: serverId },
        body,
      });

      if (response.error) {
        throw new Error(t("servers:startup.toasts.saveFailed"));
      }

      markSaved();
      toast.success(t("servers:startup.toasts.saveSuccess"));
    } catch {
      toast.error(t("servers:startup.toasts.saveFailed"));
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {t("servers:startup.loading")}
        </CardContent>
      </Card>
    );
  }

  if (!payload) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("servers:startup.title")}</CardTitle>
          <CardDescription>{t("servers:startup.unableToLoad")}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>{t("servers:startup.title")}</CardTitle>
          <CardDescription>{t("servers:startup.description")}</CardDescription>
        </div>
        <Button
          onClick={saveVariables}
          loading={isSaving}
          disabled={!hasChanges}
        >
          <Save className="size-4" />
          {t("servers:startup.saveButton")}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <VariableFields
          canViewSecrets={canViewSecrets}
          errors={variableErrors}
          isFieldDirty={isFieldDirty}
          nestedPath={nestedPath}
          onNestedChange={onNestedChange}
          payload={payload}
          setVariables={setVariables}
          variables={variables}
        />
      </CardContent>
    </Card>
  );
}
