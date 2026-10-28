import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  MANAGEMENT_PERMISSION_GROUPS,
  SERVER_PERMISSION_GROUPS,
  hasPermissionBit,
  maskPermissions,
  mergePermissions,
  removePermissions,
  resolveManagementPermissions,
  resolveServerPermissions,
  setPermissionBit,
} from "@/lib/permissions";
import { Lock } from "lucide-react";
import { useTranslation } from "react-i18next";

type PermissionGroups = {
  group: string;
  permissions: { bit: number; label: string }[];
}[];

// Specific-permission picker for project sub-users. Instead of a role, the
// caller stores a numeric permission bitfield. Dependencies are auto-included
// (e.g. FILES_WRITE implies FILES_READ) and shown as checked + disabled.
// Permissions outside `grantable` are locked, since nobody may grant more than
// they hold themselves.
export function PermissionsField({
  value,
  onChange,
  disabled,
  grantable,
  groups = SERVER_PERMISSION_GROUPS,
  resolve = resolveServerPermissions,
  className = "h-64",
}: {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  /** The permissions the viewer may grant. Defaults to every permission. */
  grantable?: number;
  /** Which permissions to offer. Defaults to the project/server scope. */
  groups?: PermissionGroups;
  /** Dependency expansion matching `groups`. */
  resolve?: (permissions: number) => number;
  className?: string;
}) {
  const { t } = useTranslation();
  const resolved = resolve(value);

  const allBits = mergePermissions(
    ...groups.flatMap((group) => group.permissions.map(({ bit }) => bit)),
  );
  const grantableBits =
    grantable === undefined ? allBits : maskPermissions(grantable, allBits);
  const allSelected =
    grantableBits !== 0 &&
    maskPermissions(resolved, grantableBits) === grantableBits;
  const isGrantable = (bit: number) => hasPermissionBit(grantableBits, bit);

  return (
    <ScrollArea className={`${className} rounded-md border`}>
      <div className="space-y-4 p-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <Checkbox
            checked={allSelected}
            disabled={disabled || grantableBits === 0}
            onCheckedChange={(next) =>
              onChange(
                next === true
                  ? mergePermissions(value, grantableBits)
                  : removePermissions(value, grantableBits),
              )
            }
          />
          {t("common:actions.selectAll")}
        </label>
        {groups.map((group) => (
          <div key={group.group} className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {group.group}
            </p>
            <div className="space-y-2">
              {group.permissions.map(({ bit, label }) => {
                const explicitlySet = hasPermissionBit(value, bit);
                const checked = hasPermissionBit(resolved, bit);
                // Checked only because another permission depends on it: keep it
                // on and non-editable until the dependent is removed.
                const forced = checked && !explicitlySet;
                const locked = !isGrantable(bit);

                return (
                  <label
                    key={bit}
                    className="flex items-center gap-2 text-sm font-normal"
                  >
                    <Checkbox
                      checked={checked}
                      disabled={disabled || forced || locked}
                      onCheckedChange={(next) =>
                        onChange(setPermissionBit(value, bit, next === true))
                      }
                    />
                    <span
                      className={
                        forced || locked ? "text-muted-foreground" : ""
                      }
                    >
                      {label}
                    </span>
                    {locked ? (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Lock className="size-3.5 text-muted-foreground" />
                          }
                        />
                        <TooltipContent>
                          {t("common:permissions.notHeld")}
                        </TooltipContent>
                      </Tooltip>
                    ) : null}
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

/** The same picker over the instance-wide (management) permission scope. */
export function ManagementPermissionsField(
  props: Omit<Parameters<typeof PermissionsField>[0], "groups" | "resolve">,
) {
  return (
    <PermissionsField
      {...props}
      groups={MANAGEMENT_PERMISSION_GROUPS}
      resolve={resolveManagementPermissions}
    />
  );
}
