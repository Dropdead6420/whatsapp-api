# API

NexaFlow exposes tenant-scoped internal APIs under `/api/v1/*` and public/partner-facing APIs through the route modules in `apps/api/src/routes`.

Current API conventions:

- All protected routes use `requireAuth`, tenant scope, RBAC permissions, feature flags where applicable, and Zod validation.
- List endpoints should provide pagination or an explicit bounded `limit`.
- Mutations that affect status, money, permissions, provider credentials, or compliance must write audit logs.
- Public webhook/API surfaces verify signatures or API keys before side effects.

Developer API implementation currently lives in `apps/api/src/routes/public-api.routes.ts` and API key management in `apps/api/src/routes/api-keys.routes.ts`.
