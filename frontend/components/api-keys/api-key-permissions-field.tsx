import { useTranslation } from "react-i18next";
import {
  ManagementPermissionsField,
  PermissionsField,
} from "@/components/permissions-field";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldTitle,
} from "@/components/ui/field";
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
    <FieldGroup className="gap-4">
      <Field>
        <FieldTitle>
          {t("project:apiKeys.permissionsField.instanceLabel")}
        </FieldTitle>
        <ManagementPermissionsField
          className="h-48"
          value={maskPermissions(value, allManagementPermissions)}
          onChange={(next) =>
            onChange(
              mergePermissions(
                maskPermissions(value, allServerPermissions),
                next,
              ),
            )
          }
        />
      </Field>
      <Field>
        <FieldTitle>
          {t("project:apiKeys.permissionsField.serverLabel")}
        </FieldTitle>
        <FieldDescription>
          {t("project:apiKeys.permissionsField.serverDescription")}
        </FieldDescription>
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
      </Field>
    </FieldGroup>
  );
}
