"use client";

import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useBlocker, type BlockerFunction } from "react-router-dom";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function UnsavedChangesGuard({ when }: Readonly<{ when: boolean }>) {
  const { t } = useTranslation();

  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) =>
      when &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search),
    [when],
  );

  const blocker = useBlocker(shouldBlock);
  const isBlocked = blocker.state === "blocked";

  useEffect(() => {
    if (!when) {
      return;
    }

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [when]);

  useEffect(() => {
    if (!when && blocker.state === "blocked") {
      blocker.reset();
    }
  }, [when, blocker]);

  return (
    <AlertDialog
      open={isBlocked}
      onOpenChange={(open) => {
        if (!open && isBlocked) {
          blocker.reset?.();
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("common:unsavedChanges.title")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("common:unsavedChanges.description")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            onClick={() => {
              blocker.reset?.();
            }}
          >
            {t("common:unsavedChanges.stay")}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              blocker.proceed?.();
            }}
          >
            {t("common:unsavedChanges.discard")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
