import { lazy, Suspense } from "react";

const Terminal = lazy(() => import("../components/terminal"));

export function ServerConsole({ serverId }: { serverId: string }) {
  return (
    <Suspense fallback={null}>
      <Terminal serverId={serverId} />
    </Suspense>
  );
}
