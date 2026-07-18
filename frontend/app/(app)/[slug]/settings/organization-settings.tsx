"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { AppOrganization } from "@/lib/auth";
import { AlertCircle } from "lucide-react";
import { UpdateOrganizationName } from "./update-organization-name";
import { UpdateOrganizationSlug } from "./update-organization-slug";
import { Separator } from "@/components/ui/separator";

interface OrganizationSettingsProps {
  organization: AppOrganization;
}

export function OrganizationSettings({
  organization,
}: OrganizationSettingsProps) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col">
        <h2 className="text-2xl font-bold">Organization Settings</h2>
        <p className="text-sm text-muted-foreground">
          Manage your organization settings here.
        </p>
      </div>
      <UpdateOrganizationName organization={organization} />

      <UpdateOrganizationSlug organization={organization} />

      <Card>
        <CardHeader>
          <CardTitle>Danger Zone</CardTitle>
          <CardDescription>
            Irreversible and destructive actions
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* <AlertDestructive>
            <p className="text-sm">
              Deleting your organization will permanently remove all associated
              data, including workspaces, forms, and responses. This action
              cannot be undone.
            </p>
          </AlertDestructive> */}
          <p className="text-sm text-destructive">
            Deleting your organization will permanently remove all associated
            data, including workspaces, forms, and responses. This action cannot
            be undone.
          </p>
          <Button variant="destructive" size="sm">
            Delete Organization
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
