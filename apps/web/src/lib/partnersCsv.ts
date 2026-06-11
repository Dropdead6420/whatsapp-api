// Pure CSV builder for the SuperAdmin Partners overview "Export Report".
// Kept out of the page component so the escaping logic is unit-testable.

export interface PartnerCsvRow {
  name: string;
  type: string;
  walletBalance: number;
  totalOrgs: number;
  gmbOrgs: number;
}

// RFC-4180-ish: quote a cell if it contains a comma, quote or newline; double
// internal quotes.
function cell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const PARTNER_CSV_HEADERS = ["Partner Name", "Type", "Wallet Balance", "Total Orgs", "GMB Orgs"];

/** Build a CSV string (header + one row per partner). */
export function partnersToCsv(rows: PartnerCsvRow[]): string {
  const lines = [PARTNER_CSV_HEADERS.join(",")];
  for (const r of rows) {
    lines.push([cell(r.name), cell(r.type), cell(r.walletBalance), cell(r.totalOrgs), cell(r.gmbOrgs)].join(","));
  }
  return lines.join("\n");
}
