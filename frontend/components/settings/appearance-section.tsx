"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/components/theme-provider";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation();

  return (
    <div className="space-y-3">
      <div className="space-y-0.5">
        <h3 className="text-sm font-medium">{t("settings:appearance.title")}</h3>
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
    </div>
  );
}
