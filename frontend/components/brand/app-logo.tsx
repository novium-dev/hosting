import { appConfig } from "@/constants/config";
import { cn } from "@/lib/utils";

export const hasLogo = Boolean(appConfig.logoUrl);

type AppLogoProps = {
  className?: string;
};

export function AppLogo({ className }: AppLogoProps) {
  if (!appConfig.logoUrl) {
    return null;
  }

  return (
    <img
      src={appConfig.logoUrl}
      alt={appConfig.appName}
      className={cn("block shrink-0", className)}
    />
  );
}
