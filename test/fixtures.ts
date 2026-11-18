import * as mupdf from "mupdf";

/** Build a small multi-page PDF with known text, in memory. */
export function makeTextPdf(pages = 3): Uint8Array {
  const doc = new mupdf.PDFDocument();
  const times = doc.addSimpleFont(new mupdf.Font("Times-Roman"));
  const helv = doc.addSimpleFont(new mupdf.Font("Helvetica-Bold"));
  for (let i = 0; i < pages; i++) {
    const res = doc.addObject({ Font: { F1: times, F2: helv } });
    const content =
      `BT /F2 20 Tf 0 0 1 rg 72 720 Td (Page ${i + 1} title) Tj ET\n` +
      `BT /F1 12 Tf 72 690 Td (The quick brown fox jumps over the lazy dog.) Tj ET\n` +
      `BT /F1 12 Tf 72 670 Td (Secret account number 12345678.) Tj ET\n` +
      `0 0 0 RG 2 w 72 650 m 540 650 l S\n`;
    doc.insertPage(-1, doc.addPage([0, 0, 612, 792], 0, res, content));
  }
  const buf = doc.saveToBuffer("compress");
  const out = buf.asUint8Array().slice();
  doc.destroy();
  return out;
}

export function pageText(bytes: Uint8Array, i = 0): string {
  const doc = mupdf.Document.openDocument(bytes, "application/pdf");
  const t = doc.loadPage(i).toStructuredText("").asText();
  doc.destroy();
  return t;
}

export function reopen(bytes: Uint8Array) {
  return mupdf.Document.openDocument(bytes, "application/pdf").asPDF() as mupdf.PDFDocument;
}

/** 1x1 red PNG */
export const PNG = Uint8Array.from(atob(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
