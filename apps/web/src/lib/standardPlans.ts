// Starter pricing template for the SuperAdmin "Manage Defaults" matrix. These
// are editable suggestions the admin adopts and tweaks — not hardcoded runtime
// plans (the saved PlanPricingDefault rows are the source of truth). Values are
// in rupees/month, mirroring the reference admin panel's default tiers.

export interface StandardPlanRow {
  planName: string;
  monthly: string;
  quarterly: string;
  yearly: string;
  addMonthly: string;
  addQuarterly: string;
  addYearly: string;
}

export function standardPlanRows(): StandardPlanRow[] {
  return [
    { planName: "Free Forever", monthly: "0", quarterly: "0", yearly: "0", addMonthly: "", addQuarterly: "", addYearly: "" },
    { planName: "Starter Plan", monthly: "1799", quarterly: "1499", yearly: "999", addMonthly: "", addQuarterly: "", addYearly: "" },
    { planName: "Advance Plan", monthly: "2899", quarterly: "2499", yearly: "1999", addMonthly: "600", addQuarterly: "500", addYearly: "400" },
  ];
}
