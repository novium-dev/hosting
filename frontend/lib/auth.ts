import {
  createProject,
  listProjectUsers,
  listProjects,
  listUsers,
  login,
  logout,
  me,
  removeProjectUser,
  setProjectUser,
  updateProject,
} from "@/lib/api";
import type {
  ListProjectUsersResponse,
  ListProjectsResponse,
  ListUsersResponse,
  MeResponse,
} from "@/lib/api";
import type { AuthClientInvitation, AuthClientMember } from "@/lib/auth-client";
import {
  projectRoleFromPermissions,
  projectRolePermissions,
  type ProjectRole,
} from "@/lib/permissions";
import { getSessionTokenFromCookie } from "@/lib/session";
import {
  getCachedSessionUser,
  getSessionCacheKey,
  setCachedSessionUser,
} from "@/lib/session-cache";

type HeaderInput = Headers | Record<string, string> | undefined;

export type AppUser = {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  permissions: number;
  role: "admin" | "moderator" | "user";
};

export type AppSession = {
  user: AppUser;
  session: {
    id: string;
    token: string;
    userId: string;
  };
};

type Project = ListProjectsResponse[number];
type ProjectMember = ListProjectUsersResponse[number];

function isProjectRole(value: string): value is ProjectRole {
  return value === "owner" || value === "admin" || value === "member";
}

export type AppOrganization = Project & {
  members?: AuthClientMember[];
  invitations?: AuthClientInvitation[];
};

const toApiHeaders = (headers: HeaderInput) => {
  if (!headers) return undefined;
  const cookie =
    headers instanceof Headers ? headers.get("cookie") : headers.cookie;
  const authorization =
    headers instanceof Headers
      ? headers.get("authorization")
      : (headers.Authorization ?? headers.authorization);
  const sessionToken = getSessionTokenFromCookie(cookie);

  return {
    ...(cookie ? { cookie } : {}),
    ...(authorization
      ? { Authorization: authorization }
      : sessionToken
        ? { Authorization: `Session ${sessionToken}` }
        : {}),
  };
};

const normalizeUser = (user: MeResponse): AppUser => ({
  id: String(user.id),
  name: user.username,
  email: user.email,
  image: null,
  permissions: user.permissions,
  role: user.role.toLowerCase() as AppUser["role"],
});

const getCurrentUser = async (headers: HeaderInput) => {
  const apiHeaders = toApiHeaders(headers);
  const cacheKey = getSessionCacheKey({
    authorization: apiHeaders?.Authorization,
    cookie: apiHeaders?.cookie,
  });
  const cachedUser = getCachedSessionUser(cacheKey);
  if (cachedUser) return normalizeUser(cachedUser);

  const response = await me({ headers: apiHeaders });
  if (response.error || !response.data) return null;
  setCachedSessionUser(cacheKey, response.data);
  return normalizeUser(response.data);
};

const listCurrentProjects = async (headers: HeaderInput, own?: boolean) => {
  const response = await listProjects({
    headers: toApiHeaders(headers),
    query: { own },
  });
  if (response.error || !response.data) return [];
  return response.data;
};

const projectMemberToAuthClientMember = (
  member: ProjectMember,
): AuthClientMember => ({
  id: String(member.id),
  permissions: member.permissions,
  role: projectRoleFromPermissions(member.permissions),
  user: {
    id: String(member.id),
    name: member.username,
    email: member.email,
    image: null,
  },
});

const resolveProject = async (
  headers: HeaderInput,
  query?: { organizationId?: string; organizationSlug?: string },
) => {
  const projects = await listCurrentProjects(headers);
  return (
    projects.find(
      (project) =>
        project.id === query?.organizationId ||
        project.slug === query?.organizationSlug,
    ) ?? null
  );
};

