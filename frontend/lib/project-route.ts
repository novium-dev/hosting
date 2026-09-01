import { usePathname } from "@/lib/navigation";

export function useProjectRoute() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  const section = segments[1] ?? "";
  const isServerRoute = section === "servers";
  const isInstanceRoute = section === "databases" && Boolean(segments[2]);

  return {
    pathname,
    slug: segments[0] ?? "",
    section,
    server: isServerRoute ? (segments[2] ?? "") : "",
    serverSection: isServerRoute ? (segments[3] ?? "console") : "",
    instance: isInstanceRoute ? (segments[2] ?? "") : "",
    instanceSection: isInstanceRoute ? (segments[3] ?? "databases") : "",
  };
}
