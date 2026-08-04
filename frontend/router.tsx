import { createBrowserRouter } from "react-router-dom";

import RootLayout from "@/app/layout";
import ErrorPage from "@/app/error/page";
import HomePage from "@/app/page";
import {
  NotFound,
  RouteErrorBoundary,
} from "@/components/route-error-boundary";

import AuthLayout from "@/app/(auth)/layout";
import SigninPage from "@/app/(auth)/signin/page";
import OnboardingPage from "@/app/onboarding/page";

import AppLayout from "@/app/(app)/layout";
import CreateOrganizationPage from "@/app/(app)/create/page";

import AdminLayout from "@/app/(app)/admin/layout";
import AdminApiKeysPage from "@/app/(app)/admin/api-keys/page";
import AdminTemplatesPage from "@/app/(app)/admin/templates/page";
import AdminNodesPage from "@/app/(app)/admin/nodes/page";
import AdminNodePage from "@/app/(app)/admin/nodes/[node]/page";
import AdminRegionsPage from "@/app/(app)/admin/regions/page";
import AdminDomainsPage from "@/app/(app)/admin/domains/page";
import AdminProjectsPage from "@/app/(app)/admin/projects/page";
import AdminUsersPage from "@/app/(app)/admin/users/page";
import AdminUserPage from "@/app/(app)/admin/users/[user]/page";
import AdminServersPage from "@/app/(app)/admin/servers/page";
import AdminServerCreatePage from "@/app/(app)/admin/servers/create/page";
import AdminServerPage from "@/app/(app)/admin/servers/[server]/page";

import SlugLayout from "@/app/(app)/[slug]/layout";
import OrganizationPage from "@/app/(app)/[slug]/page";
import SettingsPage from "@/app/(app)/[slug]/settings/page";
import MembersPage from "@/app/(app)/[slug]/members/page";
import ApiKeysPage from "@/app/(app)/[slug]/api-keys/page";
import DatabasesPage from "@/app/(app)/[slug]/databases/page";
import ProfilePage from "@/app/(app)/[slug]/profile/page";
import ServerLayout from "@/app/(app)/[slug]/servers/[server]/layout";
import ServerSectionPage from "@/app/(app)/[slug]/servers/[server]/[[...section]]/page";

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    errorElement: <RouteErrorBoundary />,
    children: [
      { path: "/error", element: <ErrorPage /> },

      // Auth group: signin (redirects to onboarding if already signed in).
      {
        element: <AuthLayout />,
        children: [{ path: "/signin", element: <SigninPage /> }],
      },
      { path: "/onboarding", element: <OnboardingPage /> },

      // Authenticated app group (auth guard lives in AppLayout).
      {
        element: <AppLayout />,
        children: [
          { path: "/", element: <HomePage /> },
          { path: "/create", element: <CreateOrganizationPage /> },

          {
            path: "/admin",
            element: <AdminLayout />,
            children: [
              { path: "nodes", element: <AdminNodesPage /> },
              { path: "nodes/:node", element: <AdminNodePage /> },
              { path: "regions", element: <AdminRegionsPage /> },
              { path: "domains", element: <AdminDomainsPage /> },
              { path: "projects", element: <AdminProjectsPage /> },
              { path: "users", element: <AdminUsersPage /> },
              { path: "api-keys", element: <AdminApiKeysPage /> },
              { path: "users/:user", element: <AdminUserPage /> },
              { path: "servers", element: <AdminServersPage /> },
              { path: "servers/create", element: <AdminServerCreatePage /> },
              { path: "servers/:server", element: <AdminServerPage /> },
              { path: "templates", element: <AdminTemplatesPage /> },
            ],
          },

          {
            path: "/:slug",
            element: <SlugLayout />,
            children: [
              { index: true, element: <OrganizationPage /> },
              { path: "settings", element: <SettingsPage /> },
              { path: "members", element: <MembersPage /> },
              { path: "api-keys", element: <ApiKeysPage /> },
              { path: "databases", element: <DatabasesPage /> },
              {
                path: "profile",
                element: <ProfilePage />,
              },
              {
                path: "servers/:server",
                element: <ServerLayout />,
                children: [
                  { index: true, element: <ServerSectionPage /> },
                  { path: "*", element: <ServerSectionPage /> },
                ],
              },
            ],
          },
        ],
      },

      // Catch-all: render the styled 404 page for any unmatched URL.
      { path: "*", element: <NotFound /> },
    ],
  },
]);
