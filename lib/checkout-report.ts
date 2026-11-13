import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";

export const MAX_FILE_SIZE_MB = 20;
export const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

export const METADATA_FIELDS = [
  { key: "apartment", label: "Apartemen", pattern: "apartemen" },
  { key: "unitDetail", label: "Detail Unit", pattern: "detail\\s+unit" },
  { key: "unitCode", label: "Kode Unit", pattern: "kode\\s+unit" },
  { key: "tenantName", label: "Nama Penyewa", pattern: "nama\\s+penyewa" },
  {
    key: "qualityControlPic",
    label: "PIC Quality Control",
    pattern: "pic\\s+quality\\s+control",
  },
  {
    key: "qualityControlDate",
    label: "Tanggal Quality Control",
    pattern: "tanggal\\s+quality\\s+control",
  },
] as const;

export type MetadataKey = (typeof METADATA_FIELDS)[number]["key"];
export type Confidence = "high" | "low" | "missing";

export type ExtractedValue = {
  value: string;
  confidence: Confidence;
  page: number | null;
};

export type ReportItem = {
  name: string;
  beforeCheckIn: string[];
  afterCheckOut: string[];
  confidence: Confidence;
  page: number;
};

export type ReportSection = {
  title: string;
  items: ReportItem[];
  confidence: Confidence;
  page: number;
  layoutWarningId?: string;
};

export type ReviewFlag = {
  id: string;
  page: number | null;
  message: string;
};

export type CheckoutReport = {
  metadata: Record<MetadataKey, ExtractedValue>;
  sections: ReportSection[];
  reviewFlags: ReviewFlag[];
  pageCount: number;
};

export type ExtractionProgress = {
  page: number;
  totalPages: number;
  message: string;
};

type PositionedText = {
  text: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  confidence: number;
};

type PageLayout = {
  pageNumber: number;
  width: number;
  height: number;
  tokens: PositionedText[];
};

type TextLine = {
  tokens: PositionedText[];
  text: string;
  x0: number;
  x1: number;
  y: number;
  confidence: number;
};

type OcrWorker = {
  recognize: (
    image: HTMLCanvasElement,
  ) => Promise<{
    data: {
      words?: Array<{
        text: string;
        confidence: number;
        bbox: { x0: number; x1: number; y0: number; y1: number };
      }>;
    };
  }>;
  terminate: () => Promise<unknown>;
};

const EMPTY_VALUE = "(Kosong)";
const UNKNOWN_VALUE = "Tidak terbaca";

export class PdfExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfExtractionError";
  }
}

