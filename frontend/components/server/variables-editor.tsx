"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/searchable-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Above this many options, render a searchable combobox instead of a plain
// select so long lists (e.g. version pickers) can be filtered.
const SEARCHABLE_OPTION_THRESHOLD = 8;

export type VariableValue = string | number | boolean | null;

export type VariableField = {
  current?: string | null;
  data: unknown;
  id: string;
};

export type VariableGroup = {
  name?: string | null;
  variables: VariableField[];
};

export type VariablePayloadLike = {
  data: unknown[];
  groups: VariableGroup[];
};

export type NestedVariablePointer = {
  data_index: number;
  field_index: number;
};

type NestedVariableIndex = Record<string, VariableField>;

type BuildRangeConfig = {
  prefix: string | null;
  range_start: number;
  range_end: number;
  exclude: number[];
};

type RegexTextConfig = {
  placeholder: string;
  regex: string;
  secret?: boolean;
};

export function isNestedPointer(
  value: unknown,
): value is NestedVariablePointer {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return (
    "data_index" in value &&
    "field_index" in value &&
    typeof value.data_index === "number" &&
    typeof value.field_index === "number"
  );
}

function isCheckboxConfig(value: unknown): value is { label: string } {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return "label" in value && typeof value.label === "string";
}

function isRegexTextConfig(value: unknown): value is RegexTextConfig {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return (
    "placeholder" in value &&
    "regex" in value &&
    typeof value.placeholder === "string" &&
    typeof value.regex === "string"
  );
}

function isBuildRangeConfig(value: unknown): value is BuildRangeConfig {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    "range_start" in candidate &&
    "range_end" in candidate &&
    "exclude" in candidate &&
    typeof candidate.range_start === "number" &&
    typeof candidate.range_end === "number" &&
    Array.isArray(candidate.exclude) &&
    candidate.exclude.every((entry) => typeof entry === "number") &&
    (candidate.prefix === null || typeof candidate.prefix === "string")
  );
}

function getEntriesForNode(node: unknown): string[] {
  if (Array.isArray(node)) {
    return node.map((entry) => String(entry));
  }

  if (isBuildRangeConfig(node)) {
    const start = Math.min(node.range_start, node.range_end);
    const end = Math.max(node.range_start, node.range_end);
    const excluded = new Set(node.exclude);
    const prefix = node.prefix ?? "";
    const values: string[] = [];

    for (let build = start; build <= end; build += 1) {
      if (!excluded.has(build)) {
        values.push(`${prefix}${build}`);
      }
    }

    return values;
  }

  if (typeof node === "object" && node !== null) {
    return Object.keys(node);
  }

  return [];
}

function getNestedEntries(
  rootData: unknown,
  pointer: NestedVariablePointer,
  selectedPath: string[],
): string[] {
  let currentNode = rootData;

  for (let depth = 0; depth < pointer.field_index; depth += 1) {
    const selectedKey = selectedPath[depth];
    if (
      !selectedKey ||
      typeof currentNode !== "object" ||
      currentNode === null
    ) {
      return [];
    }

    currentNode = (currentNode as Record<string, unknown>)[selectedKey];
  }

  return getEntriesForNode(currentNode);
}

export function buildNestedVariableIndex(payload: VariablePayloadLike | null) {
  if (!payload) {
    return {};
  }

  const index: NestedVariableIndex = {};
  payload.groups.forEach((group) => {
    group.variables.forEach((variable) => {
      if (isNestedPointer(variable.data)) {
        index[`${variable.data.data_index}:${variable.data.field_index}`] =
          variable;
      }
    });
  });

  return index;
}

export function getInitialVariableState(payload: VariablePayloadLike) {
  const variables: Record<string, VariableValue> = {};
  const nestedPath: Record<string, string> = {};

  payload.groups.forEach((group) => {
    group.variables.forEach((variable) => {
      variables[variable.id] = variable.current ?? "";

      if (isNestedPointer(variable.data) && variable.current) {
        nestedPath[`${variable.data.data_index}:${variable.data.field_index}`] =
          variable.current;
      }
    });
  });

  return { nestedPath, variables };
}

