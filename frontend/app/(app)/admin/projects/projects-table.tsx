"use client";

import Link from "@/components/link";
import { useMemo, useState } from "react";
import { FolderKanban, Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import { SortableTableHead } from "@/components/sortable-table-head";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTableSort } from "@/hooks/use-table-sort";
import type { ProjectOwnerOption } from "@/components/create-project-form";
import { CreateProjectDialog } from "./create-project-dialog";
import { authClient } from "@/lib/auth-client";
import {
  hasManagementPermission,
  ManagementPermission,
} from "@/lib/permissions";
import { type ListProjectsResponses } from "@/lib/api";

type ProjectRow = ListProjectsResponses[200][number];

type ProjectColumn = "name" | "slug" | "owner" | "servers";

export function ProjectsTable({
  projects,
  owners,
  onChanged,
}: {
  projects: ProjectRow[];
  owners: ProjectOwnerOption[] | null;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const { data: session } = authClient.useSession();
  const [query, setQuery] = useState("");

  const canViewUsers = session
    ? hasManagementPermission(
        session.user.permissions,
        ManagementPermission.USER_VIEW,
      )
    : false;

  const filteredProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return projects;
    }

    return projects.filter((project) => {
      return (
        project.name.toLowerCase().includes(normalizedQuery) ||
        project.id.toLowerCase().includes(normalizedQuery) ||
        project.slug.toLowerCase().includes(normalizedQuery) ||
        project.owner_username.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [projects, query]);

  const accessors = useMemo(
    () => ({
      name: (project: ProjectRow) => project.name,
      slug: (project: ProjectRow) => project.slug,
      owner: (project: ProjectRow) => project.owner_username,
      servers: (project: ProjectRow) => project.server_count,
    }),
    [],
  );

  const { rows, sort, toggle } = useTableSort<ProjectRow, ProjectColumn>(
    filteredProjects,
    accessors,
    { column: "name", direction: "asc" },
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t("common:nav.projects")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("admin-core:projects.description")}
          </p>
        </div>
        {owners ? (
          <CreateProjectDialog owners={owners} onCreated={onChanged} />
        ) : null}
      </div>

      <div className="relative w-full max-w-md">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("admin-core:projects.searchPlaceholder")}
          className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm"
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-muted">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <SortableTableHead column="name" sort={sort} onSort={toggle}>
                {t("common:labels.name")}
              </SortableTableHead>
              <SortableTableHead column="slug" sort={sort} onSort={toggle}>
                {t("admin-core:shared.slugColumn")}
              </SortableTableHead>
              <SortableTableHead column="owner" sort={sort} onSort={toggle}>
                {t("common:labels.owner")}
              </SortableTableHead>
              <SortableTableHead
                column="servers"
                sort={sort}
                onSort={toggle}
                align="right"
              >
                {t("common:nav.servers")}
              </SortableTableHead>
              <TableHead className="text-right">
                {t("common:resources.manage")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-28">
                  <div className="flex flex-col items-center justify-center gap-2 text-center">
                    <FolderKanban className="size-5 text-muted-foreground" />
                    <p className="text-sm font-medium">
                      {t("admin-core:projects.emptyState.title")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("admin-core:projects.emptyState.description")}
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((project) => (
                <TableRow key={project.id}>
                  <TableCell>
                    <Link
                      href={`/${project.slug}`}
                      className="font-medium hover:underline"
                    >
                      {project.name}
                    </Link>
                    <div className="font-mono text-xs text-muted-foreground">
                      {project.id}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {project.slug}
                  </TableCell>
                  <TableCell>
                    {canViewUsers ? (
                      <Link
                        href={`/admin/users/${project.owner}`}
                        className="hover:underline"
                      >
                        {project.owner_username}
                      </Link>
                    ) : (
                      project.owner_username
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {project.server_count}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        render={<Link href={`/${project.slug}`} />}
                        nativeButton={false}
                      >
                        {t("admin-core:shared.open")}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
