-- CreateTable
CREATE TABLE "GoogleOAuthConfig" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL DEFAULT '',
    "clientSecretCipher" TEXT,
    "clientSecretLast4" TEXT,
    "redirectUri" TEXT NOT NULL DEFAULT '',
    "scope" TEXT NOT NULL DEFAULT 'https://www.googleapis.com/auth/business.manage',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleOAuthConfig_pkey" PRIMARY KEY ("id")
);
