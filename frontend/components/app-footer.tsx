"use client";

import { appConfig } from "@/constants/config";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";


const CURRENT_YEAR = new Date().getFullYear();
const AUTHOR_URL = "https://github.com/InvalidJoker";
const AUTHOR_NAME = "InvalidJoker";

const linkClassName =
  "underline-offset-2 transition-colors hover:text-foreground hover:underline";

type AppFooterProps = {
  className?: string;
};

export function AppFooter({ className }: AppFooterProps) {
  const { t } = useTranslation();
  const { terms, privacy, imprint } = appConfig.legalLinks;

  return (
    <footer
      className={cn(
        "flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4 py-4 text-xs text-muted-foreground",
        className,
      )}
    >
      {privacy ? (
        <a
          href={privacy}
          target="_blank"
          rel="noreferrer"
          className={linkClassName}
        >
          {t("common:footer.privacy")}
        </a>
      ) : null}
      {terms ? (
        <a
          href={terms}
          target="_blank"
          rel="noreferrer"
          className={linkClassName}
        >
          {t("common:footer.terms")}
        </a>
      ) : null}
      {imprint ? (
        <a
          href={imprint}
          target="_blank"
          rel="noreferrer"
          className={linkClassName}
        >
          {t("common:footer.imprint")}
        </a>
      ) : null}
      <span>
        &copy; {CURRENT_YEAR}{" "}
        <a
          href={AUTHOR_URL}
          target="_blank"
          rel="noreferrer"
          className={linkClassName}
        >
          {AUTHOR_NAME}
        </a>
      </span>
    </footer>
  );
}
