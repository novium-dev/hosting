import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { TaskLock } from "@/lib/server-tasks";
import { cn } from "@/lib/utils";
import type {
  ResourceLoaderInfo,
  ResourceProvider,
  ResourceVersion,
} from "@/lib/mod-browser/types";

export type ModsContext = {
  serverId: string;
  canWriteFiles: boolean;
  installing: boolean;
  serverStopped: boolean;
  storageLock: TaskLock;
  backupAvailable: boolean;
  gameVersion: string | null;
  loaders: ResourceLoaderInfo[];
};

export function canMutate(ctx: ModsContext) {
  return ctx.canWriteFiles && !ctx.installing && !ctx.storageLock.locked;
}

export function installKey(provider: ResourceProvider, project: string) {
  return `${provider}:${project}`;
}

export function formatCount(value: number) {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatSize(bytes: number) {
  const units = ["B", "KiB", "MiB", "GiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

const DATE_FORMAT = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function formatDate(value: string) {
  return DATE_FORMAT.format(new Date(value));
}

export function formatTimestamp(seconds: number) {
  return DATE_FORMAT.format(new Date(seconds * 1000));
}

function getInitials(title: string) {
  return title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function versionLabel(version: ResourceVersion) {
  return version.version_number === version.name
    ? version.name
    : `${version.version_number} · ${version.name}`;
}

type ProjectIconProps = {
  src?: string | null;
  title: string;
  className?: string;
};

export function ProjectIcon({ src, title, className }: ProjectIconProps) {
  return (
    <Avatar className={cn("size-10 rounded-md", className)}>
      <AvatarImage src={src ?? undefined} alt="" />
      <AvatarFallback className="rounded-md text-xs">
        {getInitials(title)}
      </AvatarFallback>
    </Avatar>
  );
}
