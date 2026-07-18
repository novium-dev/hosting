import { ResourceType } from "@/lib/api";

export type ResourceProviderId = "modrinth";

export type MinecraftResourceLoader = "paper" | "fabric" | "forge" | "neoforge";

export type MinecraftResourceCapability = {
  feature: string;
  label: string;
  loader: MinecraftResourceLoader;
  path: "/mods" | "/plugins";
  resourceType: Extract<ResourceType, "plugin" | "modification">;
};

export type ResourceProject = {
  provider: ResourceProviderId;
  id: string;
  slug: string;
  title: string;
  author: string;
  description: string;
  iconUrl: string | null;
  downloads: number;
  follows: number;
  categories: string[];
  versions: string[];
  latestVersion: string;
};

export type ResourceVersion = {
  provider: ResourceProviderId;
  id: string;
  projectId: string;
  name: string;
  versionNumber: string;
  versionType: "release" | "beta" | "alpha";
  gameVersions: string[];
  loaders: string[];
  downloads: number;
  publishedAt: string;
  primaryFileName: string | null;
  fileNames: string[];
};

export type ResourceInstallState = {
  installed: boolean;
  installedVersionId: string | null;
  installedFileName: string | null;
};
