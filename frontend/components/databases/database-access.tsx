"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { UserGrant } from "@/lib/api";
import { useTranslation } from "react-i18next";

export type AccessLevel = "none" | "read" | "write";

export type DatabaseOption = { uuid: string; name: string };

export type AccessMap = Record<string, AccessLevel>;

export function grantsToAccess(grants: UserGrant[] | undefined): AccessMap {
  return Object.fromEntries(
    (grants ?? []).map((grant) => [grant.database_uuid, grant.access]),
  );
}

export function accessToGrants(access: AccessMap): UserGrant[] {
  return Object.entries(access)
    .filter(([, level]) => level !== "none")
    .map(([database_uuid, level]) => ({
      access: level as Exclude<AccessLevel, "none">,
      database_uuid,
    }));
}

export function DatabaseAccessMatrix({
  databases,
  value,
  onChange,
  disabled,
}: {
  databases: DatabaseOption[];
  value: AccessMap;
  onChange: (next: AccessMap) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();

  if (!databases.length) {
    return (
      <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
        {t("project:databases.usersCard.noDatabasesHint")}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {databases.map((database) => (
        <div
          key={database.uuid}
          className="flex items-center justify-between gap-3"
        >
          <code className="min-w-0 truncate rounded-md bg-muted px-2 py-1 font-mono text-xs">
            {database.name}
          </code>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            disabled={disabled}
            value={value[database.uuid] ?? "none"}
            onValueChange={(level) => {
              if (!level) return;
              onChange({ ...value, [database.uuid]: level as AccessLevel });
            }}
          >
            <ToggleGroupItem value="none">
              {t("project:databases.usersCard.accessNone")}
            </ToggleGroupItem>
            <ToggleGroupItem value="read">
              {t("project:databases.usersCard.accessRead")}
            </ToggleGroupItem>
            <ToggleGroupItem value="write">
              {t("project:databases.usersCard.accessWrite")}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      ))}
    </div>
  );
}
