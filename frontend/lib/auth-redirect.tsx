import { Navigate, useLocation, useSearchParams } from "react-router-dom";

import { appConfig } from "@/constants/config";

const REDIRECT_PARAM = "redirect";

export function safeRedirectPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return null;
  }

  if (value.includes("\\")) {
    return null;
  }

  const { pathname } = new URL(value, window.location.origin);
  if (pathname === appConfig.authRoutes.signin) {
    return null;
  }

  return value;
}

export function signinHref(target: string) {
  const redirect = safeRedirectPath(target);
  if (!redirect || redirect === "/") {
    return appConfig.authRoutes.signin;
  }

  const params = new URLSearchParams({ [REDIRECT_PARAM]: redirect });
  return `${appConfig.authRoutes.signin}?${params.toString()}`;
}

export function useSigninRedirect() {
  const [searchParams] = useSearchParams();
  return safeRedirectPath(searchParams.get(REDIRECT_PARAM));
}

export function RedirectToSignin() {
  const location = useLocation();

  return (
    <Navigate
      to={signinHref(`${location.pathname}${location.search}${location.hash}`)}
      replace
    />
  );
}
