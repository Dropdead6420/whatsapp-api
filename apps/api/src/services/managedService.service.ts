import { prisma, ManagedServiceInterval, ManagedServiceStatus } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

// =====================================================================
// AdGrowly — Managed Services (agency service packages). Super-Admin curates
// the package catalog; an engagement is a customer's subscription to a package
// moving through a status lifecycle the agency fulfils. Price is snapshotted
// onto the engagement. Pure helpers (status state-machine, summary,
// projections) are unit-tested; DB ops are platform/agency-scoped.
// =====================================================================

interface PackageRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  category: string | null;
  priceCents: number | null;
  currency: string;
  interval: ManagedServiceInterval;
  deliverables: string[];
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

interface EngagementRow {
  id: string;
  tenantId: string;
  packageId: string;
  locationId: string | null;
  status: ManagedServiceStatus;
  notes: string | null;
  priceCentsSnapshot: number | null;
  currency: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  assignedToUserId: string | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toSafePackage(row: PackageRow) {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    category: row.category,
    priceCents: row.priceCents,
    currency: row.currency,
    interval: row.interval,
    deliverables: row.deliverables,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toSafeEngagement(row: EngagementRow) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    packageId: row.packageId,
    locationId: row.locationId,
    status: row.status,
    notes: row.notes,
    priceCentsSnapshot: row.priceCentsSnapshot,
    currency: row.currency,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    assignedToUserId: row.assignedToUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// Engagement lifecycle: which target statuses each status may move to.
const TRANSITIONS: Record<ManagedServiceStatus, ManagedServiceStatus[]> = {
  [ManagedServiceStatus.REQUESTED]: [ManagedServiceStatus.ACTIVE, ManagedServiceStatus.CANCELLED],
  [ManagedServiceStatus.ACTIVE]: [
    ManagedServiceStatus.PAUSED,
    ManagedServiceStatus.COMPLETED,
    ManagedServiceStatus.CANCELLED,
  ],
  [ManagedServiceStatus.PAUSED]: [ManagedServiceStatus.ACTIVE, ManagedServiceStatus.CANCELLED],
  [ManagedServiceStatus.COMPLETED]: [],
  [ManagedServiceStatus.CANCELLED]: [],
};

/** True when `to` is a permitted next status from `from` (no self-transition). */
export function canTransition(from: ManagedServiceStatus, to: ManagedServiceStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface EngagementSummary {
  total: number;
  requested: number;
  active: number;
  paused: number;
  completed: number;
  cancelled: number;
}

/** Count engagements by status for an agency dashboard. */
export function summarizeEngagements(rows: Array<{ status: ManagedServiceStatus }>): EngagementSummary {
  const s: EngagementSummary = { total: rows.length, requested: 0, active: 0, paused: 0, completed: 0, cancelled: 0 };
  for (const r of rows) {
    if (r.status === ManagedServiceStatus.REQUESTED) s.requested += 1;
    else if (r.status === ManagedServiceStatus.ACTIVE) s.active += 1;
    else if (r.status === ManagedServiceStatus.PAUSED) s.paused += 1;
    else if (r.status === ManagedServiceStatus.COMPLETED) s.completed += 1;
    else if (r.status === ManagedServiceStatus.CANCELLED) s.cancelled += 1;
  }
  return s;
}

// ---------------------------------------------------------------------
// Package catalog (SUPER_ADMIN)
// ---------------------------------------------------------------------

export interface ListPackagesFilter {
  category?: string;
  activeOnly?: boolean;
}

export async function listPackages(filter: ListPackagesFilter = {}) {
  const rows = await prisma.managedServicePackage.findMany({
    where: {
      ...(filter.category ? { category: filter.category } : {}),
      ...(filter.activeOnly ? { isActive: true } : {}),
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return rows.map(toSafePackage);
}

async function findPackageOrThrow(id: string) {
  const row = await prisma.managedServicePackage.findUnique({ where: { id } });
  if (!row) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Service package not found.");
  return row;
}

export interface CreatePackageInput {
  key: string;
  name: string;
  description?: string;
  category?: string;
  priceCents?: number;
  currency?: string;
  interval?: ManagedServiceInterval;
  deliverables?: string[];
  isActive?: boolean;
  sortOrder?: number;
}

export async function createPackage(input: CreatePackageInput) {
  const key = input.key.trim().toLowerCase();
  if (!key) throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "A package key is required.");
  const existing = await prisma.managedServicePackage.findUnique({ where: { key }, select: { id: true } });
  if (existing) throw new ApiError(ErrorCodes.CONFLICT, 409, `A package with key "${key}" already exists.`);
  const row = await prisma.managedServicePackage.create({
    data: {
      key,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      category: input.category?.trim() || null,
      priceCents: input.priceCents ?? null,
      currency: (input.currency || "USD").trim().toUpperCase(),
      interval: input.interval ?? ManagedServiceInterval.MONTHLY,
      deliverables: input.deliverables ?? [],
      isActive: input.isActive ?? true,
      sortOrder: input.sortOrder ?? 0,
    },
  });
  return toSafePackage(row);
}

export async function getPackage(id: string) {
  return toSafePackage(await findPackageOrThrow(id));
}

export interface UpdatePackageInput {
  name?: string;
  description?: string | null;
  category?: string | null;
  priceCents?: number | null;
  currency?: string;
  interval?: ManagedServiceInterval;
  deliverables?: string[];
  isActive?: boolean;
  sortOrder?: number;
}

export async function updatePackage(id: string, input: UpdatePackageInput) {
  await findPackageOrThrow(id);
  const row = await prisma.managedServicePackage.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.priceCents !== undefined ? { priceCents: input.priceCents } : {}),
      ...(input.currency !== undefined ? { currency: input.currency.trim().toUpperCase() } : {}),
      ...(input.interval !== undefined ? { interval: input.interval } : {}),
      ...(input.deliverables !== undefined ? { deliverables: input.deliverables } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    },
  });
  return toSafePackage(row);
}

export async function deletePackage(id: string) {
  await findPackageOrThrow(id);
  const count = await prisma.managedServiceEngagement.count({ where: { packageId: id } });
  if (count > 0) {
    throw new ApiError(
      ErrorCodes.CONFLICT,
      409,
      "Cannot delete a package with engagements — deactivate it instead.",
    );
  }
  await prisma.managedServicePackage.delete({ where: { id } });
}

// ---------------------------------------------------------------------
// Engagements (agency fulfilment)
// ---------------------------------------------------------------------

export interface ListEngagementsFilter {
  tenantId?: string;
  packageId?: string;
  status?: ManagedServiceStatus;
}

export async function listEngagements(filter: ListEngagementsFilter = {}) {
  const rows = await prisma.managedServiceEngagement.findMany({
    where: {
      ...(filter.tenantId ? { tenantId: filter.tenantId } : {}),
      ...(filter.packageId ? { packageId: filter.packageId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toSafeEngagement);
}

async function findEngagementOrThrow(id: string) {
  const row = await prisma.managedServiceEngagement.findUnique({ where: { id } });
  if (!row) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Engagement not found.");
  return row;
}

export interface CreateEngagementInput {
  tenantId: string;
  packageId: string;
  locationId?: string;
  notes?: string;
  assignedToUserId?: string;
  createdByUserId?: string;
}

export async function createEngagement(input: CreateEngagementInput) {
  const tenant = await prisma.tenant.findUnique({ where: { id: input.tenantId }, select: { id: true } });
  if (!tenant) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Customer not found.");
  const pkg = await findPackageOrThrow(input.packageId);
  if (!pkg.isActive) throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "That package is not active.");

  const row = await prisma.managedServiceEngagement.create({
    data: {
      tenantId: input.tenantId,
      packageId: input.packageId,
      locationId: input.locationId?.trim() || null,
      notes: input.notes?.trim() || null,
      priceCentsSnapshot: pkg.priceCents,
      currency: pkg.currency,
      assignedToUserId: input.assignedToUserId ?? null,
      createdByUserId: input.createdByUserId ?? null,
    },
  });
  return toSafeEngagement(row);
}

export async function getEngagement(id: string) {
  return toSafeEngagement(await findEngagementOrThrow(id));
}

export interface UpdateEngagementInput {
  status?: ManagedServiceStatus;
  notes?: string | null;
  assignedToUserId?: string | null;
}

export async function updateEngagement(id: string, input: UpdateEngagementInput) {
  const current = await findEngagementOrThrow(id);

  let startedAt: Date | undefined;
  let completedAt: Date | undefined;
  if (input.status !== undefined && input.status !== current.status) {
    if (!canTransition(current.status, input.status)) {
      throw new ApiError(
        ErrorCodes.BAD_REQUEST,
        400,
        `Cannot move an engagement from ${current.status} to ${input.status}.`,
      );
    }
    if (input.status === ManagedServiceStatus.ACTIVE && !current.startedAt) startedAt = new Date();
    if (input.status === ManagedServiceStatus.COMPLETED) completedAt = new Date();
  }

  const row = await prisma.managedServiceEngagement.update({
    where: { id },
    data: {
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.assignedToUserId !== undefined ? { assignedToUserId: input.assignedToUserId } : {}),
      ...(startedAt ? { startedAt } : {}),
      ...(completedAt ? { completedAt } : {}),
    },
  });
  return toSafeEngagement(row);
}

export async function deleteEngagement(id: string) {
  await findEngagementOrThrow(id);
  await prisma.managedServiceEngagement.delete({ where: { id } });
}

export async function getEngagementSummary(filter: ListEngagementsFilter = {}) {
  const rows = await prisma.managedServiceEngagement.findMany({
    where: {
      ...(filter.tenantId ? { tenantId: filter.tenantId } : {}),
      ...(filter.packageId ? { packageId: filter.packageId } : {}),
    },
    select: { status: true },
  });
  return summarizeEngagements(rows);
}
