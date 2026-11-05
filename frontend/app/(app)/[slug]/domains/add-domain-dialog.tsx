"use client";

import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createProjectDomain } from "@/lib/api";
import { apiErrorMessage } from "@/lib/api-error";

const DOMAIN_PATTERN =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

interface AddDomainDialogProps {
  projectId: string;
  /** Whether the project is already at its domain limit. */
  atLimit: boolean;
  onCreated: () => void;
}

export function AddDomainDialog({
  projectId,
  atLimit,
  onCreated,
}: AddDomainDialogProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [domain, setDomain] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const normalized = domain.trim().replace(/\.$/, "").toLowerCase();
  const valid = normalized.length <= 253 && DOMAIN_PATTERN.test(normalized);

  const submit = async () => {
    if (!valid) return;

    setIsSubmitting(true);

    try {
      const response = await createProjectDomain({
        path: { project_id: projectId },
        body: { domain: normalized },
      });

      if (response.error || !response.data) {
        throw new Error(
          apiErrorMessage(
            response.error,
            t("project:domains.toasts.createFailed"),
          ),
        );
      }

      toast.success(
        t("project:domains.toasts.created", { domain: response.data.domain }),
      );
      setDomain("");
      setOpen(false);
      onCreated();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("project:domains.toasts.createFailed"),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button disabled={atLimit} />}>
        <Plus className="size-4" />
        {t("project:domains.addDialog.trigger")}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("project:domains.addDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("project:domains.addDialog.description")}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Label htmlFor="project-domain">
            {t("project:domains.addDialog.domainLabel")}
          </Label>
          <Input
            id="project-domain"
            value={domain}
            placeholder="example.com"
            autoComplete="off"
            aria-invalid={domain.length > 0 && !valid}
            onChange={(event) => setDomain(event.target.value)}
          />
          {domain.length > 0 && !valid ? (
            <p className="text-xs text-destructive">
              {t("project:domains.addDialog.domainInvalid")}
            </p>
          ) : null}
        </form>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
          >
            {t("common:actions.cancel")}
          </Button>
          <Button
            type="button"
            disabled={isSubmitting || !valid}
            onClick={() => void submit()}
          >
            {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
            {t("common:actions.add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
