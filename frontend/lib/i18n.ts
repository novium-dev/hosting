import i18next from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import enCommon from "@/locales/en/common.json";
import enApp from "@/locales/en/app.json";
import enProject from "@/locales/en/project.json";
import enNavigation from "@/locales/en/navigation.json";
import enSettings from "@/locales/en/settings.json";
import enServers from "@/locales/en/servers.json";
import enServersManagement from "@/locales/en/servers-management.json";
import enAdminCore from "@/locales/en/admin-core.json";
import enAdminInfra from "@/locales/en/admin-infra.json";
import enAdminIntegrity from "@/locales/en/admin-integrity.json";
import deCommon from "@/locales/de/common.json";
import deApp from "@/locales/de/app.json";
import deProject from "@/locales/de/project.json";
import deNavigation from "@/locales/de/navigation.json";
import deSettings from "@/locales/de/settings.json";
import deServers from "@/locales/de/servers.json";
import deServersManagement from "@/locales/de/servers-management.json";
import deAdminCore from "@/locales/de/admin-core.json";
import deAdminInfra from "@/locales/de/admin-infra.json";
import deAdminIntegrity from "@/locales/de/admin-integrity.json";

export const defaultNamespace = "common";
export const namespaces = [
  "common",
  "app",
  "project",
  "navigation",
  "settings",
  "servers",
  "servers-management",
  "admin-core",
  "admin-infra",
  "admin-integrity",
] as const;
export const supportedLanguages = ["en", "de"] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];

void i18next
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        common: enCommon,
        app: enApp,
        project: enProject,
        navigation: enNavigation,
        settings: enSettings,
        servers: enServers,
        "servers-management": enServersManagement,
        "admin-core": enAdminCore,
        "admin-infra": enAdminInfra,
        "admin-integrity": enAdminIntegrity,
      },
      de: {
        common: deCommon,
        app: deApp,
        project: deProject,
        navigation: deNavigation,
        settings: deSettings,
        servers: deServers,
        "servers-management": deServersManagement,
        "admin-core": deAdminCore,
        "admin-infra": deAdminInfra,
        "admin-integrity": deAdminIntegrity,
      },
    },
    fallbackLng: "en",
    supportedLngs: supportedLanguages,
    defaultNS: defaultNamespace,
    ns: namespaces,
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: "language",
    },
  });

export default i18next;
