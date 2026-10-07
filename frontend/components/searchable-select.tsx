import { useTranslation } from "react-i18next";

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { cn } from "@/lib/utils";

type Option = { value: string; label?: string };
type Item = { value: string; label: string };

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder,
  emptyText,
  disabled,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useTranslation("app");

  const items: Item[] = options.map((option) => ({
    value: option.value,
    label: option.label ?? option.value,
  }));
  const selected = items.find((item) => item.value === value) ?? null;

  return (
    <Combobox
      items={items}
      value={selected}
      onValueChange={(item: Item | null) => {
        if (item) onChange(item.value);
      }}
      disabled={disabled}
    >
      <ComboboxInput
        placeholder={placeholder ?? t("searchableSelect.placeholder")}
        disabled={disabled}
        className={cn("w-full", className)}
      />
      <ComboboxContent>
        <ComboboxEmpty>{emptyText ?? t("searchableSelect.noResults")}</ComboboxEmpty>
        <ComboboxList>
          {(item: Item) => (
            <ComboboxItem key={item.value} value={item}>
              {item.label}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