export const auth = {
  api: {
    getSession: async ({ headers }: { headers?: HeaderInput } = {}) => {
      const user = await getCurrentUser(headers);
      if (!user) return null;

      return {
        user,
        session: {
          id: user.id,
          token: "",
          userId: user.id,
        },
      } satisfies AppSession;
    },

    getToken: async () => ({ token: "" }),

    listOrganizations: async ({
      headers,
      own,
    }: { headers?: HeaderInput; own?: boolean } = {}) =>
      listCurrentProjects(headers, own),

    getFullOrganization: async ({
      headers,
      query,
    }: {
      headers?: HeaderInput;
      query?: { organizationId?: string; organizationSlug?: string };
    }) => {
      const project = await resolveProject(headers, query);
      if (!project) return null;

      const members = await listProjectUsers({
        headers: toApiHeaders(headers),
        path: { project_id: project.id },
      });

      return {
        ...project,
        members: members.error
          ? []
          : (members.data ?? []).map(projectMemberToAuthClientMember),
        invitations: [],
      } satisfies AppOrganization;
    },

    createOrganization: async ({
      headers,
      body,
    }: {
      headers?: HeaderInput;
      body: { name: string; slug: string };
    }) => {
      const response = await createProject({
        headers: toApiHeaders(headers),
        body,
      });
      if (response.error) throw new Error("Failed to create project");
      const projects = await listCurrentProjects(headers);
      return projects.find((project) => project.slug === body.slug) ?? null;
    },

    updateOrganization: async ({
      headers,
      body,
    }: {
      headers?: HeaderInput;
      body: { organizationId?: string; data: { name?: string; slug?: string } };
    }) => {
      const project = await resolveProject(headers, {
        organizationId: body.organizationId,
        organizationSlug: body.data.slug,
      });
      if (!project) throw new Error("Project not found");

      const response = await updateProject({
        headers: toApiHeaders(headers),
        path: { project_id: project.id },
        body: body.data,
      });
      if (response.error) throw new Error("Failed to update project");
      return { ...project, ...body.data };
    },

    setActiveOrganization: async ({
      body,
    }: {
      body: { organizationId: string; organizationSlug?: string };
      headers?: HeaderInput;
    }) => body,

    listUsers: async ({ headers }: { headers?: HeaderInput } = {}) => {
      const response = await listUsers({ headers: toApiHeaders(headers) });
      if (response.error || !response.data) return [];
      return response.data satisfies ListUsersResponse;
    },

    deleteUser: async (_options?: object) => {
      throw new Error(
        "Deleting the current user is handled by the backend API.",
      );
    },

    listSessions: async (_options?: object) => [],
    revokeSession: async (_options?: object) => undefined,
    revokeOtherSessions: async (_options?: object) => undefined,

    createInvitation: async (_options?: object) => {
      throw new Error("Invitations are handled by backend project membership.");
    },
    getInvitation: async (_options?: object) => null,
    acceptInvitation: async (_options?: object) => undefined,
    rejectInvitation: async (_options?: object) => undefined,
    cancelInvitation: async (_options?: object) => undefined,

    updateMemberRole: async ({
      headers,
      body,
    }: {
      headers?: HeaderInput;
      body: { projectId?: string; email: string; role: string | number };
    }) => {
      if (!body.projectId) throw new Error("Project id is required");
      await setProjectUser({
        headers: toApiHeaders(headers),
        path: { project_id: body.projectId },
        body: {
          email: body.email,
          permissions:
            typeof body.role === "string" && isProjectRole(body.role)
              ? projectRolePermissions[body.role]
              : Number(body.role),
        },
      });
    },

    removeMember: async ({
      headers,
      body,
    }: {
      headers?: HeaderInput;
      body: { projectId: string; memberId: string };
    }) => {
      await removeProjectUser({
        headers: toApiHeaders(headers),
        path: { project_id: body.projectId, user_id: Number(body.memberId) },
      });
    },

    signOut: async ({ headers }: { headers?: HeaderInput } = {}) =>
      logout({ headers: toApiHeaders(headers) }),

    signIn: async ({
      path,
      query,
    }: {
      path: { provider: string };
      query: { redirect_url: string };
    }) => login({ path, query }),

    listAdminOrganizations: async ({
      headers,
    }: { headers?: HeaderInput } = {}) => {
      const response = await listProjects({ headers: toApiHeaders(headers) });
      if (response.error || !response.data) return [];
      return response.data satisfies ListProjectsResponse;
    },
  },
};
