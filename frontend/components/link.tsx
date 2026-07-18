import type { ComponentPropsWithoutRef } from "react";
import { Link as RouterLink, type LinkProps } from "react-router-dom";

// Drop-in replacement for `next/link`. Accepts `href` (Next-style) or `to`
// (react-router style) and forwards everything else to react-router's Link.
// Next-only props (prefetch, passHref, legacyBehavior, scroll) are accepted and
// ignored so call sites don't need changes.
type Props = Omit<ComponentPropsWithoutRef<typeof RouterLink>, "to"> & {
  href?: LinkProps["to"];
  to?: LinkProps["to"];
  prefetch?: boolean;
  passHref?: boolean;
  legacyBehavior?: boolean;
  scroll?: boolean;
};

export default function Link({
  href,
  to,
  prefetch: _prefetch,
  passHref: _passHref,
  legacyBehavior: _legacyBehavior,
  scroll: _scroll,
  ...props
}: Props) {
  return <RouterLink to={to ?? href ?? "#"} {...props} />;
}
