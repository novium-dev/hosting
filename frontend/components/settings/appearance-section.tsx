"use client";

import { Monitor, Moon, Sun } from "lucide-react";

import { useTheme } from "@/components/theme-provider";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function AppearanceSection() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="space-y-3">
      <div className="space-y-0.5">
        <h3 className="text-sm font-medium">Theme</h3>
        <p className="text-sm text-muted-foreground">
          Choose how the dashboard looks, or follow your system setting.
        </p>
      </div>
      <Tabs
        value={theme}
        onValueChange={(value) => setTheme(value as typeof theme)}
      >
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="system">
            <Monitor className="size-4" />
            System
          </TabsTrigger>
          <TabsTrigger value="light">
            <Sun className="size-4" />
            Light
          </TabsTrigger>
          <TabsTrigger value="dark">
            <Moon className="size-4" />
            Dark
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}
