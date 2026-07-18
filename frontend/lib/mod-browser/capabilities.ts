import { ResourceType } from "@/lib/api";
import type { MinecraftResourceCapability } from "./types";

export const MINECRAFT_RESOURCE_CAPABILITIES: MinecraftResourceCapability[] = [
  {
    feature: "minecraft_plugins_paper",
    label: "Paper plugins",
    loader: "paper",
    path: "/plugins",
    resourceType: ResourceType.PLUGIN,
  },
  {
    feature: "minecraft_mods_fabric",
    label: "Fabric mods",
    loader: "fabric",
    path: "/mods",
    resourceType: ResourceType.MODIFICATION,
  },
  {
    feature: "minecraft_mods_forge",
    label: "Forge mods",
    loader: "forge",
    path: "/mods",
    resourceType: ResourceType.MODIFICATION,
  },
  {
    feature: "minecraft_mods_neoforge",
    label: "NeoForge mods",
    loader: "neoforge",
    path: "/mods",
    resourceType: ResourceType.MODIFICATION,
  },
];

export function getMinecraftResourceCapabilities(features: string[]) {
  const featureSet = new Set(features);

  return MINECRAFT_RESOURCE_CAPABILITIES.filter((capability) =>
    featureSet.has(capability.feature),
  );
}
