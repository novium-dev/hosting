import { Badge } from "@/components/ui/badge";

import type { GroupRef } from "@/lib/api";

export function GroupBadges({ groups }: { groups: GroupRef[] }) {
  if (groups.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {groups.map((group) => (
        <Badge key={group.id} variant="outline" className="text-xs">
          {group.label}
        </Badge>
      ))}
    </div>
  );
}
