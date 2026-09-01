"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  CreateProjectForm,
  type ProjectOwnerOption,
} from "@/components/create-project-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function CreateProjectDialog({
  owners,
  onCreated,
}: {
  owners: ProjectOwnerOption[];
  onCreated: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="inline-flex items-center">
          <Plus className="size-4" />
          {t("admin-core:projects.createButton")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("admin-core:projects.createDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("admin-core:projects.createDialog.description")}
          </DialogDescription>
        </DialogHeader>
        <CreateProjectForm
          owners={owners}
          onSuccess={() => {
            setOpen(false);
            onCreated();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
