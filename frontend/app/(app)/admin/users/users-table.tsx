"use client";

import { Search, Shield, User, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import Link from "@/components/link";
import { getAllUsersAction } from "@/actions/users";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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

type UserRole = "admin" | "moderator" | "user";

type AdminUser = {
  id: number;
  username: string;
  email: string;
  role: UserRole;
};

function roleFromValue(role: number): UserRole {
  return role === 2 ? "admin" : role === 1 ? "moderator" : "user";
}

function RoleBadge({ role }: { role: UserRole }) {
  return (
    <Badge variant={role === "admin" ? "default" : "secondary"} className="gap-1">
      {role === "user" ? (
        <User className="size-3" />
      ) : (
        <Shield className="size-3" />
      )}
      {role.charAt(0).toUpperCase() + role.slice(1)}
    </Badge>
  );
}

export function UsersTable() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<"all" | UserRole>("all");

  const fetchUsers = useCallback(async () => {
    const result = await getAllUsersAction();
    if (!result.data?.success) {
      setError(true);
      return;
    }
    setUsers(
      (result.data.users ?? []).map((item) => ({
        id: item.id,
        username: item.username,
        email: item.email,
        role: roleFromValue(item.role),
      })),
    );
  }, []);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  const filtered = useMemo(() => {
    if (!users) return [];
    const normalized = query.trim().toLowerCase();
    return users.filter((user) => {
      if (role !== "all" && user.role !== role) return false;
      if (!normalized) return true;
      return (
        user.username.toLowerCase().includes(normalized) ||
        user.email.toLowerCase().includes(normalized)
      );
    });
  }, [users, query, role]);

  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by username or email..."
          className="h-9 w-[240px] rounded-md border border-input bg-background pl-8 pr-3 text-sm"
        />
      </div>
      <Select
        value={role}
        onValueChange={(value) => setRole(value as typeof role)}
      >
        <SelectTrigger className="w-[150px]">
          <span className="flex items-center gap-2">
            <Users className="size-4" />
            {role === "all"
              ? "All roles"
              : role.charAt(0).toUpperCase() + role.slice(1)}
          </span>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All roles</SelectItem>
          <SelectItem value="admin">Admin</SelectItem>
          <SelectItem value="moderator">Moderator</SelectItem>
          <SelectItem value="user">User</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );

  if (error) {
    return <div className="text-sm text-destructive">Failed to load users.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Users</h1>
          <p className="text-sm text-muted-foreground">
            Manage user accounts, roles, and organizations.
          </p>
        </div>
        {controls}
      </div>

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="text-right">Manage</TableHead>
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
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24">
                  <div className="flex flex-col items-center justify-center gap-2 text-center">
                    <Users className="size-5 text-muted-foreground" />
                    <p className="text-sm font-medium">No users found</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="size-8">
                        <AvatarFallback className="text-xs">
                          {user.username.substring(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm font-medium">
                        {user.username}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {user.email}
                  </TableCell>
                  <TableCell>
                    <RoleBadge role={user.role} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/admin/users/${user.id}`}>Manage</Link>
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
