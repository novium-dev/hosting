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
  ListProjectsResponse,
  ListUsersResponse,
  MeResponse,
} from "@/lib/api";
import type { AuthClientMember } from "@/lib/auth-client";
import type { ProjectMember } from "@/types/api";

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
export type AppProject = Project & {
  members?: AuthClientMember[];
};

const normalizeUser = (user: MeResponse): AppUser => ({
  id: String(user.id),
  name: user.username,
  email: user.email,
  image: user.avatar_url,
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
    image: member.avatar_url,
  },
});

const resolveProject = async (query?: {
  projectId?: string;
  projectSlug?: string;
}) => {
  const projects = await listCurrentProjects();
  return (
    projects.find(
      (project) =>
        project.id === query?.projectId || project.slug === query?.projectSlug,
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

    listProjects: async ({ own }: { own?: boolean } = {}) =>
      listCurrentProjects(own),

    getFullProject: async ({
      query,
    }: {
      query?: { projectId?: string; projectSlug?: string };
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
      } satisfies AppProject;
    },

    createProject: async ({
      body,
    }: {
      body: { name: string; slug: string; owner?: number };
    }) => {
      const response = await createProject({ body });
      if (response.error) throw new Error("Failed to create project");
      const projects = await listCurrentProjects();
      return projects.find((project) => project.slug === body.slug) ?? null;
    },

    updateProject: async ({
      body,
    }: {
      body: { projectId?: string; data: { name?: string; slug?: string } };
    }) => {
      const project = await resolveProject({
        projectId: body.projectId,
        projectSlug: body.data.slug,
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

    listAdminProjects: async () => {
      const response = await listProjects();
      if (response.error || !response.data) return [];
      return response.data satisfies ListProjectsResponse;
    },
  },
};
