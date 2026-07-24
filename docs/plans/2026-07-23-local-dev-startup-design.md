# Local development startup design

## Goal

`npm run dev` must bring up a usable local application without requiring a
separate database command. Existing PostgreSQL data must remain in the named
`pgdata` volume.

## Chosen approach

Keep Docker Compose responsible for PostgreSQL, Redis, and draw.io, while the
application services continue to run on the host with hot reload. The startup
script starts the infrastructure, waits for PostgreSQL readiness, applies the
non-destructive SmartDiagram schema bootstrap, creates the independent
`ppt_agent` database idempotently, and applies committed Prisma migrations.
Only then does it start the backend, PPT services, and Vite frontend.

This is preferred over requiring developers to remember `npm run db:up`,
because a partially started application currently looks healthy while login
requests fail later. Running every service in Docker was also rejected for the
normal development path because it would lose the existing host-side hot
reload workflow.

## Failure and data-safety behavior

Docker or PostgreSQL failures stop startup immediately with Compose status and
the latest database logs. The script never runs `docker compose down -v`,
prunes volumes, or recreates the `pgdata` volume. Compose may replace a stale
database container when its image changes, but it mounts the same named volume.
Both database initialization steps are additive/idempotent and do not delete
existing tables or rows.

## Verification

Static safety tests assert the startup order, readiness gate, diagnostic output,
and absence of volume deletion. The local smoke check then verifies PostgreSQL
readiness, both database migrations, and the health endpoints after startup.
