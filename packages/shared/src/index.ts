// Shared types across NexaFlow AI platform

// ============================================================================
// USER & AUTH TYPES
// ============================================================================

export enum UserRole {
  SUPER_ADMIN = "SUPER_ADMIN",
  WHITE_LABEL_ADMIN = "WHITE_LABEL_ADMIN",
  BUSINESS_ADMIN = "BUSINESS_ADMIN",
  TEAM_LEAD = "TEAM_LEAD",
  AGENT = "AGENT",
}

export enum UserStatus {
  ACTIVE = "ACTIVE",
  PENDING_EMAIL_VERIFICATION = "PENDING_EMAIL_VERIFICATION",
  SUSPENDED = "SUSPENDED",
  DELETED = "DELETED",
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  tenantId?: string;
  emailVerified?: Date;
  twoFactorEnabled: boolean;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthSession {
  user: User;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

// ============================================================================
// TENANT TYPES
// ============================================================================

export enum TenantType {
  DIRECT = "DIRECT",
  WHITE_LABEL = "WHITE_LABEL",
  BUSINESS = "BUSINESS",
}

export enum TenantStatus {
  ACTIVE = "ACTIVE",
  SUSPENDED = "SUSPENDED",
  DELETED = "DELETED",
}

export interface Tenant {
  id: string;
  name: string;
  type: TenantType;
  status: TenantStatus;
  domain?: string;
  parentTenantId?: string;
  logoUrl?: string;
  brandColors?: Record<string, string>;
  customCss?: string;
  messageQuotaPerMonth: number;
  contactLimit: number;
  agentLimit: number;
  aiCreditsPerMonth: number;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// CONTACT & LEAD TYPES
// ============================================================================

export interface Contact {
  id: string;
  tenantId: string;
  phoneNumber: string;
  name: string;
  email?: string;
  tags: string[];
  customFields?: Record<string, any>;
  optedOut: boolean;
  aiScore?: number;
  lastInteractionAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export enum LeadStatus {
  NEW = "NEW",
  QUALIFIED = "QUALIFIED",
  NEGOTIATION = "NEGOTIATION",
  PROPOSAL_SENT = "PROPOSAL_SENT",
  NEGOTIATION_FAILED = "NEGOTIATION_FAILED",
  CLOSED_WON = "CLOSED_WON",
  CLOSED_LOST = "CLOSED_LOST",
}

export interface Lead {
  id: string;
  tenantId: string;
  contactId: string;
  contact?: Contact;
  title: string;
  description?: string;
  status: LeadStatus;
  value?: number;
  probability?: number; // AI probability of close (0-1)
  assigneeId?: string;
  teamId?: string;
  closedAt?: Date;
  closedWonAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// CONVERSATION & MESSAGE TYPES
// ============================================================================

export enum MessageDirection {
  INBOUND = "INBOUND",
  OUTBOUND = "OUTBOUND",
}

export enum MessageStatus {
  PENDING = "PENDING",
  SENT = "SENT",
  DELIVERED = "DELIVERED",
  READ = "READ",
  FAILED = "FAILED",
}

export interface Message {
  id: string;
  conversationId: string;
  direction: MessageDirection;
  status: MessageStatus;
  content: string;
  mediaUrl?: string;
  mediaType?: "image" | "video" | "audio" | "document";
  aiGenerated: boolean;
  readAt?: Date;
  deliveredAt?: Date;
  failureReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Conversation {
  id: string;
  tenantId: string;
  contactId: string;
  contact?: Contact;
  agentId?: string;
  teamId?: string;
  lastMessageAt?: Date;
  isActive: boolean;
  messages?: Message[];
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// CAMPAIGN TYPES
// ============================================================================

export enum CampaignType {
  BROADCAST = "BROADCAST",
  SCHEDULED = "SCHEDULED",
  TRIGGERED = "TRIGGERED",
  A_B_TEST = "A_B_TEST",
}

export enum CampaignStatus {
  DRAFT = "DRAFT",
  SCHEDULED = "SCHEDULED",
  RUNNING = "RUNNING",
  PAUSED = "PAUSED",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
}

export interface Campaign {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  type: CampaignType;
  status: CampaignStatus;
  templateId: string;
  scheduledFor?: Date;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  clickCount: number;
  conversionCount: number;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// TEMPLATE TYPES
// ============================================================================

export enum TemplateStatus {
  DRAFT = "DRAFT",
  SUBMITTED = "SUBMITTED",
  APPROVED = "APPROVED",
  REJECTED = "REJECTED",
  FLAGGED = "FLAGGED",
}

export interface WhatsAppTemplate {
  id: string;
  tenantId: string;
  name: string;
  metaTemplateId?: string;
  category: "MARKETING" | "OTP" | "ACCOUNT_UPDATE";
  language: string;
  headerText?: string;
  bodyText: string;
  footerText?: string;
  status: TemplateStatus;
  variants: string[];
  aiScoreApprovalChance?: number;
  messageCount: number;
  successRate?: number;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// BILLING TYPES
// ============================================================================

export enum PlanName {
  STARTER = "STARTER",
  GROWTH = "GROWTH",
  PRO = "PRO",
  ENTERPRISE = "ENTERPRISE",
  CUSTOM = "CUSTOM",
}

export interface Plan {
  id: string;
  name: PlanName;
  displayName: string;
  description?: string;
  priceInPaisa: number; // Price in smallest currency unit
  messageQuota: number;
  contactLimit: number;
  agentLimit: number;
  aiCreditsPerMonth: number;
  chatbotEnabled: boolean;
  adsIntegrationEnabled: boolean;
  creativeStudioEnabled: boolean;
  apiAccessEnabled: boolean;
}

export enum SubscriptionStatus {
  ACTIVE = "ACTIVE",
  PAST_DUE = "PAST_DUE",
  CANCELLED = "CANCELLED",
  EXPIRED = "EXPIRED",
}

export interface Subscription {
  id: string;
  tenantId: string;
  planId: string;
  plan?: Plan;
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelledAt?: Date;
  razorpaySubscriptionId?: string;
  stripeSubscriptionId?: string;
}

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

// ============================================================================
// ERROR TYPES
// ============================================================================

export class ApiError extends Error {
  constructor(
    public code: string,
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export const ErrorCodes = {
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  BAD_REQUEST: "BAD_REQUEST",
  CONFLICT: "CONFLICT",
  TOO_MANY_REQUESTS: "TOO_MANY_REQUESTS",
  INTERNAL_SERVER_ERROR: "INTERNAL_SERVER_ERROR",
  MULTI_TENANT_VIOLATION: "MULTI_TENANT_VIOLATION",
} as const;
