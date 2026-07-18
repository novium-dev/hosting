import { cn } from "@/lib/utils";

export const NOVIUM_LOGO_SVG_URL = "https://logos.novium.world";
export const NOVIUM_LOGO_PNG_URL = "https://logos.novium.world/?format=png";

type NoviumLogoProps = {
  className?: string;
};

export function NoviumLogo({ className }: NoviumLogoProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={NOVIUM_LOGO_SVG_URL}
      alt="Novium"
      className={cn("block shrink-0", className)}
    />
  );
}
