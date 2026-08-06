import { I18nextProvider } from "react-i18next";
import { SessionProvider } from "@/contexts/session-provider";
import i18n from "@/lib/i18n";
import { ThemeProvider } from "./theme-provider";
import { Toaster } from "./ui/sonner";

export const Providers = ({ children }: { children: React.ReactNode }) => {
  return (
    <I18nextProvider i18n={i18n}>
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
    </I18nextProvider>
  );
};
