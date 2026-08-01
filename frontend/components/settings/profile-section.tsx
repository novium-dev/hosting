"use client";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

const roleLabels: Record<string, string> = {
  admin: "Admin",
  moderator: "Moderator",
  user: "User",
};

export function ProfileSection() {
  const { data: session } = authClient.useSession();
  const user = session?.user;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="settings-username">Username</Label>
        <Input
          id="settings-username"
          value={user?.name ?? ""}
          readOnly
          disabled
        />
        <p className="text-sm text-muted-foreground">
          Your username cannot be changed.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="settings-email">Email</Label>
        <Input
          id="settings-email"
          type="email"
          value={user?.email ?? ""}
          readOnly
          disabled
        />
        <p className="text-sm text-muted-foreground">
          Account details come from your identity provider and are read-only
          here.
        </p>
      </div>

      <div className="space-y-2">
        <Label>Role</Label>
        <div>
          <Badge variant="secondary">
            {roleLabels[user?.role ?? "user"] ?? "User"}
          </Badge>
        </div>
      </div>
    </div>
  );
}
