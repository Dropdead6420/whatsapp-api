import { ModuleComingSoon } from "../../src/components/ModuleComingSoon";

export default function SetupWizardPage() {
  return (
    <ModuleComingSoon
      title="Setup Wizard"
      description="A guided launch checklist for WhatsApp credentials, business profile, templates, team routing, billing, and first campaign readiness."
      highlights={[
        "WhatsApp Business API setup checklist",
        "Team, wallet, and template readiness steps",
        "Launch health score before first send",
        "Tenant-safe onboarding progress tracking",
      ]}
    />
  );
}
