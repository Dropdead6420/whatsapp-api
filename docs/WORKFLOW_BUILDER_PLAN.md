# Workflow Builder — Implementation Plan (PDF Phase 5)

**Scope reference**: Claude FINAL PDF — No-Code Workflow Builder + Marketplace templates.  
**Current runtime**: `apps/api/src/services/flow/` + `FlowEditor.tsx` + `ChatbotFlow` / `FlowRun` models.

---

## T-060 — Event-driven flow triggers

### Goal

Flows can start on platform events, not only WhatsApp keywords.

### Trigger types (V1)

| `ChatbotFlow.trigger` | When to fire | `triggerKeywords` meaning |
| --- | --- | --- |
| `keyword` | Inbound WA text matches keyword | Keywords (existing) |
| `message_received` | Any inbound WA text (if no keyword flow matched) | ignored |
| `lead_created` | `POST /leads` succeeds | ignored |
| `tag_added` | Contact PATCH adds tag(s) | Optional: only fire if added tag ∈ list |
| `appointment_booked` | Public or admin booking created | ignored |

Deferred: `payment_completed`, `webhook_received`, `campaign_clicked` (need payment + inbound hook wiring).

### Service

`flowTrigger.service.ts`:

```ts
dispatchFlowTriggers({
  tenantId,
  trigger,
  contactId?,
  conversationId?,
  triggerText?,
  tag?,           // tag_added only
  initialVars?,
}): Promise<void>
```

- Loads `ChatbotFlow` where `{ tenantId, isActive: true, trigger }`.
- For `tag_added`, skip flows whose `triggerKeywords` is non-empty and does not include `tag`.
- Calls `startFlowRun` for each match (max 5 per event to avoid storms).
- Never throws to caller — log errors.

### Wire points

| Location | Event |
| --- | --- |
| `whatsapp.routes.ts` inbound | After keyword check: `message_received` if no keyword flow |
| `leads.routes.ts` create | `lead_created` |
| `contacts.routes.ts` PATCH | Diff tags → `tag_added` per new tag |
| `appointments.routes.ts` create | `appointment_booked` |

### API / validation

Extend `createFlowSchema.trigger` enum in `flows.routes.ts`.

### Tests

- Unit: tag filter, max cap, inactive flows skipped
- Integration: lead create enqueues run (mock `startFlowRun`)

### UI (follow-up T-060b)

Flows create/edit: trigger dropdown + keyword/tag inputs.

---

## T-061 — Action nodes: SEND_TEMPLATE, CREATE_LEAD

### SEND_TEMPLATE

**Config**: `templateName`, `languageCode` (default `en`), `bodyParams?: string[]` (interpolated), `headerParam?`  
**Behavior**: Resolve contact phone, `assertCanAffordMessage` + `sendWhatsAppTemplate` + `recordSend` + optional `debitMessage` (same as MESSAGE).  
**Skip** if opted out or no WABA.

### CREATE_LEAD

**Config**: `title` (interpolated), `source?` (default `workflow`), `status?` (default `NEW`)  
**Behavior**: `prisma.lead.create` scoped `tenantId`, link `contactId` from ctx, emit `LEAD_CREATED` webhook (existing).  
**Guard**: Do not create duplicate if `contactId` already has open lead (optional V1: always create).

### Registry

Add handlers in `nodes.ts`; expose in `listNodeTypes()`; add FlowEditor config panels.

---

## T-062 — Logic nodes (batch 2)

Priority order:

1. `WAIT_FOR_REPLY` — set run WAITING, store `currentNodeId`, resume on next inbound for same conversation (new engine hook).
2. `SWITCH` — `config.field` + `branches` map (like CONDITION but multi-way).
3. `FILTER` — stop run if contact doesn't match tag/stage predicate.

---

## T-050 — AI workflow nodes (batch 3)

One PR per node family; all call `callLlmJson` with feature flag + wallet debit:

- `AI_CLASSIFY_INTENT` → branch key in `branches`
- `AI_SUMMARIZE`, `AI_EXTRACT_DATA`, `AI_TRANSLATE` → write to `ctx.vars`
- `AI_COMPLIANCE_CHECK` → abort run if high risk
- `AI_ROUTE_BEST_AGENT` → pick agent id → AGENT_TRANSFER

---

## T-142 — Marketplace templates

**Schema**:

```prisma
model FlowTemplate {
  id          String   @id @default(cuid())
  slug        String   @unique
  name        String
  industry    String
  description String?
  definition  String   // JSON FlowDefinition
  isPublic    Boolean  @default(true)
}
```

**API**: `GET /api/v1/flow-templates`, `POST /api/v1/flows/from-template/:slug` (clone into tenant, inactive by default).

**Seed**: salon booking, clinic reminders, e-commerce tracking, real estate, coaching, payment follow-up (from PDF list).

---

## Acceptance criteria (Phase 5 “done”)

- [ ] All V1 triggers fire from real product events
- [ ] SEND_TEMPLATE + CREATE_LEAD in editor palette and runtime
- [ ] WAIT_FOR_REPLY works end-to-end on inbox reply
- [ ] At least 3 marketplace templates installable per tenant
- [ ] Tests: trigger dispatch + SEND_TEMPLATE skip on opt-out
- [ ] `TASKS.md` + `BLUEPRINT_PHASE_AUDIT.md` updated