function makeEmptyMetadata(): Record<MetadataKey, ExtractedValue> {
  return {
    apartment: { value: "", confidence: "missing", page: null },
    unitDetail: { value: "", confidence: "missing", page: null },
    unitCode: { value: "", confidence: "missing", page: null },
    tenantName: { value: "", confidence: "missing", page: null },
    qualityControlPic: { value: "", confidence: "missing", page: null },
    qualityControlDate: { value: "", confidence: "missing", page: null },
  };
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[–—−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function textFromTokens(tokens: PositionedText[]): string {
  return tokens
    .filter((token) => token.text.trim().length > 0)
    .sort((left, right) => left.y0 - right.y0 || left.x0 - right.x0)
    .map((token) => normalizeText(token.text))
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function groupLines(tokens: PositionedText[]): TextLine[] {
  const seenTokens = new Set<string>();
  const sorted = tokens
    .filter((token) => token.text.trim().length > 0)
    .filter((token) => {
      const key = [
        normalizeText(token.text).toLowerCase(),
        token.x0.toFixed(3),
        token.x1.toFixed(3),
        token.y0.toFixed(3),
        token.y1.toFixed(3),
      ].join("|");
      if (seenTokens.has(key)) {
        return false;
      }
      seenTokens.add(key);
      return true;
    })
    .sort(
    (left, right) =>
      (left.y0 + left.y1) / 2 - (right.y0 + right.y1) / 2 ||
      left.x0 - right.x0,
  );
  const lines: TextLine[] = [];
  const lineTolerance = 0.0075;

  for (const token of sorted) {
    const centerY = (token.y0 + token.y1) / 2;
    const existing = lines.find((line) => Math.abs(line.y - centerY) <= lineTolerance);
    if (existing) {
      existing.tokens.push(token);
      existing.y =
        existing.tokens.reduce(
          (total, current) => total + (current.y0 + current.y1) / 2,
          0,
        ) / existing.tokens.length;
      existing.x0 = Math.min(existing.x0, token.x0);
      existing.x1 = Math.max(existing.x1, token.x1);
      existing.confidence =
        existing.tokens.reduce((total, current) => total + current.confidence, 0) /
        existing.tokens.length;
      existing.text = textFromTokens(existing.tokens);
    } else {
      lines.push({
        tokens: [token],
        text: normalizeText(token.text),
        x0: token.x0,
        x1: token.x1,
        y: centerY,
        confidence: token.confidence,
      });
    }
  }

  return lines.sort((left, right) => left.y - right.y);
}

function isHeaderLine(line: TextLine): boolean {
  const text = normalizeText(line.text).toLowerCase();
  return (
    /before\s*check\s*-?\s*in/.test(text) ||
    /after\s*check\s*-?\s*out/.test(text) ||
    /\bnama\s+item\b/.test(text) ||
    /\bcatatan\b/.test(text) ||
    /\bdokumentasi\b/.test(text)
  );
}

function hasBeforeColumn(line: TextLine): boolean {
  const text = normalizeText(line.text).toLowerCase();
  return /before\s*check\s*-?\s*in/.test(text);
}

function hasAfterColumn(line: TextLine): boolean {
  const text = normalizeText(line.text).toLowerCase();
  return /after\s*check\s*-?\s*out/.test(text);
}

function isCombinedTableHeader(line: TextLine): boolean {
  return hasBeforeColumn(line) && hasAfterColumn(line);
}

function isSectionTitleCandidate(line: TextLine, headerY: number): boolean {
  const text = normalizeText(line.text);
  if (!text || isHeaderLine(line) || text.length > 90) {
    return false;
  }

  const normalized = text.toLowerCase();
  if (
    /\b(apartemen|detail unit|kode unit|nama penyewa|quality control)\b/.test(
      normalized,
    )
  ) {
    return false;
  }

  const center = (line.x0 + line.x1) / 2;
  return (
    center >= 0.32 &&
    center <= 0.68 &&
    line.y < headerY &&
    headerY - line.y <= 0.08
  );
}

function getCellTokens(
  lines: TextLine[],
  minX: number,
  maxX: number,
): PositionedText[] {
  return lines.flatMap((line) =>
    line.tokens.filter((token) => {
      const center = (token.x0 + token.x1) / 2;
      const tokenText = normalizeText(token.text).toLowerCase();
      return (
        center >= minX &&
        center < maxX &&
        tokenText !== "catatan" &&
        tokenText !== "dokumentasi"
      );
    }),
  );
}

function cleanCell(tokens: PositionedText[]): string {
  return textFromTokens(tokens)
    .replace(/\b(catatan|dokumentasi)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isEmptyNoteValue(value: string): boolean {
  return /^[\s.·•…\-–—]*$/.test(value);
}

function numberedNoteEntries(line: string): string[] | null {
  const markerPattern = /(^|\s)(\d+)\s*[.)](?=\s|[.·•…]|[A-Za-zÀ-ÿ]|$)/g;
  const markers = Array.from(line.matchAll(markerPattern));
  if (markers.length === 0) {
    return null;
  }

  const entries: string[] = [];
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    if (marker.index === undefined) {
      continue;
    }
    const contentStart = marker.index + marker[0].length;
    const nextMarker = markers[index + 1];
    const contentEnd =
      nextMarker?.index === undefined
        ? line.length
        : nextMarker.index + nextMarker[1].length;
    const value = line
      .slice(contentStart, contentEnd)
      .replace(/^[.·•…\s]+/, "")
      .trim();
    if (!isEmptyNoteValue(value)) {
      entries.push(marker[2] + ". " + value);
    }
  }
  return entries;
}

function cleanNoteCell(tokens: PositionedText[]): string[] {
  const entries: string[] = [];
  const lines = groupLines(tokens);

  for (const line of lines) {
    const text = line.text
      .replace(/\b(catatan|dokumentasi)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) {
      continue;
    }

    const numberedEntries = numberedNoteEntries(text);
    if (numberedEntries !== null) {
      entries.push(...numberedEntries);
      continue;
    }

    if (isEmptyNoteValue(text)) {
      continue;
    }
    if (entries.length > 0) {
      entries[entries.length - 1] += " " + text;
    } else {
      entries.push(text);
    }
  }

  return entries;
}

function deduplicateRepeatedTitle(value: string): string {
  const words = value.trim().split(/\s+/);
  for (let phraseLength = 1; phraseLength <= words.length / 2; phraseLength += 1) {
    if (words.length % phraseLength !== 0) {
      continue;
    }
    const phrase = words.slice(0, phraseLength);
    const repeats = words.every(
      (word, index) => word.toLowerCase() === phrase[index % phraseLength].toLowerCase(),
    );
    if (repeats) {
      return phrase.join(" ");
    }
  }
  return value;
}

function confidenceFromTokens(tokens: PositionedText[]): Confidence {
  if (tokens.length === 0) {
    return "high";
  }
  const average =
    tokens.reduce((total, token) => total + token.confidence, 0) / tokens.length;
  return average < 55 ? "low" : "high";
}

function detectMetadata(layout: PageLayout, metadata: Record<MetadataKey, ExtractedValue>) {
  const lines = groupLines(layout.tokens);
  const combinedPattern = new RegExp(
    METADATA_FIELDS.map((field) => "(" + field.pattern + ")").join("|"),
    "gi",
  );

  for (const line of lines) {
    const matches = Array.from(line.text.matchAll(combinedPattern));
    for (let index = 0; index < matches.length; index += 1) {
      const match = matches[index];
      if (match.index === undefined) {
        continue;
      }
      const matchedPatternIndex = match.findIndex((part, partIndex) => partIndex > 0 && part);
      const definition = METADATA_FIELDS[matchedPatternIndex - 1];
      if (!definition || metadata[definition.key].value) {
        continue;
      }

      const valueStart = match.index + match[0].length;
      const valueEnd =
        index + 1 < matches.length && matches[index + 1].index !== undefined
          ? matches[index + 1].index
          : line.text.length;
      const value = line.text
        .slice(valueStart, valueEnd)
        .replace(/^[\s:：\-]+/, "")
        .replace(/[\s:：]+$/, "")
        .trim();
      if (value) {
        metadata[definition.key] = {
          value,
          confidence: line.confidence < 55 ? "low" : "high",
          page: layout.pageNumber,
        };
      }
    }
  }
}

function findTableHeaders(
  lines: TextLine[],
): Array<{ index: number; endIndex: number; titleIndex: number }> {
  const tables: Array<{ index: number; endIndex: number; titleIndex: number }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    let headerEndIndex = index;
    if (!isCombinedTableHeader(lines[index])) {
      if (!hasBeforeColumn(lines[index])) {
        continue;
      }
      let afterHeaderIndex = -1;
      for (
        let candidate = index + 1;
        candidate < lines.length && candidate <= index + 3;
        candidate += 1
      ) {
        if (lines[candidate].y - lines[index].y > 0.035) {
          break;
        }
        if (hasAfterColumn(lines[candidate])) {
          afterHeaderIndex = candidate;
          break;
        }
      }
      if (afterHeaderIndex < 0) {
        continue;
      }
      headerEndIndex = afterHeaderIndex;
    }

    if (tables.some((table) => index <= table.endIndex)) {
      continue;
    }

    let titleIndex = -1;
    for (let candidate = index - 1; candidate >= 0; candidate -= 1) {
      if (isSectionTitleCandidate(lines[candidate], lines[index].y)) {
        titleIndex = candidate;
        break;
      }
      if (lines[index].y - lines[candidate].y > 0.1) {
        break;
      }
    }
    tables.push({ index, endIndex: headerEndIndex, titleIndex });
  }
  return tables;
}

function isFirstColumnLine(line: TextLine): boolean {
  if (isHeaderLine(line)) {
    return false;
  }
  return line.tokens.some((token) => (token.x0 + token.x1) / 2 < 0.145);
}

function collectRows(
  lines: TextLine[],
  pageNumber: number,
  warnings: ReviewFlag[],
  startIndex: number,
  endIndex: number,
  sectionTitle: string,
): ReportItem[] {
  const bodyLines = lines
    .slice(startIndex, endIndex)
    .filter((line) => !isHeaderLine(line) && line.text.trim().length > 0);
  const candidates = bodyLines
    .map((line, bodyIndex) => ({ bodyIndex, line }))
    .filter(({ line }) => isFirstColumnLine(line));
  const gaps = candidates
    .slice(1)
    .map((candidate, index) => candidate.line.y - candidates[index].line.y)
    .filter((gap) => gap > 0)
    .sort((left, right) => left - right);
  const lineHeights = candidates
    .map(({ line }) => {
      const top = Math.min(...line.tokens.map((token) => token.y0));
      const bottom = Math.max(...line.tokens.map((token) => token.y1));
      return bottom - top;
    })
    .sort((left, right) => left - right);
  const medianLineHeight = lineHeights[Math.floor(lineHeights.length / 2)] || 0;
  let rowStartGap = Math.max(0.026, Math.min(0.06, medianLineHeight * 2.2));

  for (let index = 1; index < gaps.length; index += 1) {
    const smallerGap = gaps[index - 1];
    const largerGap = gaps[index];
    if (
      smallerGap < rowStartGap &&
      largerGap > rowStartGap &&
      largerGap >= smallerGap * 1.9
    ) {
      rowStartGap = (smallerGap + largerGap) / 2;
    }
  }

  const starts = candidates.filter((candidate, index) => {
    return index === 0 || candidate.line.y - candidates[index - 1].line.y > rowStartGap;
  });

  if (starts.length === 0) {
    return [];
  }

  return starts.map((start, index) => {
    const nextStart = starts[index + 1];
    const end = nextStart ? nextStart.bodyIndex : bodyLines.length;
    const rowLines = bodyLines.slice(start.bodyIndex, end);
    const firstColumn = getCellTokens(rowLines, 0, 0.145);
    const beforeTokens = getCellTokens(rowLines, 0.145, 0.30);
    const afterTokens = getCellTokens(rowLines, 0.84, 1.01);
    const name = cleanCell(firstColumn);
    const before = cleanNoteCell(beforeTokens);
    const after = cleanNoteCell(afterTokens);
    const confidence = confidenceFromTokens(firstColumn);
    const sectionConfidence = confidenceFromTokens([
      ...firstColumn,
      ...beforeTokens,
      ...afterTokens,
    ]);

    if (!name) {
      warnings.push({
        id: "item-name-" + pageNumber + "-" + index,
        page: pageNumber,
        message: "Nama item pada bagian " + sectionTitle + " belum terbaca.",
      });
    }
    if (confidence === "low" || sectionConfidence === "low") {
      warnings.push({
        id: "item-confidence-" + pageNumber + "-" + index,
        page: pageNumber,
        message: "Teks pada item " + (name || "yang tidak bernama") + " perlu ditinjau.",
      });
    }

    return {
      name: name || "(Nama item tidak terbaca)",
      beforeCheckIn: before.length > 0 ? before : [EMPTY_VALUE],
      afterCheckOut: after.length > 0 ? after : [EMPTY_VALUE],
      confidence: sectionConfidence,
      page: pageNumber,
    };
  });
}

function appendContinuedItems(
  section: ReportSection,
  items: ReportItem[],
  warnings: ReviewFlag[],
): void {
  if (items.length === 0) {
    return;
  }
  section.items.push(...items);
  if (section.layoutWarningId) {
    const warningIndex = warnings.findIndex(
      (warning) => warning.id === section.layoutWarningId,
    );
    if (warningIndex >= 0) {
      warnings.splice(warningIndex, 1);
    }
    delete section.layoutWarningId;
  }
}

function parsePageSections(
  layout: PageLayout,
  warnings: ReviewFlag[],
  sections: ReportSection[],
): void {
  const lines = groupLines(layout.tokens);
  const tables = findTableHeaders(lines);
  const lastSection = sections[sections.length - 1];

  if (tables.length === 0 && lastSection) {
    const continuationItems = collectRows(
      lines,
      layout.pageNumber,
      warnings,
      0,
      lines.length,
      lastSection.title,
    );
    appendContinuedItems(lastSection, continuationItems, warnings);
    return;
  }

  if (tables.length > 0 && lastSection) {
    const firstTable = tables[0];
    const continuationEnd = firstTable.titleIndex >= 0
      ? firstTable.titleIndex
      : firstTable.index;
    const leadingContinuationItems = collectRows(
      lines,
      layout.pageNumber,
      warnings,
      0,
      continuationEnd,
      lastSection.title,
    );
    appendContinuedItems(lastSection, leadingContinuationItems, warnings);
  }

  for (let index = 0; index < tables.length; index += 1) {
    const table = tables[index];
    const nextTable = tables[index + 1];
    const nextTitle = nextTable?.titleIndex ?? -1;
    const bodyEndIndex =
      nextTitle > table.index ? nextTitle : nextTable?.index ?? lines.length;
    const titleLine = table.titleIndex >= 0 ? lines[table.titleIndex] : undefined;
    const detectedTitle = titleLine
      ? deduplicateRepeatedTitle(titleLine.text)
      : "";
    const activeSection = sections[sections.length - 1];
    const continuesPrevious =
      Boolean(activeSection) &&
      (!detectedTitle ||
        normalizeText(detectedTitle).toLowerCase() ===
          normalizeText(activeSection.title).toLowerCase());
    const title = detectedTitle || activeSection?.title || "(Nama bagian tidak terbaca)";
    const items = collectRows(
      lines,
      layout.pageNumber,
      warnings,
      table.endIndex + 1,
      bodyEndIndex,
      title,
    );

    if (continuesPrevious && activeSection) {
      appendContinuedItems(activeSection, items, warnings);
      continue;
    }

    let layoutWarningId: string | undefined;
    if (titleLine && confidenceFromTokens(titleLine.tokens) === "low") {
      warnings.push({
        id: "section-confidence-" + layout.pageNumber + "-" + index,
        page: layout.pageNumber,
        message: "Nama bagian " + title + " perlu ditinjau.",
      });
    }
    if (!titleLine || items.length === 0) {
      layoutWarningId = "section-layout-" + layout.pageNumber + "-" + index;
      warnings.push({
        id: layoutWarningId,
        page: layout.pageNumber,
        message: "Bagian laporan pada halaman ini tidak terbaca lengkap.",
      });
    }

    sections.push({
      title,
      items,
      confidence: titleLine && confidenceFromTokens(titleLine.tokens) === "high" ? "high" : "low",
      page: layout.pageNumber,
      layoutWarningId,
    });
  }
}

function isUsableTextLayer(tokens: PositionedText[]): boolean {
  const words = tokens.flatMap((token) => token.text.match(/[a-z0-9]+/gi) || []);
  const letters = words.join("").length;
  const tableContentWords = tokens
    .filter((token) => {
      const center = (token.x0 + token.x1) / 2;
      const normalized = normalizeText(token.text).toLowerCase();
      const isDataColumn = center < 0.30 || center >= 0.84;
      const isInTableBody = token.y0 >= 0.24;
      const isHeading =
        /^(nama item|catatan|dokumentasi|before|check-in|check-in|after|check-out)$/i.test(
          normalized,
        ) ||
        /before\s*check|after\s*check/.test(normalized);
      return isDataColumn && isInTableBody && !isHeading;
    })
    .flatMap((token) => token.text.match(/[a-z0-9]+/gi) || []).length;
  return words.length >= 4 && letters >= 24 && tableContentWords >= 2;
}

function localizedOcrStatus(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized.includes("recognizing")) {
    return "Mengenali teks";
  }
  if (normalized.includes("language")) {
    return "Memuat data bahasa";
  }
  if (normalized.includes("core")) {
    return "Memuat mesin OCR";
  }
  if (normalized.includes("initial")) {
    return "Menyiapkan mesin OCR";
  }
  return "Menyiapkan OCR";
}

function pdfTextTokens(
  textContent: { items: Array<unknown> },
  pdfjs: {
    Util: { transform: (matrixA: number[], matrixB: number[]) => number[] };
  },
  viewport: { width: number; height: number; transform: number[] },
): PositionedText[] {
  const tokens: PositionedText[] = [];
  for (const rawItem of textContent.items) {
    if (!rawItem || typeof rawItem !== "object" || !("str" in rawItem)) {
      continue;
    }
    const item = rawItem as {
      str: string;
      transform: number[];
      width: number;
      height: number;
    };
    const text = item.str.trim();
    if (!text || !item.transform) {
      continue;
    }
    const transformed = pdfjs.Util.transform(viewport.transform, item.transform);
    const left = transformed[4];
    const baseline = transformed[5];
    const width = Math.max(item.width, 1);
    const height = Math.max(item.height, 2);
    tokens.push({
      text,
      x0: clamp(left / viewport.width),
      x1: clamp((left + width) / viewport.width),
      y0: clamp((baseline - height) / viewport.height),
      y1: clamp(baseline / viewport.height),
      confidence: 100,
    });
  }
  return tokens;
}

function ocrTokens(
  words: Array<{
    text: string;
    confidence: number;
    bbox: { x0: number; x1: number; y0: number; y1: number };
  }> | undefined,
  width: number,
  height: number,
): PositionedText[] {
  return (words || [])
    .filter((word) => word.text.trim())
    .map((word) => ({
      text: word.text,
      x0: clamp(word.bbox.x0 / width),
      x1: clamp(word.bbox.x1 / width),
      y0: clamp(word.bbox.y0 / height),
      y1: clamp(word.bbox.y1 / height),
      confidence: word.confidence,
    }));
}

function makeWarningsForMissingMetadata(
  metadata: Record<MetadataKey, ExtractedValue>,
  warnings: ReviewFlag[],
): void {
  for (const field of METADATA_FIELDS) {
    if (!metadata[field.key].value) {
      warnings.push({
        id: "missing-" + field.key,
        page: 1,
        message: field.label + " belum terdeteksi.",
      });
    } else if (metadata[field.key].confidence === "low") {
      warnings.push({
        id: "low-" + field.key,
        page: metadata[field.key].page,
        message: field.label + " perlu ditinjau.",
      });
    }
  }
}

function readablePdfError(error: unknown): PdfExtractionError {
  const candidate = error as { name?: string; message?: string };
  const message = (candidate?.message || "").toLowerCase();
  if (candidate?.name === "PasswordException" || message.includes("password")) {
    return new PdfExtractionError(
      "PDF ini dilindungi kata sandi. Simpan salinan tanpa kata sandi, lalu coba lagi.",
    );
  }
  if (
    candidate?.name === "InvalidPDFException" ||
    message.includes("invalid pdf") ||
    message.includes("malformed")
  ) {
    return new PdfExtractionError(
      "File ini tidak dapat dibaca sebagai PDF. Periksa file atau pilih PDF lain.",
    );
  }
  return new PdfExtractionError(
    "PDF tidak dapat diproses. Pastikan file tidak rusak atau dilindungi kata sandi, lalu coba lagi.",
  );
}

export async function extractCheckoutReport(
  file: File,
  onProgress: (progress: ExtractionProgress) => void,
): Promise<CheckoutReport> {
  onProgress({
    page: 0,
    totalPages: 0,
    message: "Membuka PDF di browser...",
  });

  let loadingTask: PDFDocumentLoadingTask | undefined;
  let pdfDocument: PDFDocumentProxy | undefined;
  let ocrWorker: OcrWorker | undefined;
  const metadata = makeEmptyMetadata();
  const sections: ReportSection[] = [];
  const reviewFlags: ReviewFlag[] = [];
  let activeOcrPage = 1;

  try {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";
    const buffer = await file.arrayBuffer();
    loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
    });
    pdfDocument = await loadingTask.promise;

    if (!pdfDocument || pdfDocument.numPages < 1) {
      throw new PdfExtractionError("PDF ini tidak memiliki halaman yang dapat dibaca.");
    }

    const pageCount = pdfDocument.numPages;
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      activeOcrPage = pageNumber;
      onProgress({
        page: pageNumber,
        totalPages: pageCount,
        message: "Membaca halaman " + pageNumber + " dari " + pageCount + "...",
      });

      const page = await pdfDocument.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent();
      let tokens = pdfTextTokens(textContent, pdfjs, viewport);

      if (!isUsableTextLayer(tokens)) {
        onProgress({
          page: pageNumber,
          totalPages: pageCount,
          message: "OCR halaman " + pageNumber + " dari " + pageCount + "...",
        });

        if (!ocrWorker) {
          try {
            const { createWorker } = await import("tesseract.js");
            ocrWorker = (await createWorker(["eng", "ind"], undefined, {
              logger: (status: { status?: string; progress?: number }) => {
                const stage = localizedOcrStatus(status.status || "");
                const percent =
                  typeof status.progress === "number"
                    ? " " + Math.round(status.progress * 100) + "%"
                    : "";
                onProgress({
                  page: activeOcrPage,
                  totalPages: pageCount,
                  message:
                    "OCR halaman " +
                    activeOcrPage +
                    " dari " +
                    pageCount +
                    " · " +
                    stage +
                    percent,
                });
              },
            })) as unknown as OcrWorker;
          } catch {
            throw new PdfExtractionError(
              "Komponen OCR tidak dapat dimuat. Periksa koneksi internet, lalu coba lagi.",
            );
          }
        }

        const scale = Math.min(2.5, Math.max(1.8, 1800 / viewport.width));
        const renderViewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(renderViewport.width);
        canvas.height = Math.ceil(renderViewport.height);
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) {
          throw new PdfExtractionError("Browser tidak dapat menyiapkan halaman untuk OCR.");
        }
        await page.render({
          canvas,
          canvasContext: context,
          viewport: renderViewport,
        }).promise;
        const result = await ocrWorker.recognize(canvas);
        tokens = ocrTokens(result.data.words, canvas.width, canvas.height);
        canvas.width = 0;
        canvas.height = 0;
      }

      const layout: PageLayout = {
        pageNumber,
        width: viewport.width,
        height: viewport.height,
        tokens,
      };
      if (pageNumber === 1) {
        detectMetadata(layout, metadata);
      }
      parsePageSections(layout, reviewFlags, sections);
      page.cleanup();
    }

    makeWarningsForMissingMetadata(metadata, reviewFlags);
    if (sections.length === 0) {
      reviewFlags.push({
        id: "no-sections",
        page: null,
        message: "Bagian dan baris item belum terdeteksi. Periksa teks hasil ekstraksi.",
      });
    }

    return {
      metadata,
      sections,
      reviewFlags,
      pageCount,
    };
  } catch (error) {
    if (error instanceof PdfExtractionError) {
      throw error;
    }
    throw readablePdfError(error);
  } finally {
    if (ocrWorker) {
      await ocrWorker.terminate().catch(() => undefined);
    }
    if (loadingTask) {
      await loadingTask.destroy().catch(() => undefined);
    }
  }
}

function alphabeticItemLabel(index: number): string {
  let value = index + 1;
  let label = "";
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

export function formatCheckoutReport(report: CheckoutReport): string {
  const metadataLines = METADATA_FIELDS.map((field) => {
    const value = report.metadata[field.key].value || UNKNOWN_VALUE;
    return "- " + field.label + ": " + value;
  });
  const output = ["**Laporan Check-Out**", "", ...metadataLines, ""];

  report.sections.forEach((section, sectionIndex) => {
    output.push((sectionIndex + 1) + ". " + section.title);
    section.items.forEach((item, itemIndex) => {
      output.push("  " + alphabeticItemLabel(itemIndex) + ". " + item.name);
      output.push("    ■ Before Check-In");
      for (const note of item.beforeCheckIn.length > 0 ? item.beforeCheckIn : [EMPTY_VALUE]) {
        output.push("      -> " + note);
      }
      output.push("    ■ After Check Out");
      for (const note of item.afterCheckOut.length > 0 ? item.afterCheckOut : [EMPTY_VALUE]) {
        output.push("      -> " + note);
      }
    });
    if (sectionIndex < report.sections.length - 1) {
      output.push("");
    }
  });

  return output.join("\n").trimEnd();
}
