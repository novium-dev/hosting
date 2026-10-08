"use client";

import { LayoutList, Monitor, Moon, SquareTerminal, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";

import { LanguageSwitcher } from "@/components/language-switcher";
import { useTheme } from "@/components/theme-provider";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useConsolePreferences,
  type ConsoleMode,
} from "@/stores/console-preferences";

export function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation();
  const consoleMode = useConsolePreferences((state) => state.mode);
  const setConsoleMode = useConsolePreferences((state) => state.setMode);

  return (
    <div className="space-y-3">
      <div className="space-y-0.5">
        <h3 className="text-sm font-medium">
          {t("settings:appearance.title")}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t("settings:appearance.description")}
        </p>
      </div>
      <Tabs
        value={theme}
        onValueChange={(value) => setTheme(value as typeof theme)}
      >
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="system">
            <Monitor className="size-4" />
            {t("settings:appearance.system")}
          </TabsTrigger>
          <TabsTrigger value="light">
            <Sun className="size-4" />
            {t("settings:appearance.light")}
          </TabsTrigger>
          <TabsTrigger value="dark">
            <Moon className="size-4" />
            {t("settings:appearance.dark")}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="space-y-0.5 pt-2">
        <h3 className="text-sm font-medium">
          {t("settings:appearance.console.title")}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t("settings:appearance.console.description")}
        </p>
      </div>
      <Tabs
        value={consoleMode}
        onValueChange={(value) => setConsoleMode(value as ConsoleMode)}
      >
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="enhanced">
            <LayoutList className="size-4" />
            {t("settings:appearance.console.enhanced")}
          </TabsTrigger>
          <TabsTrigger value="terminal">
            <SquareTerminal className="size-4" />
            {t("settings:appearance.console.terminal")}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <p className="text-xs text-muted-foreground">
        {consoleMode === "terminal"
          ? t("settings:appearance.console.terminalHint")
          : t("settings:appearance.console.enhancedHint")}
      </p>

      <div className="space-y-0.5 pt-2">
        <h3 className="text-sm font-medium">{t("common:language.label")}</h3>
        <p className="text-sm text-muted-foreground">
          {t("settings:appearance.languageDescription")}
        </p>
      </div>
      <LanguageSwitcher />
    </div>
  );
}
