# Deploy with PostgreSQL on the Docker host

Use this mode when the destination server already runs PostgreSQL. The Compose
`db` service is a PostgreSQL **client** container for `pg_dump`, `pg_restore`,
and readiness checks; it does not start another database or mount `pgdata`.
The application and its Redis, web, and PPT services remain in Docker.

## Requirements

- PostgreSQL 18 with `pgvector` 0.8.6 installed on the host. A dump from the
  existing PostgreSQL 16 server can be restored with the newer client.
- An empty `smartdiagram` database and an empty `ppt_agent` database, both
  owned by a dedicated login role. Keep that role separate from the host's
  other applications.
- A fixed Docker bridge network named `smartdiagram_hostdb`. By default,
  `host-db.sh` creates it as `172.30.77.0/24`; set `HOST_DB_DOCKER_SUBNET`
  before the first run if that range conflicts with an existing network.
- Host PostgreSQL listens on its local Docker gateway address, normally
  `172.17.0.1`, as well as localhost. Add a `pg_hba.conf` rule limited to the
  dedicated role, the two databases, and the fixed Docker subnet. Keep port
  5432 closed to the public network.
- The host PostgreSQL Unix socket directory (usually `/tmp`) must be
  accessible to the client container. Set `HOST_POSTGRES_UID` to the UID of
  the host `postgres` user; local socket authentication must permit it.

Set these values in the destination root `.env`:

```env
DB_PASSWORD=<password of dedicated login role>
HOST_DB_USER=smartdiagram_app
HOST_POSTGRES_UID=<uid of host postgres user>
HOST_POSTGRES_PORT=5432
HOST_POSTGRES_SOCKET_DIR=/tmp
```

Keep `DIAGRAM_DATABASE_URL` and `DATABASE_URL` pointed at their respective
databases with the same role and password. The Compose override replaces the
host part of those URLs inside containers with `host.docker.internal`.

## Migrate from the old server

1. Copy the old project directory to the destination without historical
   `backups/` or generated migration bundles. Preserve `.env` and server-local
   changes.
2. On the old server, run `./migrate.sh export --low-mem --keep-stopped` for a
   consistent final snapshot. This stops application writers and leaves them
   stopped until the new deployment is verified.
3. Transfer the bundle over SSH and compare SHA-256 checksums.
4. On the destination, run `./host-db.sh restore /path/to/bundle.tar.gz`.
   The restore keeps the destination `.env`, skips cluster-wide roles from the
   old server, restores both databases as `HOST_DB_USER`, restores file volumes,
   and deploys the application with a worker.
5. Check `./host-db.sh deploy --status`, `http://127.0.0.1:9237/api/health`,
   and `http://127.0.0.1:9237/ppt-api/api/health` on the destination. Compare
   row counts and user-file checksums with the source snapshot before changing
   the public reverse proxy or DNS.

For later updates, run `./host-db.sh deploy --with-worker`. Its backup includes
both application databases and user-file volumes. It intentionally omits
cluster-wide role definitions from the shared host PostgreSQL server.

If deployment fails, leave the old server and its backup intact. Restoring a
bundle resets the `public` schemas of the two destination databases, so do not
run it against databases containing unrelated data.
