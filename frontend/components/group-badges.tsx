import { Badge } from "@/components/ui/badge";

export function GroupBadges({ groups }: { groups: string[] }) {
  if (groups.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {groups.map((group) => (
        <Badge key={group} variant="outline" className="font-mono text-xs">
          {group}
        </Badge>
      ))}
    </div>
  );
}
