"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  applyNestedVariableChange,
  buildNestedVariableIndex,
  getInitialVariableState,
  getVariableErrors,
  type NestedVariablePointer,
  type VariableField,
  VariableFields,
  type VariableValue,
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
  const [payload, setPayload] = useState<VariablePayload | null>(null);
  const [variables, setVariables] = useState<Record<string, VariableValue>>({});
  const [initialVariables, setInitialVariables] = useState<
    Record<string, VariableValue>
  >({});
  const [nestedPath, setNestedPath] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const normalizeVariableValue = (value: VariableValue | undefined) => {
    if (typeof value === "boolean") {
      return value ? "true" : "false";
    }

    if (typeof value === "number") {
      return String(value);
    }

    return String(value ?? "");
  };

  const isFieldDirty = (id: string) => {
    return (
      normalizeVariableValue(variables[id]) !==
      normalizeVariableValue(initialVariables[id])
    );
  };

  const hasChanges = useMemo(() => {
    const keys = new Set([
      ...Object.keys(initialVariables),
      ...Object.keys(variables),
    ]);

    for (const key of keys) {
      if (
        normalizeVariableValue(variables[key]) !==
        normalizeVariableValue(initialVariables[key])
      ) {
        return true;
      }
    }

    return false;
  }, [initialVariables, variables]);

  const nestedVariableIndex = useMemo(
    () => buildNestedVariableIndex(payload ?? null),
    [payload],
  );
  const variableErrors = getVariableErrors(payload ?? null, variables);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      setIsLoading(true);

      try {
        const response = await serverVariables({
          path: { server_id: serverId },
        });

        if (response.error || !response.data) {
          throw new Error("Failed to load startup variables");
        }

        if (!mounted) {
          return;
        }

        setPayload(response.data);

        const initialState = getInitialVariableState(response.data);

        setVariables(initialState.variables);
        setInitialVariables(initialState.variables);
        setNestedPath(initialState.nestedPath);
      } catch {
        if (mounted) {
          toast.error("Failed to load startup variables");
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
  }, [serverId]);

  const onNestedVariableChange = (
    variable: VariableField,
    pointer: NestedVariablePointer,
    nextValue: string,
  ) => {
    applyNestedVariableChange({
      nestedIndex: nestedVariableIndex,
      pointer,
      setNestedPath,
      setVariables,
      value: nextValue,
      variable,
    });
  };

  const saveVariables = async () => {
    setIsSaving(true);

    try {
      const errors = getVariableErrors(payload ?? null, variables);
      if (Object.keys(errors).length > 0) {
        toast.error("Fix invalid startup variables before saving");
        return;
      }

      const body = variableValuesToStrings(variables);

      const response = await updateVariables({
        path: { server_id: serverId },
        body,
      });

      if (response.error) {
        throw new Error("Failed to save startup variables");
      }

      setInitialVariables({ ...variables });
      toast.success("Startup variables updated");
    } catch {
      toast.error("Failed to save startup variables");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading startup variables...
        </CardContent>
      </Card>
    );
  }

  if (!payload) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Startup</CardTitle>
          <CardDescription>Unable to load startup variables.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>Startup</CardTitle>
          <CardDescription>
            Edit and save server startup variables.
          </CardDescription>
        </div>
        <Button
          onClick={saveVariables}
          loading={isSaving}
          disabled={!hasChanges}
        >
          <Save className="size-4" />
          Save Variables
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <VariableFields
          canViewSecrets={canViewSecrets}
          errors={variableErrors}
          isFieldDirty={isFieldDirty}
          nestedPath={nestedPath}
          onNestedChange={onNestedVariableChange}
          payload={payload}
          setVariables={setVariables}
          variables={variables}
        />
      </CardContent>
    </Card>
  );
}
