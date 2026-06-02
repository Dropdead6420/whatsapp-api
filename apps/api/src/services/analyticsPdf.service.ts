import { analyticsSummaryToCsvRows } from "./analyticsExport.service";

interface PdfTextLine {
  text: string;
  font: "F1" | "F2";
  size: number;
  x: number;
  gapAfter?: number;
}

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN_X = 54;
const MARGIN_TOP = 58;
const MARGIN_BOTTOM = 54;
const LINE_HEIGHT = 15;

export function pdfEscape(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\r?\n/g, " ");
}

function truncate(value: unknown, max = 92): string {
  const text = value == null ? "" : String(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}...`;
}

function wrapLine(text: string, max = 96): string[] {
  if (text.length <= max) return [text];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= max) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word.length > max ? `${word.slice(0, max - 1)}...` : word;
  }

  if (current) lines.push(current);
  return lines;
}

function buildLines(summary: Record<string, unknown>): PdfTextLine[] {
  const rows = analyticsSummaryToCsvRows(summary);
  const scope = String(summary.scope ?? "analytics");
  const generatedAt =
    rows.find((row) => row.section === "Report" && row.metric === "generatedAt")
      ?.value ?? new Date().toISOString();
  const lines: PdfTextLine[] = [
    {
      text: "NexaFlow Analytics Report",
      font: "F2",
      size: 18,
      x: MARGIN_X,
      gapAfter: 6,
    },
    {
      text: `Scope: ${scope.toUpperCase()}   Generated: ${generatedAt}`,
      font: "F1",
      size: 10,
      x: MARGIN_X,
      gapAfter: 16,
    },
    {
      text: "Section | Metric | Value",
      font: "F2",
      size: 11,
      x: MARGIN_X,
      gapAfter: 6,
    },
  ];

  for (const row of rows.filter((item) => item.section !== "Report")) {
    const raw = `${row.section} | ${row.metric} | ${truncate(row.value)}`;
    const wrapped = wrapLine(raw);
    for (const [index, text] of wrapped.entries()) {
      lines.push({
        text,
        font: index === 0 ? "F1" : "F1",
        size: 9,
        x: index === 0 ? MARGIN_X : MARGIN_X + 18,
      });
    }
  }

  return lines;
}

function paginate(lines: PdfTextLine[]): string[] {
  const pages: string[] = [];
  let y = PAGE_HEIGHT - MARGIN_TOP;
  let commands = "";

  function flushPage() {
    if (commands.trim()) pages.push(commands);
    commands = "";
    y = PAGE_HEIGHT - MARGIN_TOP;
  }

  for (const line of lines) {
    if (y <= MARGIN_BOTTOM) flushPage();
    commands += `BT /${line.font} ${line.size} Tf ${line.x} ${y} Td (${pdfEscape(
      line.text,
    )}) Tj ET\n`;
    y -= LINE_HEIGHT + (line.gapAfter ?? 0);
  }

  flushPage();
  return pages.length ? pages : ["BT /F1 10 Tf 54 790 Td (No analytics data.) Tj ET\n"];
}

function buildPdfDocument(pageStreams: string[]): Buffer {
  const objects: Record<number, string> = {
    1: "<< /Type /Catalog /Pages 2 0 R >>",
    3: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    4: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  };

  const kids: string[] = [];
  for (const [index, stream] of pageStreams.entries()) {
    const pageId = 5 + index * 2;
    const contentId = pageId + 1;
    kids.push(`${pageId} 0 R`);
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] =
      `<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}endstream`;
  }

  objects[2] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${kids.length} >>`;

  const maxObjectId = Math.max(...Object.keys(objects).map(Number));
  const offsets = new Array<number>(maxObjectId + 1).fill(0);
  let pdf = "%PDF-1.4\n";

  for (let id = 1; id <= maxObjectId; id += 1) {
    const object = objects[id];
    if (!object) continue;
    offsets[id] = Buffer.byteLength(pdf, "utf8");
    pdf += `${id} 0 obj\n${object}\nendobj\n`;
  }

  const startXref = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${maxObjectId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= maxObjectId; id += 1) {
    pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${maxObjectId + 1} /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF\n`;

  return Buffer.from(pdf, "utf8");
}

export function analyticsSummaryToPdf(summary: Record<string, unknown>): Buffer {
  return buildPdfDocument(paginate(buildLines(summary)));
}
