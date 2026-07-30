import type {
  InstallResourcePayload,
  InstalledResource,
  ListInstalledResourcesResponse,
  ListResourceUpdatesResponse,
  ModpackStatusResponse,
  ResourceKind,
  UpdateAllResourcesResponse,
  ListResourceVersionsResponse,
  ResourceContextResponse,
  ResourceLoader,
  ResourceLoaderInfo,
  ResourceProvider,
  SearchResourcesResponse,
} from "@/lib/api";

// The browser used to talk to Modrinth from the page and keep its own model of
// a "project". Search, version listing and installation now all live in the
// backend, so these are just the generated response shapes under readable
// names.

export type ResourceProject = SearchResourcesResponse[number];
export type ResourceVersion = ListResourceVersionsResponse[number];
export type InstalledResources = ListInstalledResourcesResponse;
export type UnmanagedResource = InstalledResources["unmanaged"][number];
export type InstalledModpack = NonNullable<InstalledResources["modpack"]>;
export type ModpackMod = InstalledModpack["mods"][number];
export type ResourceContext = ResourceContextResponse;
export type ModpackJob = NonNullable<ModpackStatusResponse>;
export type ResourceUpdate = ListResourceUpdatesResponse[number];
export type ResourceUpdateResult = UpdateAllResourcesResponse[number];

export type {
  InstallResourcePayload,
  InstalledResource,
  ResourceKind,
  ResourceLoader,
  ResourceLoaderInfo,
  ResourceProvider,
};

export const RESOURCE_TYPE_LABELS: Record<string, string> = {
  plugin: "plugins",
  modification: "mods",
  data_pack: "data packs",
};

export const PROVIDER_LABELS: Record<ResourceProvider, string> = {
  modrinth: "Modrinth",
  curseforge: "CurseForge",
  hangar: "Hangar",
  spigot: "SpigotMC",
};

// Only used to decide whether the "Mods" tab is worth showing before the
// browser mounts. The authoritative loader/provider list comes from the
// backend's resource context.
const RESOURCE_FEATURES = [
  "minecraft_plugins_paper",
  "minecraft_mods_fabric",
  "minecraft_mods_forge",
  "minecraft_mods_neoforge",
];

export function hasResourceSupport(features: string[]) {
  return features.some((feature) => RESOURCE_FEATURES.includes(feature));
}

export const LOADER_LABELS: Record<ResourceLoader, string> = {
  paper: "Paper plugins",
  fabric: "Fabric mods",
  forge: "Forge mods",
  neoforge: "NeoForge mods",
};
