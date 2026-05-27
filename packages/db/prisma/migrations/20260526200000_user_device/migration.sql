-- User devices (FCM tokens). One row per (user, token); token is the
-- unique identifier so re-registration from the same device is idempotent.

CREATE TYPE "DevicePlatform" AS ENUM ('ANDROID', 'IOS', 'WEB');

CREATE TABLE "UserDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT,
    "fcmToken" TEXT NOT NULL,
    "platform" "DevicePlatform" NOT NULL DEFAULT 'ANDROID',
    "label" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserDevice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserDevice_fcmToken_key" ON "UserDevice"("fcmToken");
CREATE INDEX "UserDevice_userId_idx" ON "UserDevice"("userId");
CREATE INDEX "UserDevice_tenantId_idx" ON "UserDevice"("tenantId");
