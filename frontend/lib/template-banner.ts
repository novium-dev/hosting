/**
 * Per-template backgrounds for the server card. Games show their key art
 * across the card, software templates show their logo with a tint in the
 * brand colour. Matching is done on the template id so variants
 * (e.g. `minecraft_paper`) share one banner.
 */

export type TemplateBanner =
  | { kind: "image"; src: string }
  | { kind: "logo"; src: string; color: string }
  | { kind: "tint"; color: string };

const asset = (file: string) => `${import.meta.env.BASE_URL}templates/${file}`;

const image = (file: string): TemplateBanner => ({
  kind: "image",
  src: asset(file),
});

const logo = (file: string, color: string): TemplateBanner => ({
  kind: "logo",
  src: asset(file),
  color,
});

const BANNERS: { match: (id: string) => boolean; banner: TemplateBanner }[] = [
  { match: (id) => id.includes("minecraft"), banner: image("minecraft.jpg") },
  {
    match: (id) => id.includes("satisfactory"),
    banner: image("satisfactory.jpg"),
  },
  { match: (id) => id.includes("enshrouded"), banner: image("enshrouded.jpg") },
  { match: (id) => id.includes("arma"), banner: image("arma.jpg") },
  { match: (id) => id.includes("rust"), banner: image("rust.jpg") },
  {
    match: (id) => id.includes("javascript"),
    banner: logo("javascript.svg", "#539e43"),
  },
  { match: (id) => id.includes("java"), banner: logo("java.svg", "#e76f00") },
  {
    match: (id) => id.includes("python"),
    banner: logo("python.svg", "#3776ab"),
  },
  { match: (id) => id.includes("go"), banner: logo("go.svg", "#00acd7") },
  {
    match: (id) => id.includes("teamspeak"),
    banner: logo("teamspeak.svg", "#2580c3"),
  },
  { match: (id) => id === "web", banner: logo("web.svg", "#e44d26") },
  {
    match: (id) => id.includes("docker"),
    banner: logo("docker.svg", "#2496ed"),
  },
];

const DEFAULT_BANNER: TemplateBanner = { kind: "tint", color: "#94a3b8" };

export function templateBanner(template: string): TemplateBanner {
  const id = template.trim().toLowerCase();
  return BANNERS.find((entry) => entry.match(id))?.banner ?? DEFAULT_BANNER;
}
