/**
 * Per-template banner gradients, rendered half-transparent behind the server
 * card header for a cleaner, more distinctive look. Matching is done on the
 * template id so variants (e.g. `minecraft_paper`) share a family colour.
 */

type TemplateBanner = {
  /** CSS gradient used as the banner background. */
  gradient: string;
};

const BANNERS: { match: (id: string) => boolean; banner: TemplateBanner }[] = [
  {
    match: (id) => id.includes("minecraft"),
    banner: { gradient: "linear-gradient(135deg, #34d399 0%, #065f46 100%)" },
  },
  {
    match: (id) => id.includes("satisfactory"),
    banner: { gradient: "linear-gradient(135deg, #fb923c 0%, #9a3412 100%)" },
  },
  {
    match: (id) => id.includes("rust"),
    banner: { gradient: "linear-gradient(135deg, #f97316 0%, #7c2d12 100%)" },
  },
  {
    match: (id) => id.includes("java"),
    banner: { gradient: "linear-gradient(135deg, #f59e0b 0%, #b91c1c 100%)" },
  },
  {
    match: (id) => id.includes("python"),
    banner: { gradient: "linear-gradient(135deg, #60a5fa 0%, #facc15 100%)" },
  },
  {
    match: (id) => id.includes("go"),
    banner: { gradient: "linear-gradient(135deg, #22d3ee 0%, #0e7490 100%)" },
  },
  {
    match: (id) => id.includes("docker"),
    banner: { gradient: "linear-gradient(135deg, #38bdf8 0%, #1d4ed8 100%)" },
  },
];

const DEFAULT_BANNER: TemplateBanner = {
  gradient: "linear-gradient(135deg, #94a3b8 0%, #334155 100%)",
};

export function templateBanner(template: string): TemplateBanner {
  const id = template.trim().toLowerCase();
  return BANNERS.find((entry) => entry.match(id))?.banner ?? DEFAULT_BANNER;
}
