import { lazy, Suspense } from "react";

import { useConsolePreferences } from "@/stores/console-preferences";

const LogConsole = lazy(() => import("./console/log-console"));
const XtermConsole = lazy(() => import("./console/xterm-console"));

export function ServerConsole({ serverId }: { serverId: string }) {
  const mode = useConsolePreferences((state) => state.mode);

  return (
    <Suspense fallback={null}>
      {mode === "terminal" ? (
        <XtermConsole serverId={serverId} />
      ) : (
        <LogConsole serverId={serverId} />
      )}
    </Suspense>
  );
}
