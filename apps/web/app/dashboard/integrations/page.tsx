import { DashboardPlaceholder } from "../../../src/components/DashboardPlaceholder";

export default function IntegrationsPlaceholderPage() {
  return (
    <DashboardPlaceholder
      title="Integrations"
      description="Connect WhatsApp, webhooks, ads platforms, API keys, and external tools from one place."
      suggestedHref="/developer"
      suggestedLabel="Open developer tools"
    />
  );
}
