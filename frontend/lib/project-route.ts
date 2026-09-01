import { usePathname } from "@/lib/navigation";

export function useProjectRoute() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  const isServerRoute = segments[1] === "servers";

  return {
    pathname,
    slug: segments[0] ?? "",
    section: segments[1] ?? "",
    server: isServerRoute ? (segments[2] ?? "") : "",
    serverSection: isServerRoute ? (segments[3] ?? "console") : "",
  };
}
