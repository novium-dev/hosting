export enum FileMode {
  FIFO = 0x1000,
  CHR = 0x2000,
  DIR = 0x4000,
  NAM = 0x5000,
  BLK = 0x6000,
  REG = 0x8000,
  LNK = 0xa000,
  SOCK = 0xc000,
}

// bitflags system
export function modeToType(mode: number): FileMode {
  return mode & 0xf000;
}

export function normalizePath(input: string) {
  const trimmed = input.trim();
  if (!trimmed || trimmed === "/") {
    return "/";
  }

  const cleaned = trimmed.replace(/\/+/g, "/").replace(/\/$/, "");
  return cleaned.startsWith("/") ? cleaned : `/${cleaned}`;
}

export function sortFiles<T extends { name: string; mode: number }>(
  files: T[],
) {
  return [...files].sort((a, b) => {
    const aDir = modeToType(a.mode) === FileMode.DIR;
    const bDir = modeToType(b.mode) === FileMode.DIR;

    if (aDir !== bDir) {
      return aDir ? -1 : 1;
    }

    return a.name.localeCompare(b.name);
  });
}
