import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";
import ProfileAuthCard from "./profile-auth-card";

export default function ProfilePage() {
  const { data: session } = authClient.useSession();

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Profile Info</CardTitle>
          <CardDescription>
            Account details are read-only in this workspace.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Name</p>
            <p className="text-sm font-medium">{session?.user.name ?? "-"}</p>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Email</p>
            <p className="text-sm font-medium">{session?.user.email ?? "-"}</p>
          </div>
        </CardContent>
      </Card>

      <ProfileAuthCard />
    </div>
  );
}
