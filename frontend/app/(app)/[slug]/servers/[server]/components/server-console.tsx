"use client";

import dynamic from "next/dynamic";

const Terminal = dynamic(
  async () => (await import("../components/terminal")).default,
  { ssr: false },
);

export function ServerConsole({ serverId }: { serverId: string }) {
  return <Terminal serverId={serverId} />;
}
