-- Final Currency/Language PDF §9: language master/settings,
-- portal translations, and durable translation job ledger.

CREATE TYPE "TextDirection" AS ENUM ('LTR', 'RTL');
CREATE TYPE "TranslationJobStatus" AS ENUM ('PENDING', 'RUNNING', 'PREVIEW_READY', 'APPROVED', 'PUBLISHED', 'FAILED');
CREATE TYPE "TranslationSourceType" AS ENUM ('TEMPLATE', 'CAMPAIGN', 'CHATBOT_FLOW', 'LANDING_PAGE', 'INBOX_MESSAGE', 'KNOWLEDGE_BASE', 'PORTAL_KEY');

CREATE TABLE "Language" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nativeName" TEXT NOT NULL,
    "direction" "TextDirection" NOT NULL DEFAULT 'LTR',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isLaunchLanguage" BOOLEAN NOT NULL DEFAULT false,
    "displayOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Language_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "TranslationKey" (
    "id" TEXT NOT NULL,
    "namespace" TEXT NOT NULL DEFAULT 'common',
    "key" TEXT NOT NULL,
    "defaultText" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TranslationKey_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PortalTranslation" (
    "id" TEXT NOT NULL,
    "translationKeyId" TEXT NOT NULL,
    "languageCode" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'published',
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortalTranslation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomerLanguageSetting" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "languageCode" TEXT NOT NULL DEFAULT 'en',
    "locale" TEXT NOT NULL DEFAULT 'en-IN',
    "allowAutoTranslate" BOOLEAN NOT NULL DEFAULT true,
    "requireApprovalForSensitive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerLanguageSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PartnerLanguageSetting" (
    "id" TEXT NOT NULL,
    "partnerTenantId" TEXT NOT NULL,
    "defaultLanguageCode" TEXT NOT NULL DEFAULT 'en',
    "allowedLanguages" JSONB,
    "allowCustomerOverride" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerLanguageSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TranslationJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceType" "TranslationSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceLanguageCode" TEXT NOT NULL DEFAULT 'en',
    "targetLanguageCode" TEXT NOT NULL,
    "status" "TranslationJobStatus" NOT NULL DEFAULT 'PENDING',
    "previewJson" JSONB,
    "error" TEXT,
    "requestedByUserId" TEXT,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TranslationJob_pkey" PRIMARY KEY ("id")
);

INSERT INTO "Language" ("code", "name", "nativeName", "direction", "isLaunchLanguage", "displayOrder", "updatedAt")
VALUES
  ('en', 'English', 'English', 'LTR', true, 10, CURRENT_TIMESTAMP),
  ('hi', 'Hindi', 'हिन्दी', 'LTR', true, 20, CURRENT_TIMESTAMP),
  ('ur', 'Urdu', 'اردو', 'RTL', true, 30, CURRENT_TIMESTAMP),
  ('bn', 'Bengali', 'বাংলা', 'LTR', true, 40, CURRENT_TIMESTAMP),
  ('ar', 'Arabic', 'العربية', 'RTL', true, 50, CURRENT_TIMESTAMP),
  ('fr', 'French', 'Français', 'LTR', true, 60, CURRENT_TIMESTAMP),
  ('es', 'Spanish', 'Español', 'LTR', true, 70, CURRENT_TIMESTAMP),
  ('de', 'German', 'Deutsch', 'LTR', true, 80, CURRENT_TIMESTAMP),
  ('pa', 'Punjabi', 'ਪੰਜਾਬੀ', 'LTR', true, 90, CURRENT_TIMESTAMP),
  ('ta', 'Tamil', 'தமிழ்', 'LTR', true, 100, CURRENT_TIMESTAMP),
  ('te', 'Telugu', 'తెలుగు', 'LTR', true, 110, CURRENT_TIMESTAMP),
  ('mr', 'Marathi', 'मराठी', 'LTR', true, 120, CURRENT_TIMESTAMP),
  ('gu', 'Gujarati', 'ગુજરાતી', 'LTR', true, 130, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "nativeName" = EXCLUDED."nativeName",
  "direction" = EXCLUDED."direction",
  "isLaunchLanguage" = EXCLUDED."isLaunchLanguage",
  "displayOrder" = EXCLUDED."displayOrder",
  "updatedAt" = CURRENT_TIMESTAMP;

CREATE INDEX "Language_isActive_displayOrder_idx" ON "Language"("isActive", "displayOrder");

CREATE UNIQUE INDEX "TranslationKey_key_key" ON "TranslationKey"("key");
CREATE INDEX "TranslationKey_namespace_idx" ON "TranslationKey"("namespace");

CREATE UNIQUE INDEX "PortalTranslation_translationKeyId_languageCode_key" ON "PortalTranslation"("translationKeyId", "languageCode");
CREATE INDEX "PortalTranslation_languageCode_idx" ON "PortalTranslation"("languageCode");

CREATE UNIQUE INDEX "CustomerLanguageSetting_tenantId_key" ON "CustomerLanguageSetting"("tenantId");
CREATE INDEX "CustomerLanguageSetting_languageCode_idx" ON "CustomerLanguageSetting"("languageCode");

CREATE UNIQUE INDEX "PartnerLanguageSetting_partnerTenantId_key" ON "PartnerLanguageSetting"("partnerTenantId");
CREATE INDEX "PartnerLanguageSetting_defaultLanguageCode_idx" ON "PartnerLanguageSetting"("defaultLanguageCode");

CREATE INDEX "TranslationJob_tenantId_status_createdAt_idx" ON "TranslationJob"("tenantId", "status", "createdAt");
CREATE INDEX "TranslationJob_sourceType_sourceId_idx" ON "TranslationJob"("sourceType", "sourceId");
CREATE INDEX "TranslationJob_targetLanguageCode_idx" ON "TranslationJob"("targetLanguageCode");

ALTER TABLE "PortalTranslation" ADD CONSTRAINT "PortalTranslation_translationKeyId_fkey" FOREIGN KEY ("translationKeyId") REFERENCES "TranslationKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PortalTranslation" ADD CONSTRAINT "PortalTranslation_languageCode_fkey" FOREIGN KEY ("languageCode") REFERENCES "Language"("code") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerLanguageSetting" ADD CONSTRAINT "CustomerLanguageSetting_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnerLanguageSetting" ADD CONSTRAINT "PartnerLanguageSetting_partnerTenantId_fkey" FOREIGN KEY ("partnerTenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TranslationJob" ADD CONSTRAINT "TranslationJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TranslationJob" ADD CONSTRAINT "TranslationJob_targetLanguageCode_fkey" FOREIGN KEY ("targetLanguageCode") REFERENCES "Language"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
