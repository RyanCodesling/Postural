/**
 * A small, dependency-free PDF writer for the session and progress reports.
 *
 * Pages are A4. Text uses Helvetica and Helvetica-Bold, which every PDF viewer
 * provides, so no font is embedded; `pdfText` folds characters those fonts
 * cannot encode to close ASCII. Advance widths come from Adobe's AFM metrics
 * for the two fonts, so wrapped text fits its column. The output is plain
 * ASCII: other WinAnsi characters are written as octal escapes.
 */

export const PAGE = { width: 595.28, height: 841.89 } as const;

export type PdfFont = "regular" | "bold";
export type Rgb = readonly [number, number, number];

export const COLORS = {
  text: [0.13, 0.15, 0.17],
  muted: [0.42, 0.45, 0.49],
  rule: [0.84, 0.86, 0.88],
  fill: [0.95, 0.97, 0.95],
  green: [0.09, 0.4, 0.2],
  amber: [0.62, 0.38, 0.03],
  red: [0.66, 0.15, 0.13],
  blue: [0.15, 0.39, 0.92],
  orange: [0.92, 0.35, 0.05],
} as const satisfies Record<string, Rgb>;

// Advance widths (1/1000 em) of ASCII 32-126, from Adobe's AFM metrics.
const ASCII_WIDTHS: Record<PdfFont, readonly number[]> = {
  regular: [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
    556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
  ],
  bold: [
    278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
    975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
    333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
    611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
  ],
};

// The non-ASCII characters the reports keep: WinAnsi code and advance widths.
const EXTRA_GLYPHS: Record<string, { code: number; regular: number; bold: number }> = {
  "·": { code: 0xb7, regular: 278, bold: 278 }, // middle dot
  "°": { code: 0xb0, regular: 400, bold: 400 }, // degree, for exercise names
  "—": { code: 0x97, regular: 1000, bold: 1000 }, // em dash
  "–": { code: 0x96, regular: 556, bold: 556 }, // en dash
  "‘": { code: 0x91, regular: 222, bold: 278 },
  "’": { code: 0x92, regular: 222, bold: 278 },
  "“": { code: 0x93, regular: 333, bold: 500 },
  "”": { code: 0x94, regular: 333, bold: 500 },
  "…": { code: 0x85, regular: 1000, bold: 1000 }, // ellipsis
  "•": { code: 0x95, regular: 350, bold: 350 }, // bullet
};

const REPLACEMENTS: Record<string, string> = {
  "→": "->", "←": "<-", "≥": ">=", "≤": "<=",
  "×": "x", "−": "-", " ": " ", " ": " ", " ": " ",
};

/** The text as the report fonts can draw it: accents dropped, anything else "?". */
export function pdfText(text: string): string {
  let out = "";
  for (const ch of text.replace(/[\r\n\t]+/g, " ")) {
    if ((ch >= " " && ch <= "~") || EXTRA_GLYPHS[ch]) out += ch;
    else if (REPLACEMENTS[ch] !== undefined) out += REPLACEMENTS[ch];
    else {
      const folded = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
      out += /^[ -~]+$/.test(folded) ? folded : "?";
    }
  }
  return out;
}

export function textWidth(text: string, font: PdfFont, size: number): number {
  let units = 0;
  for (const ch of pdfText(text)) {
    const code = ch.charCodeAt(0);
    units += code <= 126 ? ASCII_WIDTHS[font][code - 32] : EXTRA_GLYPHS[ch][font];
  }
  return (units * size) / 1000;
}

