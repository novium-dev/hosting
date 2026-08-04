import type { DatabaseType, StoredInstanceCreate } from "@/lib/api";

type Preset = Pick<
  StoredInstanceCreate,
  | "image"
  | "image_uid"
  | "image_gid"
  | "socket_path"
  | "volumes"
  | "env"
  | "cmd"
>;

/**
 * Starting points for a new instance. The agent reaches the engine over the
 * unix socket at `socket_path`, so the container has to be told to put one
 * there — that is what the `cmd` overrides below are for.
 *
 * Only the postgres preset has been run end to end so far.
 */
export const INSTANCE_PRESETS: Record<DatabaseType, Preset> = {
  postgres: {
    image: "postgres:18-alpine",
    image_uid: 70,
    image_gid: 70,
    socket_path: "/var/run/postgresql/.s.PGSQL.5432",
    volumes: { data: "/var/lib/postgresql" },
    env: {
      POSTGRES_HOST_AUTH_METHOD: "trust",
      PGDATA: "/var/lib/postgresql/data",
    },
    cmd: null,
  },
  mariadb: {
    image: "mariadb:11",
    image_uid: 999,
    image_gid: 999,
    socket_path: "/run/mysqld/mysqld.sock",
    volumes: { data: "/var/lib/mysql" },
    env: { MARIADB_ALLOW_EMPTY_ROOT_PASSWORD: "1" },
    cmd: null,
  },
  mongodb: {
    image: "mongo:8",
    image_uid: 999,
    image_gid: 999,
    socket_path: "/run/mongodb/mongodb-27017.sock",
    volumes: { data: "/data/db" },
    env: {},
    // The agent refuses to relay unless mongod enforces authorization.
    cmd: ["mongod", "--auth", "--unixSocketPrefix=/run/mongodb"],
  },
  redis: {
    image: "redis:8-alpine",
    image_uid: 999,
    image_gid: 999,
    socket_path: "/run/redis/redis.sock",
    volumes: { data: "/data" },
    env: {},
    cmd: [
      "redis-server",
      "--unixsocket",
      "/run/redis/redis.sock",
      "--port",
      "0",
    ],
  },
};

export function parseEnv(value: string): Record<string, string> {
  return Object.fromEntries(
    value
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"))
      .flatMap((line) => {
        const index = line.indexOf("=");
        if (index <= 0) return [];
        return [
          [line.slice(0, index).trim(), line.slice(index + 1).trim()] as const,
        ];
      }),
  );
}

export function formatEnv(env: Record<string, string> | undefined) {
  return Object.entries(env ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}
