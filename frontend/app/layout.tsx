import { Outlet } from "react-router-dom";
import { Providers } from "@/components/providers";

// Root route element. The <html>/<body> shell and fonts live in index.html;
// this just wires the app-wide providers around the routed content.
export default function RootLayout() {
  return (
    <Providers>
      <Outlet />
    </Providers>
  );
}
