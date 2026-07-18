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
