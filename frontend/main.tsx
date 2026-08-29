import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import "@/app/globals.css";
import "@/lib/i18n";
import { router } from "@/router";
import { appConfig } from "@/constants/config";

document.title = appConfig.appName;
document
  .querySelector('meta[name="description"]')
  ?.setAttribute("content", `${appConfig.appName} game panel for managing your servers.`);

const container = document.getElementById("root");
if (!container) throw new Error("Root container #root not found");

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
