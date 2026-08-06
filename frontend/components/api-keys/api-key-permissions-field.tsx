import { useTranslation } from "react-i18next";
import {
  ManagementPermissionsField,
  PermissionsField,
} from "@/components/permissions-field";
import { FormDescription, FormLabel } from "@/components/ui/form";
import {
  allManagementPermissions,
  allServerPermissions,
  maskPermissions,
  mergePermissions,
} from "@/lib/permissions";

/**
 * Permission picker for an API key.
 *
 * A project key only ever carries project/server permissions; an instance-wide
 * key can also carry management ones, so both scopes are offered and edited
 * independently over the one bitfield.
 */
export function ApiKeyPermissionsField({
  scoped,
  value,
  onChange,
}: {
  /** Whether the key is scoped to a single project. */
  scoped: boolean;
  value: number;
  onChange: (value: number) => void;
}) {
  const { t } = useTranslation();

  if (scoped) {
    return <PermissionsField value={value} onChange={onChange} />;
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <FormLabel>{t("org:apiKeys.permissionsField.instanceLabel")}</FormLabel>
        <ManagementPermissionsField
          className="h-48"
          value={maskPermissions(value, allManagementPermissions)}
          onChange={(next) =>
            onChange(
              mergePermissions(maskPermissions(value, allServerPermissions), next),
            )
          }
        />
      </div>
      <div className="space-y-2">
        <FormLabel>{t("org:apiKeys.permissionsField.serverLabel")}</FormLabel>
        <FormDescription>
          {t("org:apiKeys.permissionsField.serverDescription")}
        </FormDescription>
        <PermissionsField
          className="h-48"
          value={maskPermissions(value, allServerPermissions)}
          onChange={(next) =>
            onChange(
              mergePermissions(
                maskPermissions(value, allManagementPermissions),
                next,
              ),
            )
          }
        />
      </div>
    </div>
  );
}
