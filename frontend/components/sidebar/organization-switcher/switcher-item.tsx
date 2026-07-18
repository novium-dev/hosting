"use client";

import { setActiveOrganizationAction } from "@/actions/organizations";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { OrganizationAvatar } from "@/components/ui/organization-avatar";
import { TextEllipsis } from "@/components/ui/text-ellipsis";
import { appConfig } from "@/constants/config";
import type { AppOrganization } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";
import { useAction } from "@/lib/action-hooks";
import { usePathname } from "@/lib/navigation";
import { useRouter } from "@/lib/navigation";

export function SwitcherItem({
  organization,
  activeOrganizationId,
}: {
  organization: AppOrganization;
  activeOrganizationId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const pathAfterSlug = pathname.split("/").slice(2).join("/");

  const setActiveOrganization = useAction(setActiveOrganizationAction);

  return (
    <DropdownMenuItem
      onClick={(e) => {
        e.preventDefault();
        if (activeOrganizationId === organization.id) return;
        setActiveOrganization.execute({
          slug: organization.slug,
          id: organization.id,
        });
        const nextPath = pathAfterSlug
          ? `/${organization.slug}/${pathAfterSlug}`
          : `/${organization.slug}`;
        router.replace(nextPath);
      }}
      className={cn(
        "gap-2 p-2 cursor-pointer",
        activeOrganizationId === organization.id && "bg-accent",
      )}
    >
      <OrganizationAvatar
        orgId={organization.id}
        orgName={organization.name}
        className="size-5"
      />
      <div className="flex flex-col">
        <TextEllipsis width={140}>{organization.name}</TextEllipsis>
      </div>
      {activeOrganizationId === organization.id && (
        <Check className="ml-auto size-4 text-primary" />
      )}
    </DropdownMenuItem>
  );
}
