"use client";

import Link from "@/components/link";
import { useMemo, useState } from "react";
import { Network, Search } from "lucide-react";
import useSWR from "swr";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listRegions, type ListNodesResponses } from "@/lib/api";
import { CreateNodeDialog } from "./create-nodes";

type NodeRow = ListNodesResponses[200][number];

export function NodesTable({ nodes }: { nodes: NodeRow[] }) {
  const [query, setQuery] = useState("");

  const { data: regions } = useSWR("admin/regions", async () => {
    const response = await listRegions();
    return response.error ? [] : (response.data ?? []);
  });

  const regionNames = useMemo(
    () =>
      new Map((regions ?? []).map((region) => [region.id, region.display])),
    [regions],
  );

  const filteredNodes = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return nodes;
    }

    return nodes.filter((node) => {
      return (
        node.display.toLowerCase().includes(normalizedQuery) ||
        node.id.toLowerCase().includes(normalizedQuery) ||
        node.default_host.toLowerCase().includes(normalizedQuery) ||
        (regionNames.get(node.region) ?? "")
          .toLowerCase()
          .includes(normalizedQuery)
      );
    });
  }, [nodes, query, regionNames]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Nodes</h1>
          <p className="text-sm text-muted-foreground">
            Browse node information and manage node-level ports.
          </p>
        </div>
        <CreateNodeDialog canCreate={true} />
      </div>

      <div className="relative w-full max-w-md">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by display, id, host, or region..."
          className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm"
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-muted">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead>Display</TableHead>
              <TableHead>Region</TableHead>
              <TableHead>Node ID</TableHead>
              <TableHead>Default Host</TableHead>
              <TableHead>Default Bind</TableHead>
              <TableHead>Ports</TableHead>
              <TableHead className="text-right">Manage</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredNodes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-28">
                  <div className="flex flex-col items-center justify-center gap-2 text-center">
                    <Network className="size-5 text-muted-foreground" />
                    <p className="text-sm font-medium">No nodes found</p>
                    <p className="text-xs text-muted-foreground">
                      Adjust your search query.
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filteredNodes.map((node) => (
                <TableRow key={node.id}>
                  <TableCell className="font-medium">{node.display}</TableCell>
                  <TableCell>
                    {regionNames.get(node.region) ?? node.region}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{node.id}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {node.default_host}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {node.default_bind}
                  </TableCell>
                  <TableCell>{node.ports.length}</TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/admin/nodes/${node.id}`}>Manage</Link>
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
