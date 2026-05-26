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

export enum DomainPortalType {
  PARTNER = "PARTNER",
  CUSTOMER = "CUSTOMER",
  DEMO = "DEMO",
  API = "API",
  TRACKING = "TRACKING",
}

export enum DomainDnsStatus {
  PENDING = "PENDING",
  CNAME_FOUND = "CNAME_FOUND",
  TXT_VERIFIED = "TXT_VERIFIED",
  FAILED = "FAILED",
}

export enum DomainSslStatus {
  PENDING = "PENDING",
  ACTIVE = "ACTIVE",
  FAILED = "FAILED",
}

export enum DomainStatus {
  PENDING_DNS = "PENDING_DNS",
  DNS_FOUND = "DNS_FOUND",
  TXT_VERIFIED = "TXT_VERIFIED",
  SSL_PENDING = "SSL_PENDING",
  SSL_ACTIVE = "SSL_ACTIVE",
  LIVE = "LIVE",
  FAILED = "FAILED",
  SUSPENDED = "SUSPENDED",
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
  wabaId?: string;
  wabaPhoneNumber?: string;
  wabaDisplayPhoneNumber?: string;
  wabaQualityRating?: string;
  wabaMessagingLimitTier?: string;
  wabaAccountStatus?: string;
  wabaLastSyncedAt?: Date;
  wabaLastSyncError?: string;
  messageQuotaPerMonth: number;
  contactLimit: number;
  agentLimit: number;
  aiCreditsPerMonth: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Domain {
  id: string;
  tenantId: string;
  partnerTenantId?: string | null;
  domain: string;
  portalType: DomainPortalType;
  verificationToken: string;
  cnameHost: string;
  cnameValue: string;
  txtHost: string;
  txtValue: string;
  dnsStatus: DomainDnsStatus;
  sslStatus: DomainSslStatus;
  status: DomainStatus;
  isPrimary: boolean;
  lastCheckedAt?: Date | null;
  lastError?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export enum WalletStatus {
  ACTIVE = "ACTIVE",
  SUSPENDED = "SUSPENDED",
}

export enum WalletBillingMode {
  PREPAID = "PREPAID",
  POSTPAID = "POSTPAID",
}

export enum WalletTransactionType {
  CREDIT_ALLOCATION = "CREDIT_ALLOCATION",
  CREDIT_REVERSAL = "CREDIT_REVERSAL",
  MANUAL_ADJUSTMENT = "MANUAL_ADJUSTMENT",
  TRANSFER_IN = "TRANSFER_IN",
  TRANSFER_OUT = "TRANSFER_OUT",
  MESSAGE_DEBIT = "MESSAGE_DEBIT",
  AI_DEBIT = "AI_DEBIT",
  WORKFLOW_DEBIT = "WORKFLOW_DEBIT",
  EXPIRY = "EXPIRY",
  AUTO_RECHARGE = "AUTO_RECHARGE",
}

export enum WalletTransactionDirection {
  CREDIT = "CREDIT",
  DEBIT = "DEBIT",
}

export interface Wallet {
  id: string;
  tenantId: string;
  status: WalletStatus;
  billingMode: WalletBillingMode;
  balanceCredits: number;
  reservedCredits: number;
  creditLimit: number;
  lowBalanceThreshold: number;
  autoRechargeEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface WalletTransaction {
  id: string;
  walletId: string;
  tenantId: string;
  actorUserId?: string | null;
  type: WalletTransactionType;
  direction: WalletTransactionDirection;
  amountCredits: number;
  balanceAfterCredits: number;
  reason: string;
  referenceType?: string | null;
  referenceId?: string | null;
  counterpartyWalletId?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: Date;
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

export enum LeadFollowUpStatus {
  RECOMMENDED = "RECOMMENDED",
  SCHEDULED = "SCHEDULED",
  SENT = "SENT",
  DISMISSED = "DISMISSED",
  FAILED = "FAILED",
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
  followUpStatus?: LeadFollowUpStatus;
  followUpPriority?: "low" | "medium" | "high" | string;
  followUpMessage?: string;
  followUpReason?: string;
  followUpDueAt?: Date;
  followUpRecommendedAt?: Date;
  followUpSentAt?: Date;
  followUpLastError?: string;
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
  campaignId?: string;
  direction: MessageDirection;
  status: MessageStatus;
  content: string;
  mediaUrl?: string;
  mediaType?: "image" | "video" | "audio" | "document";
  metaMessageId?: string;
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
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  TOKEN_REVOKED: "TOKEN_REVOKED",
  QUOTA_EXCEEDED: "QUOTA_EXCEEDED",
  EMAIL_NOT_VERIFIED: "EMAIL_NOT_VERIFIED",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
} as const;

// ============================================================================
// PERMISSIONS / RBAC
// ============================================================================

export const Permissions = {
  // Platform-wide (SuperAdmin only)
  PLATFORM_MANAGE: "platform:manage",
  TENANT_CREATE: "tenant:create",
  TENANT_DELETE: "tenant:delete",
  TENANT_IMPERSONATE: "tenant:impersonate",

  // Reseller
  CLIENT_CREATE: "client:create",
  CLIENT_DELETE: "client:delete",
  WHITELABEL_CONFIG: "whitelabel:config",

  // Business
  CAMPAIGN_CREATE: "campaign:create",
  CAMPAIGN_SEND: "campaign:send",
  CAMPAIGN_DELETE: "campaign:delete",
  CONTACT_CREATE: "contact:create",
  CONTACT_DELETE: "contact:delete",
  CONTACT_IMPORT: "contact:import",
  TEMPLATE_SUBMIT: "template:submit",
  FLOW_PUBLISH: "flow:publish",
  TEAM_MANAGE: "team:manage",
  BILLING_VIEW: "billing:view",
  BILLING_MANAGE: "billing:manage",
  WALLET_VIEW: "wallet:view",
  WALLET_MANAGE: "wallet:manage",
  WABA_CONFIGURE: "waba:configure",
  API_KEYS_MANAGE: "api_keys:manage",
  PROVIDER_ROUTE_MANAGE: "provider_route:manage",
  KNOWLEDGE_BASE_MANAGE: "knowledge_base:manage",
  AI_AGENT_MANAGE: "ai_agent:manage",
  SUPPORT_TICKET_VIEW: "support_ticket:view",
  SUPPORT_TICKET_MANAGE: "support_ticket:manage",

  // Agent
  CONVERSATION_READ: "conversation:read",
  CONVERSATION_REPLY: "conversation:reply",
  LEAD_UPDATE: "lead:update",
  CONTACT_READ: "contact:read",
} as const;

export type Permission = (typeof Permissions)[keyof typeof Permissions];

export const RolePermissions: Record<UserRole, Permission[]> = {
  [UserRole.SUPER_ADMIN]: Object.values(Permissions),
  [UserRole.WHITE_LABEL_ADMIN]: [
    Permissions.CLIENT_CREATE,
    Permissions.CLIENT_DELETE,
    Permissions.WHITELABEL_CONFIG,
    Permissions.TEAM_MANAGE,
    Permissions.BILLING_VIEW,
    Permissions.BILLING_MANAGE,
    Permissions.WALLET_VIEW,
    Permissions.WALLET_MANAGE,
    Permissions.CONTACT_READ,
    Permissions.SUPPORT_TICKET_VIEW,
    Permissions.SUPPORT_TICKET_MANAGE,
  ],
  [UserRole.BUSINESS_ADMIN]: [
    Permissions.CAMPAIGN_CREATE,
    Permissions.CAMPAIGN_SEND,
    Permissions.CAMPAIGN_DELETE,
    Permissions.CONTACT_CREATE,
    Permissions.CONTACT_DELETE,
    Permissions.CONTACT_IMPORT,
    Permissions.CONTACT_READ,
    Permissions.TEMPLATE_SUBMIT,
    Permissions.FLOW_PUBLISH,
    Permissions.TEAM_MANAGE,
    Permissions.BILLING_VIEW,
    Permissions.WALLET_VIEW,
    Permissions.WABA_CONFIGURE,
    Permissions.API_KEYS_MANAGE,
    Permissions.KNOWLEDGE_BASE_MANAGE,
    Permissions.AI_AGENT_MANAGE,
    Permissions.CONVERSATION_READ,
    Permissions.CONVERSATION_REPLY,
    Permissions.LEAD_UPDATE,
    Permissions.SUPPORT_TICKET_VIEW,
    Permissions.SUPPORT_TICKET_MANAGE,
  ],
  [UserRole.TEAM_LEAD]: [
    Permissions.CAMPAIGN_CREATE,
    Permissions.CAMPAIGN_SEND,
    Permissions.CONTACT_CREATE,
    Permissions.CONTACT_IMPORT,
    Permissions.CONTACT_READ,
    Permissions.KNOWLEDGE_BASE_MANAGE,
    Permissions.AI_AGENT_MANAGE,
    Permissions.CONVERSATION_READ,
    Permissions.CONVERSATION_REPLY,
    Permissions.LEAD_UPDATE,
  ],
  [UserRole.AGENT]: [
    Permissions.CONVERSATION_READ,
    Permissions.CONVERSATION_REPLY,
    Permissions.LEAD_UPDATE,
    Permissions.CONTACT_READ,
  ],
};

// ============================================================================
// AUTH REQUEST/RESPONSE PAYLOADS
// ============================================================================

export interface LoginPayload {
  email: string;
  password: string;
  tenantSlug?: string;
}

export interface SignupPayload {
  email: string;
  password: string;
  name: string;
  companyName: string;
}

export interface RequestPasswordResetPayload {
  email: string;
}

export interface ResetPasswordPayload {
  token: string;
  newPassword: string;
}

export interface VerifyEmailPayload {
  token: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthUserPublic {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  tenantId: string | null;
  emailVerified: boolean;
}

// ============================================================================
// WHATSAPP / META CLOUD API PAYLOADS
// ============================================================================

export interface MetaWebhookEntry {
  id: string;
  changes: Array<{
    value: {
      messaging_product: "whatsapp";
      metadata: { display_phone_number: string; phone_number_id: string };
      contacts?: Array<{ profile: { name: string }; wa_id: string }>;
      messages?: Array<{
        from: string;
        id: string;
        timestamp: string;
        text?: { body: string };
        type: string;
      }>;
      statuses?: Array<{
        id: string;
        status: "sent" | "delivered" | "read" | "failed";
        timestamp: string;
        recipient_id: string;
      }>;
    };
    field: "messages";
  }>;
}

export interface MetaWebhookBody {
  object: "whatsapp_business_account";
  entry: MetaWebhookEntry[];
}

// ============================================================================
// AI COPY GENERATION
// ============================================================================

export type AiTone = "professional" | "friendly" | "casual" | "urgent" | "playful";

export interface GenerateCopyPayload {
  prompt: string;
  channel: "whatsapp" | "facebook_ad" | "google_ad" | "email" | "sms" | "instagram_caption";
  tone?: AiTone;
  variantCount?: number;
  brandName?: string;
  audienceDescription?: string;
}

export interface GeneratedCopyVariant {
  id: string;
  text: string;
  estimatedCtr?: number;
}
