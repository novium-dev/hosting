"use client";

import { useMemo, useState } from "react";
import { Globe2, PencilIcon, PlusIcon, Search, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
  createRegion,
  deleteRegion,
  updateRegion,
  type ListRegionsResponses,
} from "@/lib/api";

type RegionRow = ListRegionsResponses[200][number];

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function RegionsTable({
  regions,
  canManage,
  onChanged,
}: {
  regions: RegionRow[];
  canManage: boolean;
  onChanged: () => void;
}) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<RegionRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<RegionRow | null>(null);
  const [isDeletePending, setIsDeletePending] = useState(false);

  const filteredRegions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return regions;
    }

    return regions.filter(
      (region) =>
        region.display.toLowerCase().includes(normalizedQuery) ||
        region.slug.toLowerCase().includes(normalizedQuery) ||
        region.id.toLowerCase().includes(normalizedQuery),
    );
  }, [regions, query]);

  const handleDelete = async () => {
    if (!deleting) return;

    setIsDeletePending(true);
    try {
      const response = await deleteRegion({
        path: { region_id: deleting.id },
      });

      if (response.error) {
        toast.error(response.error.error?.msg ?? "Failed to delete region");
        return;
      }

      toast.success("Region deleted");
      setDeleting(null);
      onChanged();
    } finally {
      setIsDeletePending(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Regions</h1>
          <p className="text-sm text-muted-foreground">
            Group nodes by location. Every node belongs to exactly one region.
          </p>
        </div>
        {canManage ? (
          <Button type="button" onClick={() => setCreating(true)}>
            <PlusIcon data-icon="inline-start" />
            Create Region
          </Button>
        ) : null}
      </div>

      <div className="relative w-full max-w-md">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name, slug, or id..."
          className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm"
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-muted">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Region ID</TableHead>
              <TableHead>Nodes</TableHead>
              <TableHead className="text-right">Manage</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRegions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-28">
                  <div className="flex flex-col items-center justify-center gap-2 text-center">
                    <Globe2 className="size-5 text-muted-foreground" />
                    <p className="text-sm font-medium">No regions found</p>
                    <p className="text-xs text-muted-foreground">
                      Create a region before registering a node.
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filteredRegions.map((region) => (
                <TableRow key={region.id}>
                  <TableCell className="font-medium">
                    {region.display}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {region.slug}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {region.id}
                  </TableCell>
                  <TableCell>{region.node_count}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        disabled={!canManage}
                        onClick={() => setEditing(region)}
                      >
                        <PencilIcon className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        disabled={!canManage || region.node_count > 0}
                        onClick={() => setDeleting(region)}
                      >
                        <Trash2Icon className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <RegionFormDialog
        key={editing?.id ?? "create"}
        open={creating || editing !== null}
        region={editing}
        onOpenChange={(next) => {
          if (!next) {
            setCreating(false);
            setEditing(null);
          }
        }}
        onSaved={onChanged}
      />

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(next) => {
          if (!next) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete region</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting
                ? `"${deleting.display}" will be removed permanently. Nodes must be moved to another region first.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletePending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleDelete();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function RegionFormDialog({
  open,
  region,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  region: RegionRow | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [display, setDisplay] = useState(region?.display ?? "");
  const [slug, setSlug] = useState(region?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(region !== null);
  const [isPending, setIsPending] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedDisplay = display.trim();
    const normalizedSlug = slugify(slug.trim());

    if (normalizedSlug === "") {
      toast.error("Slug must contain lowercase letters, numbers or hyphens");
      return;
    }

    setIsPending(true);
    try {
      const response = region
        ? await updateRegion({
            path: { region_id: region.id },
            body: { display: trimmedDisplay, slug: normalizedSlug },
          })
        : await createRegion({
            body: { display: trimmedDisplay, slug: normalizedSlug },
          });

      if (response.error) {
        toast.error(response.error.error?.msg ?? "Failed to save region");
        return;
      }

      toast.success(region ? "Region updated" : "Region created");
      onOpenChange(false);
      onSaved();
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="space-y-6">
          <DialogHeader>
            <DialogTitle>{region ? "Edit region" : "Create region"}</DialogTitle>
            <DialogDescription>
              Regions group nodes so servers can later be placed by location.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="region-display">Name</Label>
              <Input
                id="region-display"
                value={display}
                onChange={(event) => {
                  setDisplay(event.target.value);
                  if (!slugTouched) setSlug(slugify(event.target.value));
                }}
                placeholder="Europe (Frankfurt)"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="region-slug">Slug</Label>
              <Input
                id="region-slug"
                value={slug}
                onChange={(event) => {
                  setSlugTouched(true);
                  setSlug(event.target.value);
                }}
                placeholder="eu-frankfurt"
                required
              />
              <p className="text-xs text-muted-foreground">
                Lowercase letters, numbers and hyphens only.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" loading={isPending}>
              {region ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
