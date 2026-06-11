-- SuperAdmin Settings Center: global AI defaults + payment gateway/notification settings.
-- Secrets stay in SecretVault/env; these tables store operator-managed UI/config state.

CREATE TABLE "AiGlobalSetting" (
  "id" TEXT NOT NULL DEFAULT 'global',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "defaultProvider" TEXT NOT NULL DEFAULT 'OpenAI',
  "textModel" TEXT NOT NULL DEFAULT 'gpt-5.4',
  "embeddingsModel" TEXT NOT NULL DEFAULT 'text-embedding-3-small',
  "defaultLanguage" TEXT NOT NULL DEFAULT 'English',
  "defaultTone" TEXT NOT NULL DEFAULT 'Friendly',
  "creativity" TEXT NOT NULL DEFAULT 'Economic',
  "maxInputLength" INTEGER NOT NULL DEFAULT 100,
  "maxOutputLength" INTEGER NOT NULL DEFAULT 2000,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AiGlobalSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentGatewaySetting" (
  "id" TEXT NOT NULL,
  "gateway" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "mode" TEXT NOT NULL DEFAULT 'test',
  "credentialHint" TEXT,
  "instructions" TEXT,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PaymentGatewaySetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentNotificationTemplate" (
  "id" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "subject" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PaymentNotificationTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentGatewaySetting_gateway_key" ON "PaymentGatewaySetting"("gateway");
CREATE UNIQUE INDEX "PaymentNotificationTemplate_event_key" ON "PaymentNotificationTemplate"("event");
