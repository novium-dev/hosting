"use client";

import { CreateOrganizationForm } from "@/components/create-organization-form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Plus } from "lucide-react";
import { useRouter } from "@/lib/navigation";
import { useState } from "react";

export function CreateOrganizationModal() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <DropdownMenuItem
          className="gap-2 p-2 cursor-pointer"
          onSelect={(e) => e.preventDefault()}
        >
          <div className="flex size-6 items-center justify-center rounded-md border">
            <Plus className="size-4" />
          </div>
          <span className="font-medium">Create Organization</span>
        </DropdownMenuItem>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Organization</DialogTitle>
          <DialogDescription>
            Manage your organization and its content
          </DialogDescription>
        </DialogHeader>
        <div className="shadow-xs border-none">
          <div className="space-y-6 p-0">
            <CreateOrganizationForm
              onSuccess={({ slug }) => {
                setOpen(false);
                router.push(`/${slug}`);
              }}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
