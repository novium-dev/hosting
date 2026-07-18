"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { OrganizationAvatar } from "@/components/ui/organization-avatar";
import { TextEllipsis } from "@/components/ui/text-ellipsis";
import type { AppOrganization } from "@/lib/auth";
import { ChevronDown } from "lucide-react";
import { useParams } from "@/lib/navigation";
import { CreateOrganizationModal } from "./create-organization";
import { SwitcherItem } from "./switcher-item";

export function OrganizationDropdown({
  organizations,
}: {
  organizations: AppOrganization[];
}) {
  const params = useParams();
  const slug = params.slug as string;

  const activeOrganization = organizations.find(
    (organization) => organization.slug === slug,
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 gap-2 px-2">
          <OrganizationAvatar
            orgId={activeOrganization?.id ?? ""}
            orgName={activeOrganization?.name ?? ""}
          />
          <span className="hidden max-w-40 truncate font-semibold md:block">
            <TextEllipsis width={140}>
              {activeOrganization?.name ?? ""}
            </TextEllipsis>
          </span>
          <ChevronDown className="opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-64 rounded-lg"
        align="start"
        side="bottom"
        sideOffset={8}
      >
        <DropdownMenuItem className="flex items-center gap-2">
          <OrganizationAvatar
            orgId={activeOrganization?.id ?? ""}
            orgName={activeOrganization?.name ?? ""}
          />
          <span className="truncate font-semibold">
            {activeOrganization?.name ?? ""}
          </span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Switch Organization
        </DropdownMenuLabel>
        {organizations?.map((organization) => (
          <SwitcherItem
            key={organization.id}
            organization={organization}
            activeOrganizationId={activeOrganization?.id ?? ""}
          />
        ))}
        <DropdownMenuSeparator />
        <CreateOrganizationModal />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
