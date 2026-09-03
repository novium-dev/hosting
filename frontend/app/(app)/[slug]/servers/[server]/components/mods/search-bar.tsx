import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  LOADER_LABELS,
  PROVIDER_LABELS,
  type ResourceLoader,
  type ResourceProvider,
} from "@/lib/mod-browser/types";

type SearchBarProps = {
  id: string;
  query: string;
  onQueryChange: (value: string) => void;
  onSubmit: () => void;
  isSearching: boolean;
  placeholder: string;
  providers: ResourceProvider[];
  provider: ResourceProvider | null;
  onProviderChange: (value: ResourceProvider) => void;
  loaders?: ResourceLoader[];
  loader?: ResourceLoader | null;
  onLoaderChange?: (value: ResourceLoader) => void;
  gameVersion?: string | null;
  compatibleOnly?: boolean;
  onCompatibleOnlyChange?: (value: boolean) => void;
};

export function SearchBar({
  id,
  query,
  onQueryChange,
  onSubmit,
  isSearching,
  placeholder,
  providers,
  provider,
  onProviderChange,
  loaders = [],
  loader,
  onLoaderChange,
  gameVersion,
  compatibleOnly,
  onCompatibleOnlyChange,
}: SearchBarProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="relative min-w-0 flex-1 basis-56">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            className="pl-9"
            placeholder={placeholder}
          />
        </div>

        {loaders.length > 1 && loader && onLoaderChange ? (
          <Select
            value={loader}
            onValueChange={(value) => onLoaderChange(value as ResourceLoader)}
          >
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {loaders.map((entry) => (
                <SelectItem key={entry} value={entry}>
                  {LOADER_LABELS[entry]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        {providers.length > 1 && provider ? (
          <Select
            value={provider}
            onValueChange={(value) =>
              onProviderChange(value as ResourceProvider)
            }
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {providers.map((entry) => (
                <SelectItem key={entry} value={entry}>
                  {PROVIDER_LABELS[entry]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        <Button type="submit" disabled={isSearching || !provider}>
          {t("common:actions.search")}
        </Button>
      </form>

      {gameVersion && onCompatibleOnlyChange ? (
        <div className="flex items-center gap-2">
          <Switch
            id={`${id}-compatible`}
            checked={compatibleOnly ?? false}
            onCheckedChange={onCompatibleOnlyChange}
          />
          <Label
            htmlFor={`${id}-compatible`}
            className="text-sm font-normal text-muted-foreground"
          >
            {t("servers-management:mods.compatibleOnly", { gameVersion })}
          </Label>
        </div>
      ) : null}
    </div>
  );
}
