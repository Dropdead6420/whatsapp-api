type Primitive = string | number | boolean | null | undefined;

export interface AnalyticsCsvRow {
  section: string;
  metric: string;
  value: Primitive;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function csvEscape(value: Primitive): string {
  const text = value == null ? "" : String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function pushRecordRows(
  rows: AnalyticsCsvRow[],
  section: string,
  record: Record<string, unknown>,
  prefix = "",
): void {
  for (const [key, value] of Object.entries(record)) {
    const metric = prefix ? `${prefix}.${key}` : key;
    if (isPlainRecord(value)) {
      pushRecordRows(rows, section, value, metric);
      continue;
    }
    if (Array.isArray(value)) {
      rows.push({ section, metric, value: JSON.stringify(value) });
      continue;
    }
    rows.push({ section, metric, value: value as Primitive });
  }
}

export function analyticsSummaryToCsvRows(
  summary: Record<string, unknown>,
): AnalyticsCsvRow[] {
  const rows: AnalyticsCsvRow[] = [
    { section: "Report", metric: "scope", value: summary.scope as Primitive },
    { section: "Report", metric: "generatedAt", value: new Date().toISOString() },
  ];

  const orderedSections = [
    ["Totals", summary.totals],
    ["Send Quota", summary.sendQuota],
    ["Plan Quotas", summary.planQuotas],
    ["Leads By Status", summary.leadsByStatus],
    ["Campaigns By Status", summary.campaignsByStatus],
  ] as const;

  for (const [section, value] of orderedSections) {
    if (isPlainRecord(value)) {
      pushRecordRows(rows, section, value);
    }
  }

  return rows;
}

export function csvRowsToString(rows: AnalyticsCsvRow[]): string {
  const header = ["Section", "Metric", "Value"];
  const lines = [
    header.map(csvEscape).join(","),
    ...rows.map((row) =>
      [row.section, row.metric, row.value].map(csvEscape).join(","),
    ),
  ];
  return `${lines.join("\n")}\n`;
}
