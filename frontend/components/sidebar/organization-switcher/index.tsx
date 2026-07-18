import useSWR from "swr";
import { auth } from "@/lib/auth";
import { OrganizationDropdown } from "./organization-dropdown";

export function OrganizationSwitcher() {
  const { data: organizations } = useSWR(
    "switcher/own-organizations",
    () => auth.api.listOrganizations({ own: true }),
  );

  return <OrganizationDropdown organizations={organizations ?? []} />;
}
