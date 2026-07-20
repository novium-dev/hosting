"use client";

import Link from "@/components/link";
import { useMemo, useState } from "react";
import { FolderKanban, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ListProjectsResponses } from "@/lib/api";

type ProjectRow = ListProjectsResponses[200][number];

export function ProjectsTable({ projects }: { projects: ProjectRow[] }) {
  const [query, setQuery] = useState("");

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
              <TableHead className="text-right">Servers</TableHead>
              <TableHead className="text-right">Open</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredProjects.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-28">
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
                  <TableCell className="text-right tabular-nums">
                    {project.server_count}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/${project.slug}`}>Open</Link>
                    </Button>
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
