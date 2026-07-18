import { SessionProvider } from "@/contexts/session-provider";
import { ThemeProvider } from "./theme-provider";
import { Toaster } from "./ui/sonner";

export const Providers = ({ children }: { children: React.ReactNode }) => {
  return (
    <ThemeProvider
      defaultTheme="system"
      storageKey="theme"
      disableTransitionOnChange
    >
      <SessionProvider>
        {children}
        <Toaster richColors />
      </SessionProvider>
    </ThemeProvider>
  );
};
