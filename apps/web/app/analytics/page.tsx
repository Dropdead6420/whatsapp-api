import { ModuleComingSoon } from "../../src/components/ModuleComingSoon";

export default function AnalyticsPage() {
  return (
    <ModuleComingSoon
      title="Analytics"
      description="Track campaign delivery, read rates, reply trends, lead conversion, wallet usage, agent performance, and revenue attribution."
      highlights={[
        "Campaign and inbox performance dashboards",
        "Lead funnel and conversion attribution",
        "Wallet and message-cost reporting",
        "Scheduled exports for owners and partners",
      ]}
    />
  );
}
