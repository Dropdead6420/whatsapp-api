-- Replicate as a first-class AI provider (image generation; the AI-routing
-- default matrix already points QR artwork at Replicate). Enum additions
-- only — no table changes.
ALTER TYPE "AiProviderKey" ADD VALUE 'REPLICATE';
ALTER TYPE "SecretProvider" ADD VALUE 'REPLICATE';
