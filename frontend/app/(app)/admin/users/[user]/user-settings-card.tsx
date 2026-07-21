"use client";

import { useState } from "react";
import { toast } from "sonner";

import { updateUser } from "@/lib/api";
import type { GetUserResponse } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

export function UserSettingsCard({
  user,
  canManage,
  onUpdated,
}: {
  user: GetUserResponse;
  canManage: boolean;
  onUpdated: () => void;
}) {
  const [username, setUsername] = useState(user.username);
  const [email, setEmail] = useState(user.email);
  const [role, setRole] = useState(String(user.role));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const response = await updateUser({
      path: { user_id: user.id },
      body: {
        username:
          username.trim() !== user.username ? username.trim() : undefined,
        email: email.trim() !== user.email ? email.trim() : undefined,
        role: Number(role) !== user.role ? Number(role) : undefined,
      },
    }).finally(() => setSaving(false));

    if (response.error) {
      toast.error("Failed to update user");
      return;
    }

    toast.success("User updated");
    onUpdated();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>User settings</CardTitle>
        <CardDescription>
          Update this user&apos;s account details and role.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="user-username">Username</Label>
            <Input
              id="user-username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              disabled={!canManage}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="user-email">Email</Label>
            <Input
              id="user-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={!canManage}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="user-role">Role</Label>
            <Select value={role} onValueChange={setRole} disabled={!canManage}>
              <SelectTrigger id="user-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">User</SelectItem>
                <SelectItem value="1">Moderator</SelectItem>
                <SelectItem value="2">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
      <Separator />
      <CardFooter className="flex flex-row items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {canManage
            ? "Changes apply immediately."
            : "You need the Users: Manage permission to edit."}
        </p>
        <Button
          size="sm"
          onClick={handleSave}
          loading={saving}
          disabled={!canManage}
        >
          Save changes
        </Button>
      </CardFooter>
    </Card>
  );
}
