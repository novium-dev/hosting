"use client";

import { CardFooter } from "@/components/ui/card";
import { appConfig } from "@/constants/config";
import { Trans } from "react-i18next";

const linkProps = {
  target: "_blank",
  rel: "noreferrer",
  className: "underline underline-offset-2",
} as const;

const { terms, privacy } = appConfig.legalLinks;

export const hasLegalLinks = Boolean(terms || privacy);

function LegalNotice() {
  if (terms && privacy) {
    return (
      <Trans
        i18nKey="common:auth.signIn.terms"
        components={{
          termsLink: <a href={terms} {...linkProps} />,
          privacyLink: <a href={privacy} {...linkProps} />,
        }}
      />
    );
  }

  if (terms) {
    return (
      <Trans
        i18nKey="common:auth.signIn.termsOnly"
        components={{ termsLink: <a href={terms} {...linkProps} /> }}
      />
    );
  }

  if (privacy) {
    return (
      <Trans
        i18nKey="common:auth.signIn.privacyOnly"
        components={{ privacyLink: <a href={privacy} {...linkProps} /> }}
      />
    );
  }

  return null;
}

export function LegalFooter() {
  if (!hasLegalLinks) {
    return null;
  }

  return (
    <CardFooter className="bg-muted rounded-b-lg p-4">
      <div className="text-xs text-center text-muted-foreground">
        <LegalNotice />
      </div>
    </CardFooter>
  );
}
