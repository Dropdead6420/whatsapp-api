import { ModuleComingSoon } from "../../src/components/ModuleComingSoon";

export default function IntegrationsPage() {
  return (
    <ModuleComingSoon
      title="Integrations"
      description="Connect NexaFlow to WhatsApp, Meta Ads, Google Business Profile, payments, webhooks, CRMs, and automation tools."
      highlights={[
        "Provider connection status",
        "Webhook and API-key shortcuts",
        "Meta and Google channel setup",
        "Partner-safe integration controls",
      ]}
    />
  );
}
