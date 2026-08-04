import type { DatabaseType } from "@/lib/api";

export const DATABASE_TYPE_LABELS: Record<DatabaseType, string> = {
  postgres: "PostgreSQL",
  mariadb: "MariaDB",
  mongodb: "MongoDB",
  redis: "Redis",
};

/** Redis has no named databases, so its connection details omit one. */
export function hasNamedDatabases(type: DatabaseType) {
  return type !== "redis";
}
