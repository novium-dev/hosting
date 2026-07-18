import Link from "@/components/link";
import { useParams } from "react-router-dom";
import useSWR from "swr";
import { Server, ChevronRight, HardDrive } from "lucide-react";

import { MainLayout } from "@/components/sidebar/main-layout";
import { useOrganization } from "@/hooks/use-organization";
import { listServers } from "@/lib/api";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { titleCase } from "@/lib/utils";

export default function OrganizationPage() {
  const { slug } = useParams<{ slug: string }>();

  const { data: org, isLoading } = useOrganization(slug);

  const { data: serversData } = useSWR(
    org ? ["servers", org.id] : null,
    async () => {
      const res = await listServers({ query: { project: org!.id } });
      return res.error ? [] : (res.data ?? []);
    },
  );

  if (isLoading) return null;

  if (!org) {
    return (
      <MainLayout breadcrumbs={[{ label: slug ?? "" }]}>
        <Card>
          <CardHeader>
            <CardTitle>No active organization selected</CardTitle>
            <CardDescription>
              Please select an organization before viewing servers.
            </CardDescription>
          </CardHeader>
        </Card>
      </MainLayout>
    );
  }

  const servers = serversData ?? [];

  return (
    <MainLayout breadcrumbs={[{ label: slug }, { label: "Servers" }]}>
      <div className="flex flex-col gap-8">
        {/* Header */}
        <div className="flex flex-col gap-2">
          <p className="text-3xl font-semibold tracking-tight">Your Servers</p>
          <p className="text-sm text-muted-foreground">
            Manage your game servers, view logs, and access the console.
          </p>
        </div>

        {/* Server List */}
        <div className="flex flex-col gap-4">
          {servers.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center gap-4 py-14 text-center">
                <div className="rounded-2xl bg-muted p-4">
                  <Server className="h-6 w-6 text-muted-foreground" />
                </div>

                <div className="space-y-1">
                  <p className="text-base font-medium">No servers found</p>
                  <p className="text-sm text-muted-foreground">
                    This organization doesn&apos;t have any game servers yet.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {servers.map((server) => (
                <Link
                  key={server.id}
                  href={`/${slug}/servers/${server.id}`}
                  className="group"
                >
                  <Card className="h-full border-border/60 transition-all duration-200 group-hover:border-primary/40 group-hover:shadow-md">
                    <CardHeader className="space-y-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="rounded-xl bg-muted p-2.5">
                          <HardDrive className="h-5 w-5 text-muted-foreground" />
                        </div>

                        <Badge variant="outline">Node {server.node}</Badge>
                      </div>

                      <div className="space-y-1">
                        <CardTitle className="line-clamp-1 text-lg">
                          {server.name}
                        </CardTitle>
                        <CardDescription className="line-clamp-1">
                          {titleCase(server.template)}
                        </CardDescription>
                      </div>
                    </CardHeader>

                    <CardContent className="pt-0">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="truncate text-muted-foreground">
                          ID: {server.id}
                        </span>

                        <span className="inline-flex items-center gap-1 font-medium text-foreground transition-colors group-hover:text-primary">
                          Open
                          <ChevronRight className="h-4 w-4" />
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </MainLayout>
  );
}