/** Greedy word wrap; a word wider than the line is split across lines. */
export function wrapText(text: string, font: PdfFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of pdfText(paragraph).split(" ")) {
      if (word === "") continue;
      const candidate = line ? `${line} ${word}` : word;
      if (textWidth(candidate, font, size) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      let rest = word;
      while (rest.length > 1 && textWidth(rest, font, size) > maxWidth) {
        let cut = rest.length - 1;
        while (cut > 1 && textWidth(rest.slice(0, cut), font, size) > maxWidth) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

function pdfString(text: string): string {
  let out = "(";
  for (const ch of pdfText(text)) {
    if (ch === "(" || ch === ")" || ch === "\\") out += `\\${ch}`;
    else if (ch <= "~") out += ch;
    else out += `\\${EXTRA_GLYPHS[ch].code.toString(8)}`;
  }
  return `${out})`;
}

const num = (value: number) => String(Math.round(value * 100) / 100);
const rgb = (color: Rgb) => color.map(num).join(" ");
/** Page coordinates are measured from the top-left corner, as on screen. */
const flipY = (top: number) => num(PAGE.height - top);

export class PdfPage {
  readonly ops: string[] = [];

  /** Draws one line of text whose baseline is `baseline` points from the top. */
  text(x: number, baseline: number, value: string, style: { font?: PdfFont; size?: number; color?: Rgb } = {}) {
    const font = style.font === "bold" ? "F2" : "F1";
    this.ops.push(`BT /${font} ${num(style.size ?? 10)} Tf ${rgb(style.color ?? COLORS.text)} rg ${num(x)} ${flipY(baseline)} Td ${pdfString(value)} Tj ET`);
  }

  line(x1: number, y1: number, x2: number, y2: number, style: { width?: number; color?: Rgb } = {}) {
    this.polyline([[x1, y1], [x2, y2]], style);
  }

  polyline(points: Array<readonly [number, number]>, style: { width?: number; color?: Rgb } = {}) {
    if (points.length < 2) return;
    const path = points.map(([x, y], i) => `${num(x)} ${flipY(y)} ${i === 0 ? "m" : "l"}`).join(" ");
    this.ops.push(`q ${num(style.width ?? 0.75)} w 1 J 1 j ${rgb(style.color ?? COLORS.rule)} RG ${path} S Q`);
  }

  rect(x: number, top: number, width: number, height: number, fill: Rgb) {
    this.ops.push(`q ${rgb(fill)} rg ${num(x)} ${flipY(top + height)} ${num(width)} ${num(height)} re f Q`);
  }

  dot(cx: number, cy: number, radius: number, fill: Rgb) {
    const x = cx;
    const y = PAGE.height - cy;
    const r = radius;
    const k = 0.5523 * r;
    const p = (px: number, py: number) => `${num(px)} ${num(py)}`;
    this.ops.push(`q ${rgb(fill)} rg ${p(x + r, y)} m ` +
      `${p(x + r, y + k)} ${p(x + k, y + r)} ${p(x, y + r)} c ` +
      `${p(x - k, y + r)} ${p(x - r, y + k)} ${p(x - r, y)} c ` +
      `${p(x - r, y - k)} ${p(x - k, y - r)} ${p(x, y - r)} c ` +
      `${p(x + k, y - r)} ${p(x + r, y - k)} ${p(x + r, y)} c f Q`);
  }
}

export class PdfDocument {
  readonly pages: PdfPage[] = [];

  constructor(private readonly info: { title: string; createdAt: Date }) {}

  addPage(): PdfPage {
    const page = new PdfPage();
    this.pages.push(page);
    return page;
  }

  toBytes(): Uint8Array<ArrayBuffer> {
    const objects: string[] = ["", ""]; // 1 catalog and 2 page tree, filled in below
    const add = (body: string) => objects.push(body);
    const regular = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const bold = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const kids = this.pages.map((page) => {
      const content = page.ops.join("\n");
      const contents = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
      return add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] ` +
        `/Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> /Contents ${contents} 0 R >>`);
    });
    objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
    objects[1] = `<< /Type /Pages /Kids [${kids.map((id) => `${id} 0 R`).join(" ")}] /Count ${kids.length} >>`;
    const stamp = this.info.createdAt.toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const info = add(`<< /Title ${pdfString(this.info.title)} /Producer (Postural) /CreationDate (D:${stamp}Z) >>`);

    let out = "%PDF-1.4\n";
    const offsets = objects.map((body, i) => {
      const offset = out.length;
      out += `${i + 1} 0 obj\n${body}\nendobj\n`;
      return offset;
    });
    const xref = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    // Every character is ASCII, so string offsets are byte offsets.
    return new TextEncoder().encode(out);
  }
}

export type TableColumn = { header: string; width: number; align?: "left" | "right" };
export type ChartSeries = { label: string; color: Rgb; values: Array<number | null> };

const MARGIN = 50;
const FOOTER_SPACE = 30;

/**
 * Top-to-bottom report layout on A4 pages: headings, wrapped paragraphs,
 * label/value rows, tables whose header repeats after a page break, and small
 * line charts. `finish` adds the running footer with page numbers.
 */
export class ReportLayout {
  readonly doc: PdfDocument;
  readonly contentWidth = PAGE.width - 2 * MARGIN;
  private page: PdfPage;
  private y = MARGIN;

  constructor(title: string, private readonly footer: string, createdAt: Date) {
    this.doc = new PdfDocument({ title, createdAt });
    this.page = this.doc.addPage();
  }

  private newPage() {
    this.page = this.doc.addPage();
    this.y = MARGIN;
  }

  /** Starts a new page unless `height` more points fit on this one. */
  private ensure(height: number) {
    if (this.y + height > PAGE.height - MARGIN - FOOTER_SPACE) this.newPage();
  }

  space(height: number) {
    this.y += height;
  }

  title(text: string, subtitle?: string) {
    this.ensure(40);
    for (const line of wrapText(text, "bold", 18, this.contentWidth)) {
      this.page.text(MARGIN, this.y + 18, line, { font: "bold", size: 18, color: COLORS.green });
      this.y += 23;
    }
    if (subtitle) this.paragraph(subtitle, { size: 10.5, color: COLORS.muted });
    this.y += 4;
  }

  heading(text: string) {
    this.ensure(48);
    this.y += 12;
    this.page.text(MARGIN, this.y + 12, text, { font: "bold", size: 12.5, color: COLORS.green });
    this.y += 18;
    this.page.line(MARGIN, this.y, MARGIN + this.contentWidth, this.y, { color: COLORS.rule });
    this.y += 8;
  }

  paragraph(text: string, style: { size?: number; color?: Rgb; font?: PdfFont } = {}) {
    const size = style.size ?? 9.5;
    const lineHeight = size * 1.35;
    for (const line of wrapText(text, style.font ?? "regular", size, this.contentWidth)) {
      this.ensure(lineHeight);
      this.page.text(MARGIN, this.y + size, line, { size, color: style.color ?? COLORS.text, font: style.font });
      this.y += lineHeight;
    }
    this.y += 3;
  }

  /** Label/value rows; a long label or value wraps within its column. */
  keyValues(rows: Array<readonly [string, string]>, labelWidth = 150) {
    const size = 9.5;
    const lineHeight = size * 1.35;
    for (const [label, value] of rows) {
      const labelLines = wrapText(label, "regular", size, labelWidth - 10);
      const valueLines = wrapText(value, "regular", size, this.contentWidth - labelWidth);
      const lines = Math.max(labelLines.length, valueLines.length);
      this.ensure(lines * lineHeight);
      labelLines.forEach((line, i) => this.page.text(MARGIN, this.y + size + i * lineHeight, line, { size, color: COLORS.muted }));
      valueLines.forEach((line, i) => this.page.text(MARGIN + labelWidth, this.y + size + i * lineHeight, line, { size }));
      this.y += lines * lineHeight + 2;
    }
    this.y += 3;
  }

  table(columns: TableColumn[], rows: string[][]) {
    const size = 8.5;
    const lineHeight = size * 1.3;
    const pad = 4;
    const total = columns.reduce((sum, c) => sum + c.width, 0);
    const widths = columns.map((c) => (c.width / total) * this.contentWidth);
    const cellLines = (cells: string[], font: PdfFont) =>
      cells.map((cell, i) => wrapText(cell, font, size, widths[i] - 2 * pad));
    const drawRow = (cells: string[][], font: PdfFont, fill?: Rgb) => {
      const height = Math.max(...cells.map((lines) => lines.length)) * lineHeight + 2 * pad;
      if (fill) this.page.rect(MARGIN, this.y, this.contentWidth, height, fill);
      let x = MARGIN;
      cells.forEach((lines, i) => {
        lines.forEach((line, j) => {
          const right = columns[i].align === "right";
          const lineX = right ? x + widths[i] - pad - textWidth(line, font, size) : x + pad;
          this.page.text(lineX, this.y + pad + size + j * lineHeight, line, { size, font, color: font === "bold" ? COLORS.text : undefined });
        });
        x += widths[i];
      });
      this.y += height;
      this.page.line(MARGIN, this.y, MARGIN + this.contentWidth, this.y, { width: 0.5 });
    };
    const header = cellLines(columns.map((c) => c.header), "bold");
    const headerHeight = Math.max(...header.map((l) => l.length)) * lineHeight + 2 * pad;
    this.ensure(headerHeight + lineHeight + 2 * pad);
    drawRow(header, "bold", COLORS.fill);
    for (const row of rows) {
      const cells = cellLines(row, "regular");
      const height = Math.max(...cells.map((l) => l.length)) * lineHeight + 2 * pad;
      if (this.y + height > PAGE.height - MARGIN - FOOTER_SPACE) {
        this.newPage();
        drawRow(header, "bold", COLORS.fill);
      }
      drawRow(cells, "regular");
    }
    this.y += 8;
  }

  /** A line chart over evenly spaced sessions; null values leave a gap. */
  chart(series: ChartSeries[], xLabels: { first: string; last: string }, format: (value: number) => string) {
    const values = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
    if (values.length === 0) return;
    const height = 120;
    this.ensure(height + 40);
    const left = MARGIN + 44;
    const right = MARGIN + this.contentWidth - 6;
    const top = this.y + 6;
    const bottom = top + height;
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (min === max) {
      const pad = Math.abs(min) * 0.05 || 1;
      min -= pad;
      max += pad;
    }
    const count = Math.max(...series.map((s) => s.values.length));
    const xAt = (i: number) => (count === 1 ? (left + right) / 2 : left + ((right - left) * i) / (count - 1));
    const yAt = (v: number) => bottom - ((v - min) / (max - min)) * height;
    for (const [value, y] of [[max, top], [(min + max) / 2, (top + bottom) / 2], [min, bottom]] as const) {
      this.page.line(left, y, right, y, { width: 0.4 });
      const label = format(value);
      this.page.text(left - 6 - textWidth(label, "regular", 7.5), y + 2.5, label, { size: 7.5, color: COLORS.muted });
    }
    for (const s of series) {
      let run: Array<[number, number]> = [];
      s.values.forEach((v, i) => {
        if (v === null) {
          this.page.polyline(run, { width: 1.4, color: s.color });
          run = [];
          return;
        }
        run.push([xAt(i), yAt(v)]);
        this.page.dot(xAt(i), yAt(v), 2.2, s.color);
      });
      this.page.polyline(run, { width: 1.4, color: s.color });
    }
    this.page.text(left, bottom + 12, xLabels.first, { size: 7.5, color: COLORS.muted });
    if (count > 1) {
      this.page.text(right - textWidth(xLabels.last, "regular", 7.5), bottom + 12, xLabels.last, { size: 7.5, color: COLORS.muted });
    }
    let legendX = left;
    for (const s of series) {
      this.page.dot(legendX + 3, bottom + 25, 3, s.color);
      this.page.text(legendX + 10, bottom + 28, s.label, { size: 8 });
      legendX += 20 + textWidth(s.label, "regular", 8);
    }
    this.y = bottom + 40;
  }

  finish(): Uint8Array<ArrayBuffer> {
    const total = this.doc.pages.length;
    this.doc.pages.forEach((page, i) => {
      const baseline = PAGE.height - MARGIN + 14;
      page.line(MARGIN, baseline - 12, MARGIN + this.contentWidth, baseline - 12, { width: 0.5 });
      page.text(MARGIN, baseline, this.footer, { size: 7.5, color: COLORS.muted });
      const number = `Page ${i + 1} of ${total}`;
      page.text(MARGIN + this.contentWidth - textWidth(number, "regular", 7.5), baseline, number, { size: 7.5, color: COLORS.muted });
    });
    return this.doc.toBytes();
  }
}
