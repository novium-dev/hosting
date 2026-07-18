import {
  Modrinth,
  SearchSort,
  type ProjectVersion,
  type SearchHit,
} from "typerinth";

import type {
  MinecraftResourceLoader,
  ResourceProject,
  ResourceVersion,
} from "./types";
import {
  registerResourceProvider,
  type ResourceBrowserProvider,
} from "./providers";
import NodeCache from "node-cache";

const modrinth = new Modrinth({
  userAgent: "Hephaestus/0.1.0 (hosting-frontend)",
  cache: new NodeCache({ stdTTL: 300, checkperiod: 120 }),
});

function getProjectType(loader: MinecraftResourceLoader) {
  return loader === "paper" ? "plugin" : "mod";
}

function toProject(hit: SearchHit): ResourceProject {
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

function toVersion(version: ProjectVersion): ResourceVersion {
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
    const result = await modrinth.search(query, {
      limit: 24,
      sort: query.trim() ? SearchSort.Relevance : SearchSort.Downloads,
      filters: {
        projectType: getProjectType(loader),
        categories: loader,
        serverSide: ["required", "optional"],
      },
    });

    return result.hits.map(toProject);
  },
  async listVersions({ projectId, loader }) {
    const versions = await modrinth.getProjectVersions(projectId, {
      loaders: [loader],
    });

    return versions.map(toVersion);
  },
};

registerResourceProvider(modrinthProvider);
