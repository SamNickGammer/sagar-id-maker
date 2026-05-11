export type Unit = "in" | "mm" | "px";
export type LayerType = "text" | "photo";
export type ImageFit = "cover" | "contain" | "stretch" | "center";
export type TextAlign = "left" | "center" | "right";

export type CardSize = {
  preset: string;
  width: number;
  height: number;
  unit: Unit;
};

export type TemplateImage = {
  name: string;
  dataUrl: string;
  fit: ImageFit;
};

type BaseLayer = {
  id: string;
  type: LayerType;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TextLayer = BaseLayer & {
  type: "text";
  field: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  align: TextAlign;
  bold: boolean;
  italic: boolean;
};

export type PhotoLayer = BaseLayer & {
  type: "photo";
  field: string;
  fit: Exclude<ImageFit, "center">;
  zoom: number;
  offsetX: number;
  offsetY: number;
  radius: number;
};

export type Layer = TextLayer | PhotoLayer;

export type ProjectFile = {
  path: string;
  name: string;
  bytes: ArrayBuffer;
  dataUrl?: string;
  mime: string;
};

export type ProjectData = {
  rootName: string;
  rootPath?: string;
  spreadsheetName: string;
  columns: string[];
  rows: Record<string, string>[];
  files: Record<string, ProjectFile>;
  layoutJson?: string;
  template?: TemplateImage;
};

export type PaperPreset = "A4" | "Letter" | "Legal" | "Custom";

export type ExportSettings = {
  paperPreset: PaperPreset;
  paperWidth: number;
  paperHeight: number;
  unit: Unit;
  autoGrid: boolean;
  columns: number;
  rows: number;
  marginX: number;
  marginY: number;
  gapX: number;
  gapY: number;
  cropMarks: boolean;
  rotateCards: boolean;
};

export type SavedLayout = {
  version: 1;
  card: CardSize;
  template: TemplateImage | null;
  layers: Layer[];
  globalFont: string;
  exportSettings: ExportSettings;
};
