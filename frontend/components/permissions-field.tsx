import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  MANAGEMENT_PERMISSION_GROUPS,
  SERVER_PERMISSION_GROUPS,
  hasPermissionBit,
  resolveManagementPermissions,
  resolveServerPermissions,
  setPermissionBit,
} from "@/lib/permissions";

type PermissionGroups = {
  group: string;
  permissions: { bit: number; label: string }[];
}[];

// Specific-permission picker for project sub-users. Instead of a role, the
// caller stores a numeric permission bitfield. Dependencies are auto-included
// (e.g. FILES_WRITE implies FILES_READ) and shown as checked + disabled.
export function PermissionsField({
  value,
  onChange,
  disabled,
  groups = SERVER_PERMISSION_GROUPS,
  resolve = resolveServerPermissions,
  className = "h-64",
}: {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  /** Which permissions to offer. Defaults to the project/server scope. */
  groups?: PermissionGroups;
  /** Dependency expansion matching `groups`. */
  resolve?: (permissions: number) => number;
  className?: string;
}) {
  const resolved = resolve(value);

  return (
    <ScrollArea className={`${className} rounded-md border`}>
      <div className="space-y-4 p-3">
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

                return (
                  <label
                    key={bit}
                    className="flex items-center gap-2 text-sm font-normal"
                  >
                    <Checkbox
                      checked={checked}
                      disabled={disabled || forced}
                      onCheckedChange={(next) =>
                        onChange(setPermissionBit(value, bit, next === true))
                      }
                    />
                    <span className={forced ? "text-muted-foreground" : ""}>
                      {label}
                    </span>
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
