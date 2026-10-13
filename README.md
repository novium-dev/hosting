# novium

A game server hosting platform: a panel to manage game servers, nodes and databases.

- `backend/` - Axum API. Postgres is the source of truth, Valkey holds cache and short-lived shared state. Talks to nodes and database hosts over mTLS.
- `frontend/` - Vite + React SPA.
- `database_agent/` - runs database engines in Docker and proxies them on shared ports.
- `database_agent_common/` - DTOs, service traits and the SDK the backend uses to talk to the agent.

## Getting started

See [`CLAUDE.md`](CLAUDE.md) for the development commands and project conventions, and [`deploy/README.md`](deploy/README.md) for running the stack.

The backend also builds against [`daemon`](https://github.com/novium-dev/daemon) and [`zelus_keys`](https://github.com/novium-dev/zelus_keys), which live in their own repositories.

## License

This project is source available, not open source.

| Path | License |
| --- | --- |
| everything except the two below | [PolyForm Noncommercial 1.0.0](LICENSE) |
| `database_agent/` | [MIT](database_agent/LICENSE) |
| `database_agent_common/` | [MIT](database_agent_common/LICENSE) |

The database agent is largely inspired by [calagopus/db-agent](https://github.com/calagopus/db-agent) (MIT), so it keeps the MIT license and its copyright notice.

Third-party content under `.claude/` keeps its own license.

## Security

Please report vulnerabilities privately to the maintainers instead of opening a public issue.
