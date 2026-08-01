import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import {
  defaultSettingsSection,
  parseSettingsHash,
  settingsHash,
  type SettingsSection,
} from "@/lib/settings";

export function useSettingsDialog() {
  const location = useLocation();
  const navigate = useNavigate();

  const { pathname, search, hash } = location;
  const section = parseSettingsHash(hash);

  const open = useCallback(
    (next: SettingsSection = defaultSettingsSection) => {
      navigate({ pathname, search, hash: settingsHash(next) });
    },
    [navigate, pathname, search],
  );

  const select = useCallback(
    (next: SettingsSection) => {
      navigate(
        { pathname, search, hash: settingsHash(next) },
        { replace: true },
      );
    },
    [navigate, pathname, search],
  );

  const close = useCallback(() => {
    navigate({ pathname, search, hash: "" }, { replace: true });
  }, [navigate, pathname, search]);

  return { section, open, select, close };
}
