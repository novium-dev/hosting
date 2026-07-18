import { createBrowserRouter } from "react-router-dom";

import RootLayout from "@/app/layout";
import ErrorPage from "@/app/error/page";
import HomePage from "@/app/page";

import AuthLayout from "@/app/(auth)/layout";
import SigninPage from "@/app/(auth)/signin/page";
import OnboardingPage from "@/app/onboarding/page";

import AcceptInvitationRedirect from "@/app/accept-invitation/page";
import AcceptInvitationPage from "@/app/accept-invitation/[id]/page";

import AppLayout from "@/app/(app)/layout";
import CreateOrganizationPage from "@/app/(app)/create/page";

import AdminLayout from "@/app/(app)/admin/layout";
import AdminNodesPage from "@/app/(app)/admin/nodes/page";
import AdminNodePage from "@/app/(app)/admin/nodes/[node]/page";
import AdminProjectsPage from "@/app/(app)/admin/projects/page";
import AdminUsersPage from "@/app/(app)/admin/users/page";
import AdminServersPage from "@/app/(app)/admin/servers/page";
import AdminServerCreatePage from "@/app/(app)/admin/servers/create/page";
import AdminServerPage from "@/app/(app)/admin/servers/[server]/page";

import SlugLayout from "@/app/(app)/[slug]/layout";
import OrganizationPage from "@/app/(app)/[slug]/page";
import SettingsPage from "@/app/(app)/[slug]/settings/page";
import MembersPage from "@/app/(app)/[slug]/members/page";
import ProfileLayout from "@/app/(app)/[slug]/profile/layout";
import ProfilePage from "@/app/(app)/[slug]/profile/page";
import ServerLayout from "@/app/(app)/[slug]/servers/[server]/layout";
import ServerSectionPage from "@/app/(app)/[slug]/servers/[server]/[[...section]]/page";

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: "/error", element: <ErrorPage /> },

      // Auth group: signin (redirects to onboarding if already signed in).
      {
        element: <AuthLayout />,
        children: [{ path: "/signin", element: <SigninPage /> }],
      },
      { path: "/onboarding", element: <OnboardingPage /> },

      { path: "/accept-invitation", element: <AcceptInvitationRedirect /> },
      { path: "/accept-invitation/:id", element: <AcceptInvitationPage /> },

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
              { path: "projects", element: <AdminProjectsPage /> },
              { path: "users", element: <AdminUsersPage /> },
              { path: "servers", element: <AdminServersPage /> },
              { path: "servers/create", element: <AdminServerCreatePage /> },
              { path: "servers/:server", element: <AdminServerPage /> },
            ],
          },

          {
            path: "/:slug",
            element: <SlugLayout />,
            children: [
              { index: true, element: <OrganizationPage /> },
              { path: "settings", element: <SettingsPage /> },
              { path: "members", element: <MembersPage /> },
              {
                path: "profile",
                element: <ProfileLayout />,
                children: [{ index: true, element: <ProfilePage /> }],
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
    ],
  },
]);
