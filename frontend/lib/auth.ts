import {
  createProject,
  listProjectUsers,
  listProjects,
  listUsers,
  login,
  logout,
  me,
  updateProject,
} from "@/lib/api";
import type {
  ListProjectUsersResponse,
  ListProjectsResponse,
  ListUsersResponse,
  MeResponse,
} from "@/lib/api";
import type { AuthClientMember } from "@/lib/auth-client";

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

export type AppOrganization = Project & {
  members?: AuthClientMember[];
};

const normalizeUser = (user: MeResponse): AppUser => ({
  id: String(user.id),
  name: user.username,
  email: user.email,
  image: null,
  permissions: user.permissions,
  role: user.role.toLowerCase() as AppUser["role"],
});

const getCurrentUser = async () => {
  const response = await me();
  if (response.error || !response.data) return null;
  return normalizeUser(response.data);
};

const listCurrentProjects = async (own?: boolean) => {
  const response = await listProjects({ query: { own } });
  if (response.error || !response.data) return [];
  return response.data;
};

const projectMemberToAuthClientMember = (
  member: ProjectMember,
): AuthClientMember => ({
  id: String(member.id),
  permissions: member.permissions,
  user: {
    id: String(member.id),
    name: member.username,
    email: member.email,
    image: null,
  },
});

const resolveProject = async (query?: {
  organizationId?: string;
  organizationSlug?: string;
}) => {
  const projects = await listCurrentProjects();
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
    getSession: async () => {
      const user = await getCurrentUser();
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

    listOrganizations: async ({ own }: { own?: boolean } = {}) =>
      listCurrentProjects(own),

    getFullOrganization: async ({
      query,
    }: {
      query?: { organizationId?: string; organizationSlug?: string };
    }) => {
      const project = await resolveProject(query);
      if (!project) return null;

      const members = await listProjectUsers({
        path: { project_id: project.id },
      });

      return {
        ...project,
        members: members.error
          ? []
          : (members.data ?? []).map(projectMemberToAuthClientMember),
      } satisfies AppOrganization;
    },

    createOrganization: async ({
      body,
    }: {
      body: { name: string; slug: string };
    }) => {
      const response = await createProject({ body });
      if (response.error) throw new Error("Failed to create project");
      const projects = await listCurrentProjects();
      return projects.find((project) => project.slug === body.slug) ?? null;
    },

    updateOrganization: async ({
      body,
    }: {
      body: { organizationId?: string; data: { name?: string; slug?: string } };
    }) => {
      const project = await resolveProject({
        organizationId: body.organizationId,
        organizationSlug: body.data.slug,
      });
      if (!project) throw new Error("Project not found");

      const response = await updateProject({
        path: { project_id: project.id },
        body: body.data,
      });
      if (response.error) throw new Error("Failed to update project");
      return { ...project, ...body.data };
    },

    listUsers: async () => {
      const response = await listUsers();
      if (response.error || !response.data) return [];
      return response.data satisfies ListUsersResponse;
    },

    signOut: async () => logout(),

    signIn: async ({
      path,
      query,
    }: {
      path: { provider: string };
      query: { redirect_url: string };
    }) => login({ path, query }),

    listAdminOrganizations: async () => {
      const response = await listProjects();
      if (response.error || !response.data) return [];
      return response.data satisfies ListProjectsResponse;
    },
  },
};
