"use client";

import { useState } from "react";
import { Boxes, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import useSWR from "swr";
import { useTranslation } from "react-i18next";

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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { changeServerTemplate, listTemplates } from "@/lib/api";

type ServerTemplateCardProps = {
  serverId: string;
  currentTemplate: string;
  canManage: boolean;
  onChanged: () => void;
};

export function ServerTemplateCard({
  serverId,
  currentTemplate,
  canManage,
  onChanged,
}: ServerTemplateCardProps) {
  const { t } = useTranslation();
  const [template, setTemplate] = useState(currentTemplate);
  const [backup, setBackup] = useState(true);
  const [wipe, setWipe] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);

  const { data: templates } = useSWR("templates", async () => {
    const response = await listTemplates();
    return response.error ? [] : [...(response.data ?? [])].sort();
  });

  const onSwitch = async () => {
    setIsSwitching(true);
    try {
      const response = await changeServerTemplate({
        path: { server_id: serverId },
        body: { template, backup, wipe },
      });

      if (response.error) {
        toast.error(
          response.error.error?.msg ??
            t("admin-infra:servers.templateCard.changeError"),
        );
        return;
      }

      toast.success(
        t("admin-infra:servers.templateCard.changeSuccess", { template }),
      );
      setConfirming(false);
      onChanged();
    } finally {
      setIsSwitching(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Boxes className="size-5 text-muted-foreground" />
            {t("admin-infra:servers.shared.templateLabel")}
          </CardTitle>
          <CardDescription>
            {t("admin-infra:servers.templateCard.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">
              {t("admin-infra:servers.templateCard.currentTemplateLabel")}
            </span>
            <Badge variant="secondary" className="font-mono">
              {currentTemplate}
            </Badge>
          </div>

          <div className="space-y-2">
            <Label htmlFor="template">
              {t("admin-infra:servers.templateCard.newTemplateLabel")}
            </Label>
            <Select
              value={template}
              onValueChange={(value) => setTemplate(value ?? "")}
              disabled={!canManage}
            >
              <SelectTrigger id="template" className="w-full sm:w-72">
                <SelectValue
                  placeholder={t(
                    "admin-infra:servers.templateCard.selectTemplatePlaceholder",
                  )}
                />
              </SelectTrigger>
              <SelectContent>
                {(templates ?? [currentTemplate]).map((entry) => (
                  <SelectItem key={entry} value={entry}>
                    {entry}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3 rounded-lg border p-4">
            <label className="flex items-start gap-2 text-sm font-normal">
              <Checkbox
                checked={backup}
                disabled={!canManage}
                onCheckedChange={(next) => setBackup(next === true)}
              />
              <span>
                {t("admin-infra:servers.templateCard.backupFirstLabel")}
                <span className="block text-xs text-muted-foreground">
                  {t("admin-infra:servers.templateCard.backupFirstHint")}
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm font-normal">
              <Checkbox
                checked={wipe}
                disabled={!canManage}
                onCheckedChange={(next) => setWipe(next === true)}
              />
              <span>
                {t("admin-infra:servers.templateCard.wipeAllLabel")}
                <span className="block text-xs text-muted-foreground">
                  {t("admin-infra:servers.templateCard.wipeAllHint")}
                </span>
              </span>
            </label>
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-muted-foreground">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
            <div className="space-y-1">
              <p>{t("admin-infra:servers.templateCard.stoppedWarning")}</p>
              <p>{t("admin-infra:servers.templateCard.portsWarning")}</p>
            </div>
          </div>

          <Button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={!canManage || isSwitching || !template}
          >
            {t("admin-infra:servers.templateCard.changeButton")}
          </Button>
        </CardContent>
      </Card>

      <AlertDialog
        open={confirming}
        onOpenChange={(open) => {
          if (!open && !isSwitching) setConfirming(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("admin-infra:servers.templateCard.switchTitle", {
                template,
                suffix:
                  template === currentTemplate
                    ? t("admin-infra:servers.templateCard.sameTemplateSuffix")
                    : "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription render={<div className="space-y-2" />}>
              <p>
                {t("admin-infra:servers.templateCard.switchDescription", {
                  template,
                })}
              </p>
              <ul className="list-inside list-disc">
                <li>
                  {backup
                    ? t("admin-infra:servers.templateCard.backupTakenYes")
                    : t("admin-infra:servers.templateCard.backupTakenNo")}
                </li>
                <li>
                  {wipe
                    ? t("admin-infra:servers.templateCard.wipeYes")
                    : t("admin-infra:servers.templateCard.wipeNo")}
                </li>
              </ul>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSwitching}>
              {t("common:actions.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void onSwitch();
              }}
              disabled={isSwitching}
            >
              {isSwitching
                ? t("admin-infra:servers.templateCard.switchingLabel")
                : t("admin-infra:servers.templateCard.changeButton")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
