import { create } from "zustand";
import { persist } from "zustand/middleware";

import { consoleLevels, type ConsoleLevel } from "@/lib/console-log";

// Per-browser console preferences. The mode is picked in the appearance
// settings; the display toggles are flipped from the console's own toolbar but
// live here so they survive navigation and reloads.

export const consoleModes = ["enhanced", "terminal"] as const;

export type ConsoleMode = (typeof consoleModes)[number];

type ConsolePreferencesState = {
  mode: ConsoleMode;
  showTimestamps: boolean;
  showSource: boolean;
  wrapLines: boolean;
  hiddenLevels: ConsoleLevel[];
  setMode: (mode: ConsoleMode) => void;
  toggleTimestamps: () => void;
  toggleSource: () => void;
  toggleWrapLines: () => void;
  toggleLevel: (level: ConsoleLevel) => void;
  resetLevels: () => void;
};

export const useConsolePreferences = create<ConsolePreferencesState>()(
  persist(
    (set) => ({
      mode: "enhanced",
      showTimestamps: true,
      showSource: true,
      wrapLines: true,
      hiddenLevels: [],
      setMode: (mode) => set({ mode }),
      toggleTimestamps: () =>
        set((state) => ({ showTimestamps: !state.showTimestamps })),
      toggleSource: () => set((state) => ({ showSource: !state.showSource })),
      toggleWrapLines: () => set((state) => ({ wrapLines: !state.wrapLines })),
      toggleLevel: (level) =>
        set((state) => ({
          hiddenLevels: state.hiddenLevels.includes(level)
            ? state.hiddenLevels.filter((entry) => entry !== level)
            : [...state.hiddenLevels, level],
        })),
      resetLevels: () => set({ hiddenLevels: [] }),
    }),
    {
      name: "console-preferences-v1",
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as Partial<ConsolePreferencesState>;

        return {
          ...current,
          ...stored,
          mode: consoleModes.includes(stored.mode as ConsoleMode)
            ? (stored.mode as ConsoleMode)
            : current.mode,
          hiddenLevels: Array.isArray(stored.hiddenLevels)
            ? stored.hiddenLevels.filter((level): level is ConsoleLevel =>
                consoleLevels.includes(level as ConsoleLevel),
              )
            : current.hiddenLevels,
        };
      },
    },
  ),
);
