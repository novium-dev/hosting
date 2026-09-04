"use client";

import type { LucideIcon } from "lucide-react";
import { KeyRound, MonitorSmartphone, Palette, User, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AppearanceSection } from "@/components/settings/appearance-section";
import { DaemonAuthSection } from "@/components/settings/daemon-auth-section";
import { ProfileSection } from "@/components/settings/profile-section";
import { SessionsSection } from "@/components/settings/sessions-section";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSettingsDialog } from "@/hooks/use-settings-dialog";
import {
  defaultSettingsSection,
  settingsSections,
  type SettingsSection,
} from "@/lib/settings";

export function SettingsDialog() {
  const { section, select, close } = useSettingsDialog();
  const active = section ?? defaultSettingsSection;
  const { t } = useTranslation();

  const sectionMeta: Record<
    SettingsSection,
    { icon: LucideIcon; label: string; description: string }
  > = {
    profile: {
      icon: User,
      label: t("settings:dialog.sections.profile.label"),
      description: t("settings:dialog.sections.profile.description"),
    },
    sessions: {
      icon: MonitorSmartphone,
      label: t("settings:dialog.sections.sessions.label"),
      description: t("settings:dialog.sections.sessions.description"),
    },
    daemon: {
      icon: KeyRound,
      label: t("common:resources.daemonAuth"),
      description: t("settings:dialog.sections.daemon.description"),
    },
    appearance: {
      icon: Palette,
      label: t("settings:dialog.sections.appearance.label"),
      description: t("settings:dialog.sections.appearance.description"),
    },
  };

  const meta = sectionMeta[active];

  return (
    <Dialog
      open={section !== null}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="block h-[min(40rem,calc(100dvh-3rem))] gap-0 overflow-hidden p-0 sm:max-w-3xl"
      >
        <div className="flex h-full min-h-0 flex-col sm:flex-row">
          <div className="flex shrink-0 flex-col gap-2 border-b bg-muted/40 p-2 sm:w-52 sm:gap-3 sm:border-b-0 sm:border-r sm:p-3">
            <p className="hidden px-2 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:block">
              {t("common:nav.settings")}
            </p>
            <nav className="flex gap-1 overflow-x-auto sm:flex-col sm:overflow-x-visible">
              {settingsSections.map((entry) => {
                const item = sectionMeta[entry];
                const Icon = item.icon;

                return (
                  <Button
                    key={entry}
                    variant={active === entry ? "secondary" : "ghost"}
                    size="sm"
                    className="shrink-0 justify-start sm:w-full"
                    aria-current={active === entry ? "page" : undefined}
                    onClick={() => select(entry)}
                  >
                    <Icon className="size-4" />
                    {item.label}
                  </Button>
                );
              })}
            </nav>
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex shrink-0 items-start justify-between gap-4 border-b px-5 py-4 sm:px-6">
              <div className="flex min-w-0 flex-col gap-0.5">
                <DialogTitle className="text-base">{meta.label}</DialogTitle>
                <DialogDescription className="text-xs leading-relaxed">
                  {meta.description}
                </DialogDescription>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="-mr-1 size-8 shrink-0 text-muted-foreground"
                onClick={close}
              >
                <X className="size-4" />
                <span className="sr-only">{t("common:actions.close")}</span>
              </Button>
            </div>

            <ScrollArea className="min-h-0 flex-1">
              <div className="px-5 py-5 sm:px-6">
                {active === "profile" && <ProfileSection />}
                {active === "sessions" && <SessionsSection />}
                {active === "daemon" && <DaemonAuthSection />}
                {active === "appearance" && <AppearanceSection />}
              </div>
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
