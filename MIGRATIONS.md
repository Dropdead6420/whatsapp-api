# Migrations

Prisma schema lives at `packages/db/prisma/schema.prisma`.

Migration rules:

- Development may use schema validation and generated clients, but production deploys must use Prisma migrations.
- Do not edit generated SQL by hand unless a migration explicitly requires a reviewed manual step.
- Any schema change that affects tenant-owned data must preserve tenant isolation indexes and cascade behavior.
- Any change touching wallet, compliance, provider credentials, auth, or audit data must include a migration note in the implementation handoff.
