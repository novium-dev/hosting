"use client";

import { Search, Shield, User, Users } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { useTranslation } from "react-i18next";

import Link from "@/components/link";
import { SortableTableHead } from "@/components/sortable-table-head";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TablePagination } from "@/components/table-pagination";
import { toPage, usePagedTable } from "@/hooks/use-paged-table";
import { listUsers, type UserSort } from "@/lib/api";
import { apiErrorMessage } from "@/lib/api-error";

type UserRole = "admin" | "moderator" | "user";

type AdminUser = {
  id: number;
  username: string;
  email: string;
  avatar_url: string;
  role: UserRole;
};

const roleValue: Record<UserRole, number> = {
  user: 0,
  moderator: 1,
  admin: 2,
};

function roleFromValue(role: number): UserRole {
  return role === 2 ? "admin" : role === 1 ? "moderator" : "user";
}

function RoleBadge({ role }: { role: UserRole }) {
  const { t } = useTranslation();

  return (
    <Badge
      variant={
        role === "admin"
          ? "destructive"
          : role === "moderator"
            ? "secondary"
            : "outline"
      }
    >
      {role === "user" ? (
        <User className="size-3" />
      ) : (
        <Shield className="size-3" />
      )}
      {role === "admin"
        ? t("common:roles.admin")
        : role === "moderator"
          ? t("admin-core:users.roles.moderator")
          : t("common:roles.user")}
    </Badge>
  );
}

export function UsersTable() {
  const { t } = useTranslation();
  const [role, setRoleState] = useState<"all" | UserRole>("all");
  const { page, setPage, search, setSearch, sort, toggle, query } =
    usePagedTable<UserSort>({ column: "username", direction: "asc" });

  const setRole = (value: "all" | UserRole) => {
    setRoleState(value);
    setPage(0);
  };

  const { data, error } = useSWR(
    [
      "admin/users/page",
      { ...query, role: role === "all" ? undefined : roleValue[role] },
    ],
    async ([, query]) => {
      const response = await listUsers({ query });
      if (response.error) {
        throw new Error(
          apiErrorMessage(response.error, t("admin-core:users.loadError")),
        );
      }
      const result = toPage(response);
      return {
        ...result,
        items: result.items.map((item): AdminUser => ({
          id: item.id,
          username: item.username,
          email: item.email,
          avatar_url: item.avatar_url,
          role: roleFromValue(item.role),
        })),
      };
    },
    { keepPreviousData: true },
  );
  const users = data?.items ?? null;
  const rows = users ?? [];

  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("admin-core:users.searchPlaceholder")}
          className="h-9 w-[240px] rounded-md border border-input bg-background pl-8 pr-3 text-sm"
        />
      </div>
      <Select
        items={[
          { value: "all", label: t("admin-core:users.roleFilter.all") },
          { value: "admin", label: t("common:roles.admin") },
          { value: "moderator", label: t("admin-core:users.roles.moderator") },
          { value: "user", label: t("common:roles.user") },
        ]}
        value={role}
        onValueChange={(value) => setRole(value as typeof role)}
      >
        <SelectTrigger className="w-[150px]">
          <span className="flex items-center gap-2">
            <Users className="size-4" />
            {role === "all"
              ? t("admin-core:users.roleFilter.all")
              : t(`admin-core:users.roles.${role}`)}
          </span>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">
            {t("admin-core:users.roleFilter.all")}
          </SelectItem>
          <SelectItem value="admin">{t("common:roles.admin")}</SelectItem>
          <SelectItem value="moderator">
            {t("admin-core:users.roles.moderator")}
          </SelectItem>
          <SelectItem value="user">{t("common:roles.user")}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );

  if (error) {
    return (
      <div className="text-sm text-destructive">
        {t("admin-core:users.loadError")}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">{t("common:nav.users")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("admin-core:users.description")}
          </p>
        </div>
        {controls}
      </div>

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <SortableTableHead column="username" sort={sort} onSort={toggle}>
                {t("common:roles.user")}
              </SortableTableHead>
              <SortableTableHead column="email" sort={sort} onSort={toggle}>
                {t("common:labels.email")}
              </SortableTableHead>
              <SortableTableHead column="role" sort={sort} onSort={toggle}>
                {t("common:labels.role")}
              </SortableTableHead>
              <TableHead className="text-right">
                {t("common:resources.manage")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!users ? (
              Array.from({ length: 4 }).map((_, index) => (
                <TableRow key={index}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Skeleton className="size-8 rounded-full" />
                      <Skeleton className="h-4 w-32" />
                    </div>
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-40" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-5 w-20" />
                  </TableCell>
                  <TableCell className="text-right">
                    <Skeleton className="ml-auto h-8 w-20" />
                  </TableCell>
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24">
                  <div className="flex flex-col items-center justify-center gap-2 text-center">
                    <Users className="size-5 text-muted-foreground" />
                    <p className="text-sm font-medium">
                      {t("admin-core:users.emptyState")}
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="size-8">
                        <AvatarImage
                          src={user.avatar_url}
                          alt={user.username}
                        />
                        <AvatarFallback className="text-xs">
                          {user.username.substring(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <Link
                          href={`/admin/users/${user.id}`}
                          className="text-sm font-medium hover:underline"
                        >
                          {user.username}
                        </Link>
                        <div className="font-mono text-xs text-muted-foreground">
                          {user.id}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {user.email}
                  </TableCell>
                  <TableCell>
                    <RoleBadge role={user.role} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      render={<Link href={`/admin/users/${user.id}`} />}
                      nativeButton={false}
                    >
                      {t("common:resources.manage")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <TablePagination
        page={page}
        total={data?.total ?? 0}
        totalPages={data?.totalPages ?? 1}
        onPageChange={setPage}
      />
    </div>
  );
}
