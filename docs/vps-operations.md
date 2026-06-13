# VPS Operations

This project runs the live NexaFlow stack on the Hostinger VPS at `187.127.172.138`.

## Verify Production Health

Run the full VPS verification from a trusted machine with SSH access:

```bash
npm run vps:verify
```

For authenticated admin API checks, provide credentials through environment variables:

```bash
NEXAFLOW_ADMIN_EMAIL='admin@example.com' \
NEXAFLOW_ADMIN_PASSWORD='...' \
npm run vps:smoke
```

Do not commit real passwords, API keys, or tokens.

## What The Checks Cover

`npm run vps:schema-check`

- SSHes into the VPS.
- Reads `/opt/medscub/packages/db/prisma/schema.prisma`.
- Compares every Prisma model table with live Postgres tables in `medscub-postgres`.
- Fails if any Prisma-backed table is missing.

`npm run vps:smoke`

- Checks public web routes.
- Optionally logs in and checks authenticated admin API routes.
- Reads recent `medscub-api` logs for fresh internal server errors, Prisma missing-table errors, and unhandled errors.

## Safe Migration Flow

Before applying production migrations:

1. Back up Postgres.
2. Apply only reviewed migration SQL from `/opt/medscub/packages/db/prisma/migrations`.
3. Restart `medscub-api` and `medscub-worker`.
4. Run `npm run vps:verify`.

The VPS is small, so avoid heavy Docker builds directly on the server during traffic. Prefer building images off-box or ensure swap/RAM is sufficient before running full rebuilds.
