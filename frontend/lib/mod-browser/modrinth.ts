import type {
  MinecraftResourceLoader,
  ResourceProject,
  ResourceVersion,
} from "./types";
import {
  registerResourceProvider,
  type ResourceBrowserProvider,
} from "./providers";

// Direct browser calls to the Modrinth v2 API (CORS-enabled). Previously this
// used the Node-only `typerinth` client (which pulls in `node-cache` and Node
// built-ins) and ran server-side; the SPA calls the REST API itself instead.
const MODRINTH_API = "https://api.modrinth.com/v2";
const CACHE_TTL_MS = 300_000;

type ModrinthSearchHit = {
  project_id: string;
  slug: string;
  title: string;
  author: string;
  description: string;
  icon_url: string;
  downloads: number;
  follows: number;
  display_categories: string[];
  categories: string[];
  versions: string[];
  latest_version: string;
};

type ModrinthFile = { primary: boolean; filename: string };

type ModrinthVersion = {
  id: string;
  project_id: string;
  name: string;
  version_number: string;
  version_type: "release" | "beta" | "alpha";
  game_versions: string[];
  loaders: string[];
  downloads: number;
  date_published: string;
  files: ModrinthFile[];
};

const cache = new Map<string, { value: unknown; expires: number }>();

async function cachedJson<T>(url: string): Promise<T> {
  const now = Date.now();
  const hit = cache.get(url);
  if (hit && hit.expires > now) return hit.value as T;

  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Modrinth request failed with status ${response.status}`);
  }

  const value = (await response.json()) as T;
  cache.set(url, { value, expires: now + CACHE_TTL_MS });
  return value;
}

function getProjectType(loader: MinecraftResourceLoader) {
  return loader === "paper" ? "plugin" : "mod";
}

function toProject(hit: ModrinthSearchHit): ResourceProject {
  return {
    provider: "modrinth",
    id: hit.project_id,
    slug: hit.slug,
    title: hit.title,
    author: hit.author,
    description: hit.description,
    iconUrl: hit.icon_url,
    downloads: hit.downloads,
    follows: hit.follows,
    categories:
      hit.display_categories.length > 0
        ? hit.display_categories
        : hit.categories,
    versions: hit.versions,
    latestVersion: hit.latest_version,
  };
}

function toVersion(version: ModrinthVersion): ResourceVersion {
  const primaryFile =
    version.files.find((file) => file.primary) ?? version.files[0] ?? null;

  return {
    provider: "modrinth",
    id: version.id,
    projectId: version.project_id,
    name: version.name,
    versionNumber: version.version_number,
    versionType: version.version_type,
    gameVersions: version.game_versions,
    loaders: version.loaders,
    downloads: version.downloads,
    publishedAt: version.date_published,
    primaryFileName: primaryFile?.filename ?? null,
    fileNames: version.files.map((file) => file.filename),
  };
}

export const modrinthProvider: ResourceBrowserProvider = {
  id: "modrinth",
  async searchProjects({ query, loader }) {
    const facets = JSON.stringify([
      [`project_type:${getProjectType(loader)}`],
      [`categories:${loader}`],
      ["server_side:required", "server_side:optional"],
    ]);
    const params = new URLSearchParams({
      query,
      limit: "24",
      index: query.trim() ? "relevance" : "downloads",
      facets,
    });

    const result = await cachedJson<{ hits: ModrinthSearchHit[] }>(
      `${MODRINTH_API}/search?${params.toString()}`,
    );

    return result.hits.map(toProject);
  },
  async listVersions({ projectId, loader }) {
    const params = new URLSearchParams({ loaders: JSON.stringify([loader]) });

    const versions = await cachedJson<ModrinthVersion[]>(
      `${MODRINTH_API}/project/${projectId}/version?${params.toString()}`,
    );

    return versions.map(toVersion);
  },
};

registerResourceProvider(modrinthProvider);
