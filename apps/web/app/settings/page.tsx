import { ModuleComingSoon } from "../../src/components/ModuleComingSoon";

export default function SettingsPage() {
  return (
    <ModuleComingSoon
      title="Settings"
      description="Manage tenant profile, security preferences, team defaults, notification channels, localization, and platform behavior."
      highlights={[
        "Tenant profile and workspace defaults",
        "Security and notification preferences",
        "Team routing and assignment defaults",
        "Language, currency, and branding controls",
      ]}
    />
  );
}