export function variableValuesToStrings(
  variables: Record<string, VariableValue>,
) {
  return Object.fromEntries(
    Object.entries(variables).map(([key, value]) => {
      if (typeof value === "boolean") {
        return [key, value ? "true" : "false"];
      }

      if (typeof value === "number") {
        return [key, String(value)];
      }

      return [key, String(value ?? "")];
    }),
  );
}

function validateRegex(pattern: string, value: string) {
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return false;
  }
}

export function getVariableErrors(
  payload: VariablePayloadLike | null,
  variables: Record<string, VariableValue>,
) {
  const errors: Record<string, string> = {};

  payload?.groups.forEach((group) => {
    group.variables.forEach((variable) => {
      const value = String(variables[variable.id] ?? "");

      if (isRegexTextConfig(variable.data) && variable.data.regex) {
        if (!validateRegex(variable.data.regex, value)) {
          errors[variable.id] = "Value does not match the required format.";
        }
      }
    });
  });

  return errors;
}

export function applyNestedVariableChange({
  nestedIndex,
  pointer,
  setNestedPath,
  setVariables,
  value,
  variable,
}: {
  nestedIndex: NestedVariableIndex;
  pointer: NestedVariablePointer;
  setNestedPath: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setVariables: React.Dispatch<
    React.SetStateAction<Record<string, VariableValue>>
  >;
  value: string;
  variable: VariableField;
}) {
  const fieldKey = `${pointer.data_index}:${pointer.field_index}`;

  setNestedPath((prev) => {
    const next = { ...prev, [fieldKey]: value };

    Object.keys(next).forEach((key) => {
      const [dataIndexRaw, fieldIndexRaw] = key.split(":");
      const dataIndex = Number(dataIndexRaw);
      const fieldIndex = Number(fieldIndexRaw);

      if (
        Number.isFinite(dataIndex) &&
        Number.isFinite(fieldIndex) &&
        dataIndex === pointer.data_index &&
        fieldIndex > pointer.field_index
      ) {
        delete next[key];
      }
    });

    return next;
  });

  setVariables((prev) => {
    const next = {
      ...prev,
      [variable.id]: value,
    };

    Object.entries(nestedIndex).forEach(([key, indexedVariable]) => {
      const [dataIndexRaw, fieldIndexRaw] = key.split(":");
      const dataIndex = Number(dataIndexRaw);
      const fieldIndex = Number(fieldIndexRaw);

      if (
        Number.isFinite(dataIndex) &&
        Number.isFinite(fieldIndex) &&
        dataIndex === pointer.data_index &&
        fieldIndex > pointer.field_index
      ) {
        next[indexedVariable.id] = "";
      }
    });

    return next;
  });
}

