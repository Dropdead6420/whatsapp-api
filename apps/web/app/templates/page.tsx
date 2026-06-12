import { ModuleComingSoon } from "../../src/components/ModuleComingSoon";

export default function TemplatesPage() {
  return (
    <ModuleComingSoon
      title="Templates"
      description="Centralize approved WhatsApp templates, reusable message blocks, campaign copy, and Meta submission status in one operator workspace."
      highlights={[
        "Template library with approval status",
        "Reusable campaign and reply blocks",
        "Category filters for marketing, utility, and service flows",
        "Meta readiness checks before broadcast",
      ]}
    />
  );
}
