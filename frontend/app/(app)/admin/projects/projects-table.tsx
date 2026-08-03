"use client";

import Link from "@/components/link";
import { useMemo, useState } from "react";
import { FlaskConical, FolderKanban, Search } from "lucide-react";
import { toast } from "sonner";

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
import {
  setProjectFeatures,
  type ListProjectFeaturesResponses,
  type ListProjectsResponses,
  type ProjectFeature,
} from "@/lib/api";

type ProjectRow = ListProjectsResponses[200][number];
type FeatureRow = ListProjectFeaturesResponses[200][number];

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
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<ProjectRow | null>(null);

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
        project.slug.toLowerCase().includes(normalizedQuery) ||
        project.owner_username.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [projects, query]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Projects</h1>
        <p className="text-sm text-muted-foreground">
          Browse projects available to the current admin session.
        </p>
      </div>

      <div className="relative w-full max-w-md">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by project, slug, or owner..."
          className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm"
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-muted">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Features</TableHead>
              <TableHead className="text-right">Servers</TableHead>
              <TableHead className="text-right">Manage</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredProjects.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-28">
                  <div className="flex flex-col items-center justify-center gap-2 text-center">
                    <FolderKanban className="size-5 text-muted-foreground" />
                    <p className="text-sm font-medium">No projects found</p>
                    <p className="text-xs text-muted-foreground">
                      Adjust your search query.
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filteredProjects.map((project) => (
                <TableRow key={project.id}>
                  <TableCell className="font-medium">{project.name}</TableCell>
                  <TableCell>{project.slug}</TableCell>
                  <TableCell>{project.owner_username}</TableCell>
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
                          Features
                        </Button>
                      ) : null}
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/${project.slug}`}>Open</Link>
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
        toast.error(response.error.error?.msg ?? "Failed to save features");
        return;
      }

      toast.success("Feature flags updated");
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
          <DialogTitle>Feature flags</DialogTitle>
          <DialogDescription>
            {project
              ? `Enable early-stage features for "${project.name}".`
              : null}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {features.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This instance has no feature flags.
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
            Cancel
          </Button>
          <Button
            type="button"
            loading={isPending}
            onClick={() => {
              void handleSave();
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
