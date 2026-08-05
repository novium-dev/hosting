import Link from "@/components/link";
import { useParams } from "react-router-dom";
import useSWR from "swr";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  ArrowLeft,
  Crown,
  FolderKanban,
  Settings2,
  Shield,
  User,
  Users,
} from "lucide-react";

import { NotFoundView } from "@/components/not-found-view";
import { getUser, listUserProjects } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import {
  hasManagementPermission,
  ManagementPermission,
} from "@/lib/permissions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserSettingsCard } from "./user-settings-card";

function roleLabel(role: number, t: TFunction) {
  return role === 2
    ? t("admin-core:users.roles.admin")
    : role === 1
      ? t("admin-core:users.roles.moderator")
      : t("admin-core:users.roles.user");
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium break-all">{value}</p>
    </div>
  );
}

export default function AdminUserPage() {
  const { t } = useTranslation();
  const { user: userParam } = useParams<{ user: string }>();
  const userId = Number(userParam);

  const { data: session, isLoading } = authClient.useSession();
  const canView = session
    ? hasManagementPermission(
        session.user.permissions,
        ManagementPermission.USER_VIEW,
      )
    : false;
  const canManage = session
    ? hasManagementPermission(
        session.user.permissions,
        ManagementPermission.USER_MANAGE,
      )
    : false;

  const { data: user, mutate } = useSWR(
    canView && Number.isFinite(userId) ? ["admin-user", userId] : null,
    async () => {
      const response = await getUser({ path: { user_id: userId } });
      return response.error ? null : response.data;
    },
  );

  const { data: projects } = useSWR(
    canView && Number.isFinite(userId) ? ["admin-user-projects", userId] : null,
    async () => {
      const response = await listUserProjects({ path: { user_id: userId } });
      return response.error ? [] : (response.data ?? []);
    },
  );

  if (isLoading) return null;
  if (!session || !canView) return <NotFoundView />;
  if (user === undefined) return null;
  if (!user) {
    return (
      <NotFoundView
        title={t("admin-core:users.detail.notFoundTitle")}
        description={t("admin-core:users.detail.notFoundDescription")}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <Card>
        <CardHeader className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle>{user.username}</CardTitle>
                <Badge
                  variant={user.role === 2 ? "default" : "secondary"}
                  className="inline-flex items-center gap-1"
                >
                  {user.role === 2 ? (
                    <Shield className="size-3" />
                  ) : (
                    <User className="size-3" />
                  )}
                  {roleLabel(user.role, t)}
                </Badge>
              </div>
              <CardDescription>
                {user.email} · ID {user.id}
              </CardDescription>
            </div>
            <Button asChild variant="outline">
              <Link href="/admin/users">
                <ArrowLeft className="size-4" />
                {t("admin-core:users.detail.backToUsers")}
              </Link>
            </Button>
          </div>
        </CardHeader>
      </Card>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview" className="inline-flex items-center gap-2">
            <User className="size-4" />
            {t("admin-core:users.detail.tabs.overview")}
          </TabsTrigger>
          <TabsTrigger
            value="organizations"
            className="inline-flex items-center gap-2"
          >
            <FolderKanban className="size-4" />
            {t("admin-core:users.detail.tabs.organizations")}
          </TabsTrigger>
          <TabsTrigger value="settings" className="inline-flex items-center gap-2">
            <Settings2 className="size-4" />
            {t("admin-core:users.detail.tabs.settings")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <InfoItem
              label={t("admin-core:users.fields.username")}
              value={user.username}
            />
            <InfoItem label={t("common:labels.email")} value={user.email} />
            <InfoItem
              label={t("common:labels.role")}
              value={roleLabel(user.role, t)}
            />
            <InfoItem
              label={t("admin-core:users.fields.firstName")}
              value={user.first_name ?? "-"}
            />
            <InfoItem
              label={t("admin-core:users.fields.lastName")}
              value={user.last_name ?? "-"}
            />
            <InfoItem
              label={t("admin-core:users.fields.authId")}
              value={user.auth_id}
            />
          </div>
        </TabsContent>

        <TabsContent value="organizations">
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead>{t("common:labels.name")}</TableHead>
                  <TableHead>{t("admin-core:shared.slugColumn")}</TableHead>
                  <TableHead>
                    {t("admin-core:users.detail.organizations.table.membership")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("admin-core:users.detail.organizations.table.servers")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("admin-core:shared.open")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!projects || projects.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24">
                      <div className="flex flex-col items-center justify-center gap-2 text-center">
                        <Users className="size-5 text-muted-foreground" />
                        <p className="text-sm font-medium">
                          {t("admin-core:users.detail.organizations.emptyState")}
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  projects.map((project) => (
                    <TableRow key={project.id}>
                      <TableCell className="font-medium">
                        {project.name}
                      </TableCell>
                      <TableCell>{project.slug}</TableCell>
                      <TableCell>
                        <Badge
                          variant={project.owner ? "default" : "secondary"}
                          className="inline-flex items-center gap-1"
                        >
                          {project.owner ? (
                            <Crown className="size-3" />
                          ) : (
                            <User className="size-3" />
                          )}
                          {project.owner
                            ? t("admin-core:users.detail.organizations.ownerBadge")
                            : t("admin-core:users.detail.organizations.memberBadge")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {project.server_count}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/${project.slug}`}>
                            {t("admin-core:shared.open")}
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="settings">
          <UserSettingsCard
            user={user}
            canManage={canManage}
            onUpdated={() => void mutate()}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
