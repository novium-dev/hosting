import type {
  MinecraftResourceLoader,
  ResourceProject,
  ResourceProviderId,
  ResourceVersion,
} from "./types";

export type SearchResourceProjectsInput = {
  query: string;
  loader: MinecraftResourceLoader;
  limit?: number;
};

export type ListResourceVersionsInput = {
  projectId: string;
  loader: MinecraftResourceLoader;
};

export type ResourceBrowserProvider = {
  id: ResourceProviderId;
  searchProjects(input: SearchResourceProjectsInput): Promise<ResourceProject[]>;
  listVersions(input: ListResourceVersionsInput): Promise<ResourceVersion[]>;
};

const providers = new Map<ResourceProviderId, ResourceBrowserProvider>();

export function registerResourceProvider(provider: ResourceBrowserProvider) {
  providers.set(provider.id, provider);
}

export function getResourceProvider(providerId: ResourceProviderId) {
  const provider = providers.get(providerId);

  if (!provider) {
    throw new Error(`Unknown resource provider: ${providerId}`);
  }

  return provider;
}
