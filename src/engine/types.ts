// Types shared between the UI thread and the MuPDF worker.
// All coordinates are MuPDF "page space": PDF points, origin top-left, y grows downward,
// page rotation already applied.

export type Rect = [number, number, number, number];
export type Point = [number, number];
export type Quad = [number, number, number, number, number, number, number, number];
export type RGB = [number, number, number];

export interface PageInfo {
  w: number;
  h: number;
}

export interface DocInfo {
  pages: PageInfo[];
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
}

/** Result of every mutating engine call. */
export interface Change {
  /** Page indices whose rendering changed, or "all". */
  pages: number[] | "all";
  /** True when page count / order / size changed. */
  structure: boolean;
  info: DocInfo;
}

export type AnnotType =
  | "Highlight"
  | "Underline"
  | "StrikeOut"
  | "Squiggly"
  | "Text"
  | "FreeText"
  | "Square"
  | "Circle"
  | "Line"
  | "Ink"
  | "Polygon"
  | "PolyLine"
  | "Stamp"
  | "Redact"
  | string;

export type FreeTextFont = "Helv" | "TiRo" | "Cour";

export interface AnnotInfo {
  id: number;
  type: AnnotType;
  rect: Rect;
  contents: string;
  author: string;
  modified: number;
  color: number[];
  interior: number[];
  width: number;
  opacity: number;
  hasInterior: boolean;
  hasBorder: boolean;
  font?: string;
  fontSize?: number;
  line?: Point[];
  lineEnd?: string;
  ink?: Point[][];
  vertices?: Point[];
  quads?: Quad[];
}

export interface AnnotSpec {
  type: AnnotType;
  rect?: Rect;
  quads?: Quad[];
  line?: [Point, Point];
  lineEnd?: string;
  ink?: Point[][];
  vertices?: Point[];
  color?: number[];
  interior?: number[];
  width?: number;
  opacity?: number;
  contents?: string;
  author?: string;
  font?: FreeTextFont;
  fontSize?: number;
  /** PNG/JPEG bytes for image stamps (signatures, pictures). */
  image?: Uint8Array;
  icon?: string;
}

export type AnnotPatch = Partial<
  Pick<AnnotSpec, "color" | "interior" | "width" | "opacity" | "contents" | "font" | "fontSize" | "lineEnd" | "rect">
>;

export interface TextLine {
  id: number;
  bbox: Rect;
  text: string;
  fontName: string;
  size: number;
  color: RGB;
  origin: Point;
  dir: Point;
  bold: boolean;
  italic: boolean;
  serif: boolean;
  mono: boolean;
}

export type EditFont = "original" | "Helvetica" | "Times" | "Courier";

export interface TextEditSpec {
  text: string;
  font: EditFont;
  bold: boolean;
  italic: boolean;
  size: number;
  color: RGB;
}

export type WidgetKind = "text" | "checkbox" | "radio" | "combo" | "list" | "button" | "signature" | "unknown";

export interface WidgetInfo {
  id: number;
  kind: WidgetKind;
  name: string;
  rect: Rect;
  value: string;
  checked: boolean;
  options: string[];
  multiline: boolean;
  readOnly: boolean;
  maxLen: number;
}

export interface SearchHit {
  page: number;
  quads: Quad[];
}

export interface SaveOptions {
  flattenAnnots?: boolean;
  flattenForms?: boolean;
}
