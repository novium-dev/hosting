import { useParams } from "react-router-dom";
import useSWR from "swr";

import { NotFoundView } from "@/components/not-found-view";
import { listDomainRoutes, listRouteDomainsAdmin } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import {
  ManagementPermission,
  hasManagementPermission,
} from "@/lib/permissions";
import { DomainRoutesTable } from "./domain-routes-table";

export default function AdminDomainPage() {
  const { domain: domainParam } = useParams<{ domain: string }>();
  const { data: session, isLoading } = authClient.useSession();
  const domainId = Number(domainParam);

  const canView = session
    ? hasManagementPermission(
        session.user.permissions,
        ManagementPermission.DOMAINS_VIEW,
      )
    : false;

  const { data: domains } = useSWR(
    canView ? "admin-route-domains" : null,
    async () => {
      const response = await listRouteDomainsAdmin();
      return response.error ? [] : (response.data ?? []);
    },
  );

  const { data: routes, isLoading: routesLoading } = useSWR(
    canView && Number.isInteger(domainId)
      ? ["admin-domain-routes", domainId]
      : null,
    async () => {
      const response = await listDomainRoutes({
        path: { domain_id: domainId },
      });
      return response.error ? [] : (response.data ?? []);
    },
  );

  if (isLoading) return null;
  if (!canView || !Number.isInteger(domainId)) return <NotFoundView />;

  const domain = domains?.find((candidate) => candidate.id === domainId);

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <DomainRoutesTable
        domainName={domain?.domain ?? String(domainId)}
        routes={routes ?? []}
        isLoading={routesLoading}
      />
    </div>
  );
}
