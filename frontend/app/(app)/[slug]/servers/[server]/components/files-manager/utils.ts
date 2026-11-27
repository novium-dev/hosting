import { listFiles, type ListFilesResponses } from "@/lib/api";
import { FileMode, modeToType, normalizePath } from "@/lib/files";

export type FileRow = ListFilesResponses[200][number];

export type FileEntryKind = "directory" | "file" | "archive";

export type ArchiveCompression =
  | "zstd"
  | "xz"
  | "zlib"
  | "lz4"
  | "gzip"
  | "bzip2";

export const ARCHIVE_EXTENSIONS: Record<ArchiveCompression, string> = {
  zstd: ".tar.zst",
  xz: ".tar.xz",
  zlib: ".tar.zlib",
  lz4: ".tar.lz4",
  gzip: ".tar.gz",
  bzip2: ".tar.bz2",
};

export const ARCHIVE_COMPRESSIONS = Object.keys(
  ARCHIVE_EXTENSIONS,
) as ArchiveCompression[];

const ARCHIVE_SUFFIX = /\.(tar\.(gz|zst|xz|zlib|lz4|bz2)|tgz|tbz2|zip)$/i;

const PERMISSION_BITS = 0o7777;

export function filesKey(serverId: string, path: string) {
  return ["server-files", serverId, path] as const;
}

export async function loadDirectory(serverId: string, path: string) {
  const response = await listFiles({
    path: { server_id: serverId },
    query: { file: path },
  });

  if (response.error || !response.data) {
    throw new Error("Failed to load files");
  }

  return response.data;
}

export type FileSortColumn = "name" | "size" | "mode";

export type FileSort = {
  column: FileSortColumn;
  direction: "asc" | "desc";
};

export const DEFAULT_FILE_SORT: FileSort = { column: "name", direction: "asc" };

const nameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export function sortFiles(
  files: FileRow[],
  sort: FileSort = DEFAULT_FILE_SORT,
) {
  const factor = sort.direction === "asc" ? 1 : -1;

  return [...files].sort((a, b) => {
    const aDir = isDirectory(a);
    const bDir = isDirectory(b);

    if (aDir !== bDir) {
      return aDir ? -1 : 1;
    }

    const byName = nameCollator.compare(a.name, b.name);
    const primary =
      sort.column === "size" && !aDir
        ? a.size - b.size
        : sort.column === "mode"
          ? permissionBits(a.mode) - permissionBits(b.mode)
          : byName;

    return factor * (primary || byName);
  });
}

export function parentPath(path: string) {
  const parts = normalizePath(path).split("/").filter(Boolean);
  return `/${parts.slice(0, -1).join("/")}`;
}

export function filesHref(slug: string, serverId: string, path: string) {
  const normalized = normalizePath(path);
  const base = `/${slug}/servers/${serverId}/files`;

  return normalized === "/"
    ? base
    : `${base}?path=${encodeURIComponent(normalized)}`;
}

export function joinPath(basePath: string, childName: string) {
  return normalizePath(
    basePath === "/" ? `/${childName}` : `${basePath}/${childName}`,
  );
}

export function getFullPath(currentPath: string, entry: FileRow) {
  return joinPath(currentPath, entry.name);
}

export function isDirectory(row: FileRow) {
  return modeToType(row.mode) === FileMode.DIR;
}

export function getEntryKind(entry: FileRow): FileEntryKind {
  if (isDirectory(entry)) {
    return "directory";
  }

  return entry.archive ? "archive" : "file";
}

export function formatBytes(bytes: number, unknownLabel: string) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return unknownLabel;
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0];

  for (let i = 1; i < units.length && value >= 1024; i += 1) {
    value /= 1024;
    unit = units[i];
  }

  return `${value.toFixed(2)} ${unit}`;
}

export function permissionBits(mode: number) {
  return mode & PERMISSION_BITS;
}

export function formatMode(mode: number) {
  return permissionBits(mode).toString(8).padStart(4, "0");
}

export function formatSymbolicMode(mode: number) {
  const flags = ["r", "w", "x"];

  return [6, 3, 0]
    .map((shift) =>
      flags
        .map((flag, index) => ((mode >> (shift + 2 - index)) & 1 ? flag : "-"))
        .join(""),
    )
    .join("");
}

export function stripArchiveExtension(name: string) {
  return name.replace(ARCHIVE_SUFFIX, "");
}

export function withArchiveExtension(
  name: string,
  compression: ArchiveCompression,
) {
  return `${stripArchiveExtension(name)}${ARCHIVE_EXTENSIONS[compression]}`;
}

export function archiveSelfExclusions(sources: string[], target: string) {
  return sources
    .filter((source) => target.startsWith(`${source}/`))
    .map(
      (source) =>
        `${source.split("/").pop() ?? ""}${target.slice(source.length)}`,
    );
}

export function buildPathSegments(path: string) {
  const parts = path.split("/").filter(Boolean);

  return parts.map((part, index) => ({
    label: part,
    path: `/${parts.slice(0, index + 1).join("/")}`,
  }));
}

export function isInside(path: string, directory: string) {
  return path === directory || path.startsWith(`${directory}/`);
}
