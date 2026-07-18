import { ThemeProvider } from "./theme-provider";
import { Toaster } from "./ui/sonner";

export const Providers = ({ children }: { children: React.ReactNode }) => {
  return (
    <ThemeProvider
      defaultTheme="system"
      storageKey="theme"
      disableTransitionOnChange
    >
      {children}
      <Toaster richColors />
    </ThemeProvider>
  );
};
