"use client";

import Link from "@/components/link";
import { useMemo, useState } from "react";
import { FlaskConical, FolderKanban, Search } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { SortableTableHead } from "@/components/sortable-table-head";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTableSort } from "@/hooks/use-table-sort";
import { authClient } from "@/lib/auth-client";
import {
  hasManagementPermission,
  ManagementPermission,
} from "@/lib/permissions";
import {
  setProjectFeatures,
  type ListProjectFeaturesResponses,
  type ListProjectsResponses,
  type ProjectFeature,
} from "@/lib/api";

type ProjectRow = ListProjectsResponses[200][number];
type FeatureRow = ListProjectFeaturesResponses[200][number];

type ProjectColumn = "name" | "slug" | "owner" | "servers";

export function ProjectsTable({
  projects,
  features,
  canManageFeatures,
  onChanged,
}: {
  projects: ProjectRow[];
  features: FeatureRow[];
  canManageFeatures: boolean;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const { data: session } = authClient.useSession();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<ProjectRow | null>(null);

  const canViewUsers = session
    ? hasManagementPermission(
        session.user.permissions,
        ManagementPermission.USER_VIEW,
      )
    : false;

  const featureNames = useMemo(
    () => new Map(features.map((feature) => [feature.id, feature.display])),
    [features],
  );

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
      <div>
        <h1 className="text-xl font-semibold">
          {t("common:nav.projects")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("admin-core:projects.description")}
        </p>
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
              <TableHead>{t("admin-core:projects.table.features")}</TableHead>
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
                <TableCell colSpan={6} className="h-28">
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
                  <TableCell>
                    {project.features.length === 0 ? (
                      <span className="text-xs text-muted-foreground">--</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {project.features.map((feature) => (
                          <Badge key={feature} variant="secondary">
                            {featureNames.get(feature) ?? feature}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {project.server_count}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {canManageFeatures ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setEditing(project)}
                        >
                          <FlaskConical data-icon="inline-start" />
                          {t("admin-core:projects.featuresButton")}
                        </Button>
                      ) : null}
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/${project.slug}`}>
                          {t("admin-core:shared.open")}
                        </Link>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <ProjectFeaturesDialog
        key={editing?.id ?? "none"}
        project={editing}
        features={features}
        onOpenChange={(next) => {
          if (!next) setEditing(null);
        }}
        onSaved={onChanged}
      />
    </div>
  );
}

function ProjectFeaturesDialog({
  project,
  features,
  onOpenChange,
  onSaved,
}: {
  project: ProjectRow | null;
  features: FeatureRow[];
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState<ProjectFeature[]>(
    project?.features ?? [],
  );
  const [isPending, setIsPending] = useState(false);

  const toggle = (feature: ProjectFeature, next: boolean) => {
    setEnabled((previous) =>
      next
        ? [...previous, feature]
        : previous.filter((entry) => entry !== feature),
    );
  };

  const handleSave = async () => {
    if (!project) return;

    setIsPending(true);
    try {
      const response = await setProjectFeatures({
        path: { project_id: project.id },
        body: { features: enabled },
      });

      if (response.error) {
        toast.error(
          response.error.error?.msg ??
            t("admin-core:projects.toast.featuresSaveFailed"),
        );
        return;
      }

      toast.success(t("admin-core:projects.toast.featuresSaved"));
      onOpenChange(false);
      onSaved();
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Dialog open={project !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("admin-core:projects.featuresDialog.title")}</DialogTitle>
          <DialogDescription>
            {project
              ? t("admin-core:projects.featuresDialog.description", {
                  name: project.name,
                })
              : null}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {features.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("admin-core:projects.featuresDialog.noFeatures")}
            </p>
          ) : (
            features.map((feature) => (
              <Label
                key={feature.id}
                className="flex items-start gap-3 rounded-md border p-3 font-normal"
              >
                <Checkbox
                  checked={enabled.includes(feature.id)}
                  onCheckedChange={(checked) =>
                    toggle(feature.id, checked === true)
                  }
                />
                <div className="space-y-1">
                  <p className="text-sm font-medium">{feature.display}</p>
                  <p className="text-xs text-muted-foreground">
                    {feature.description}
                  </p>
                </div>
              </Label>
            ))
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t("common:actions.cancel")}
          </Button>
          <Button
            type="button"
            loading={isPending}
            onClick={() => {
              void handleSave();
            }}
          >
            {t("common:actions.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