export function VariableFields({
  canViewSecrets,
  errors,
  isFieldDirty,
  nestedPath,
  onNestedChange,
  payload,
  setVariables,
  variables,
}: {
  canViewSecrets: boolean;
  errors?: Record<string, string>;
  isFieldDirty?: (id: string) => boolean;
  nestedPath: Record<string, string>;
  onNestedChange: (
    variable: VariableField,
    pointer: NestedVariablePointer,
    value: string,
  ) => void;
  payload: VariablePayloadLike;
  setVariables: React.Dispatch<
    React.SetStateAction<Record<string, VariableValue>>
  >;
  variables: Record<string, VariableValue>;
}) {
  const nestedIndex = buildNestedVariableIndex(payload);

  return (
    <div className="space-y-4">
      {payload.groups.map((group, groupIndex) => (
        <div
          key={`${group.name ?? "group"}-${groupIndex}`}
          className="space-y-3 rounded-md border p-3"
        >
          <h3 className="text-sm font-semibold">
            {group.name || `Group ${groupIndex + 1}`}
          </h3>

          {group.variables.map((variable) => {
            const dirty = isFieldDirty?.(variable.id);
            const error = errors?.[variable.id];
            const label = (
              <div className="flex items-center gap-2">
                <Label>{variable.id}</Label>
                {dirty && (
                  <span className="text-xs font-medium text-amber-600">
                    Edited
                  </span>
                )}
              </div>
            );

            if (Array.isArray(variable.data) && variable.data.length > 0) {
              const currentValue = String(variables[variable.id] ?? "");
              const onSelect = (value: string) =>
                setVariables((prev) => ({ ...prev, [variable.id]: value }));

              return (
                <div key={variable.id} className="space-y-2">
                  {label}
                  {variable.data.length > SEARCHABLE_OPTION_THRESHOLD ? (
                    <SearchableSelect
                      value={currentValue}
                      onChange={onSelect}
                      options={variable.data.map((entry) => ({
                        value: String(entry),
                      }))}
                    />
                  ) : (
                    <Select value={currentValue} onValueChange={onSelect}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select value" />
                      </SelectTrigger>
                      <SelectContent>
                        {variable.data.map((entry) => (
                          <SelectItem key={String(entry)} value={String(entry)}>
                            {String(entry)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              );
            }

            if (isCheckboxConfig(variable.data)) {
              return (
                <label
                  key={variable.id}
                  className="flex items-center gap-3 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={variables[variable.id] === true}
                    onChange={(event) =>
                      setVariables((prev) => ({
                        ...prev,
                        [variable.id]: event.target.checked,
                      }))
                    }
                  />
                  {variable.data.label}
                  {dirty && (
                    <span className="text-xs font-medium text-amber-600">
                      Edited
                    </span>
                  )}
                </label>
              );
            }

            if (isNestedPointer(variable.data) && payload.data.length > 0) {
              const pointer = variable.data;
              const rootData = payload.data[pointer.data_index];
              const selectedPath = Array.from(
                { length: pointer.field_index },
                (_, depth) => {
                  const pathKey = `${pointer.data_index}:${depth}`;
                  const fallbackVariable = nestedIndex[pathKey];
                  const fallbackValue = fallbackVariable
                    ? String(variables[fallbackVariable.id] ?? "")
                    : "";

                  return nestedPath[pathKey] ?? fallbackValue;
                },
              );
              const entries = getNestedEntries(rootData, pointer, selectedPath);

              const currentValue = String(variables[variable.id] ?? "");
              const onSelect = (value: string) =>
                onNestedChange(variable, pointer, value);

              return (
                <div key={variable.id} className="space-y-2">
                  {label}
                  {entries.length > SEARCHABLE_OPTION_THRESHOLD ? (
                    <SearchableSelect
                      value={currentValue}
                      onChange={onSelect}
                      options={entries.map((entry) => ({ value: entry }))}
                    />
                  ) : (
                    <Select value={currentValue} onValueChange={onSelect}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select value" />
                      </SelectTrigger>
                      <SelectContent>
                        {entries.map((entry) => (
                          <SelectItem key={entry} value={entry}>
                            {entry}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              );
            }

            const regexConfig = isRegexTextConfig(variable.data)
              ? variable.data
              : null;
            const isSecret = Boolean(regexConfig?.secret);
            const canEditSecret = !isSecret || canViewSecrets;

            return (
              <div key={variable.id} className="space-y-2">
                {label}
                <Input
                  aria-invalid={Boolean(error)}
                  disabled={!canEditSecret}
                  placeholder={
                    !canEditSecret
                      ? "Secret value hidden"
                      : (regexConfig?.placeholder ?? "Enter value")
                  }
                  type={isSecret ? "password" : "text"}
                  value={
                    canEditSecret ? String(variables[variable.id] ?? "") : ""
                  }
                  onChange={(event) =>
                    setVariables((prev) => ({
                      ...prev,
                      [variable.id]: event.target.value,
                    }))
                  }
                />
                {error && <p className="text-sm text-destructive">{error}</p>}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
