import { degrees, PDFDocument, rgb } from "pdf-lib";
import * as XLSX from "xlsx";
import type {
  CardSize,
  ExportSettings,
  ImageFit,
  Layer,
  PhotoLayer,
  ProjectData,
  ProjectFile,
  SavedLayout,
  TemplateImage,
  TextLayer,
  Unit
} from "./types";

const DPI = 96;
const PDF_DPI = 72;

export const isTauri = () =>
  typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);

export const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

export const normalizePath = (path: string) =>
  path.replaceAll("\\", "/").replace(/^\.?\//, "").replace(/\/+/g, "/");

export const fileNameFromPath = (path: string) => normalizePath(path).split("/").pop() ?? path;

export const extname = (path: string) => {
  const name = fileNameFromPath(path);
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
};

export const guessMime = (path: string) => {
  const ext = extname(path);
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "csv") return "text/csv";
  if (ext === "json") return "application/json";
  if (ext === "ttf") return "font/ttf";
  if (ext === "otf") return "font/otf";
  return "application/octet-stream";
};

export const isImagePath = (path: string) => ["png", "jpg", "jpeg"].includes(extname(path));
export const isSpreadsheetPath = (path: string) => ["xlsx", "xls", "csv"].includes(extname(path));

export const detectImageMime = (path: string, bytes: ArrayBuffer) => {
  const header = new Uint8Array(bytes.slice(0, 16));
  if (
    header[0] === 0x89 &&
    header[1] === 0x50 &&
    header[2] === 0x4e &&
    header[3] === 0x47
  ) {
    return "image/png";
  }
  if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return "image/jpeg";
  if (
    header[0] === 0x52 &&
    header[1] === 0x49 &&
    header[2] === 0x46 &&
    header[3] === 0x46 &&
    header[8] === 0x57 &&
    header[9] === 0x45 &&
    header[10] === 0x42 &&
    header[11] === 0x50
  ) {
    return "image/webp";
  }
  return guessMime(path);
};

export const arrayBufferToDataUrl = (bytes: ArrayBuffer, mime: string) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([bytes], { type: mime }));
  });

export const unitToPx = (value: number, unit: Unit) => {
  if (unit === "in") return value * DPI;
  if (unit === "mm") return (value / 25.4) * DPI;
  return value;
};

export const unitToPt = (value: number, unit: Unit) => {
  if (unit === "in") return value * PDF_DPI;
  if (unit === "mm") return (value / 25.4) * PDF_DPI;
  return (value / DPI) * PDF_DPI;
};

export const sizeToPx = (size: CardSize) => ({
  width: unitToPx(size.width, size.unit),
  height: unitToPx(size.height, size.unit)
});

export const sizeToPt = (size: { width: number; height: number; unit: Unit }) => ({
  width: unitToPt(size.width, size.unit),
  height: unitToPt(size.height, size.unit)
});

export const readSpreadsheet = (file: ProjectFile) => {
  const workbook = XLSX.read(file.bytes, {
    type: "array",
    cellDates: false,
    raw: false
  });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, {
    defval: "",
    raw: false
  });
  const columns = rawRows.length
    ? Object.keys(rawRows[0])
    : XLSX.utils.sheet_to_json<string[]>(firstSheet, { header: 1 })[0] ?? [];
  const rows = rawRows.map((row) =>
    Object.fromEntries(columns.map((column) => [column, String(row[column] ?? "")]))
  );

  return { columns, rows };
};

export const importBrowserProject = async (fileList: FileList): Promise<ProjectData> => {
  const files = Array.from(fileList);
  const entries: Record<string, ProjectFile> = {};
  const rootName = files[0]?.webkitRelativePath?.split("/")[0] || "Project";

  for (const file of files) {
    const rawPath = normalizePath(file.webkitRelativePath || file.name);
    const path = rawPath.startsWith(`${rootName}/`)
      ? normalizePath(rawPath.slice(rootName.length + 1))
      : rawPath;
    const bytes = await file.arrayBuffer();
    const mime = isImagePath(path) ? detectImageMime(path, bytes) : file.type || guessMime(path);
    entries[path] = {
      path,
      name: file.name,
      bytes,
      mime,
      dataUrl: isImagePath(path) ? await arrayBufferToDataUrl(bytes, mime) : undefined
    };
  }

  return buildProjectFromFiles(entries, rootName);
};

export const importTauriProject = async (): Promise<ProjectData | null> => {
  const dialog = await import("@tauri-apps/plugin-dialog");
  const fs = await import("@tauri-apps/plugin-fs");
  const selected = await dialog.open({ directory: true, multiple: false });
  if (!selected || Array.isArray(selected)) return null;

  const rootPath = String(selected);
  const rootName = fileNameFromPath(rootPath);
  const entries: Record<string, ProjectFile> = {};

  const walk = async (absolutePath: string, relativePrefix = "") => {
    const dirEntries = await fs.readDir(absolutePath);
    for (const entry of dirEntries as Array<any>) {
      const name = entry.name as string;
      const absolute = joinLocalPath(absolutePath, name);
      const relative = normalizePath(relativePrefix ? `${relativePrefix}/${name}` : name);
      const isDir = Boolean(entry.isDirectory);
      const isFile = Boolean(entry.isFile) || !isDir;
      if (isDir) {
        await walk(absolute, relative);
      } else if (isFile) {
        const bytesRaw = await fs.readFile(absolute);
        const bytes = toArrayBuffer(bytesRaw);
        const mime = isImagePath(relative) ? detectImageMime(relative, bytes) : guessMime(relative);
        entries[relative] = {
          path: relative,
          name,
          bytes,
          mime,
          dataUrl: isImagePath(relative) ? await arrayBufferToDataUrl(bytes, mime) : undefined
        };
      }
    }
  };

  await walk(rootPath);
  const project = await buildProjectFromFiles(entries, rootName);
  project.rootPath = rootPath;
  return project;
};

const toArrayBuffer = (bytes: Uint8Array | ArrayBuffer): ArrayBuffer => {
  if (bytes instanceof ArrayBuffer) return bytes;
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
};

export const joinLocalPath = (base: string, name: string) => {
  const separator = base.includes("\\") ? "\\" : "/";
  return base.endsWith("/") || base.endsWith("\\") ? `${base}${name}` : `${base}${separator}${name}`;
};

export const buildProjectFromFiles = async (
  files: Record<string, ProjectFile>,
  rootName: string
): Promise<ProjectData> => {
  const paths = Object.keys(files);
  const spreadsheetPath = paths.find((path) => isSpreadsheetPath(path) && !path.includes("~$"));
  if (!spreadsheetPath) {
    throw new Error("No spreadsheet found. Add a .xlsx, .xls, or .csv file inside the folder.");
  }

  const spreadsheet = files[spreadsheetPath];
  const parsed = readSpreadsheet(spreadsheet);
  const templatePath = paths.find((path) => isImagePath(path) && path.split("/").length === 1);
  const layoutPath = paths.find((path) => fileNameFromPath(path) === "id-maker-layout.json");
  const layoutJson = layoutPath
    ? new TextDecoder().decode(files[layoutPath].bytes)
    : undefined;

  return {
    rootName,
    spreadsheetName: spreadsheet.name,
    columns: parsed.columns,
    rows: parsed.rows,
    files,
    layoutJson,
    template: templatePath
      ? {
          name: files[templatePath].name,
          dataUrl: files[templatePath].dataUrl!,
          fit: "cover"
        }
      : undefined
  };
};

export const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image."));
    img.src = src;
  });

export const drawImageFit = (
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
  fit: ImageFit,
  zoom = 1,
  offsetX = 0,
  offsetY = 0
) => {
  let drawWidth = width;
  let drawHeight = height;

  if (fit === "contain" || fit === "center") {
    const scale = fit === "center" ? 1 : Math.min(width / img.width, height / img.height);
    drawWidth = img.width * scale;
    drawHeight = img.height * scale;
  }

  if (fit === "cover") {
    const scale = Math.max(width / img.width, height / img.height) * zoom;
    drawWidth = img.width * scale;
    drawHeight = img.height * scale;
  }

  if (fit === "stretch") {
    ctx.drawImage(img, x, y, width, height);
    return;
  }

  const dx = x + (width - drawWidth) / 2 + offsetX;
  const dy = y + (height - drawHeight) / 2 + offsetY;
  ctx.drawImage(img, dx, dy, drawWidth, drawHeight);
};

const commonPhotoFolders = ["photo", "photos", "image", "images", "student photo", "student photos"];

const pathMatches = (filePath: string, wanted: string) => {
  const file = normalizePath(filePath).toLowerCase();
  const target = normalizePath(wanted).toLowerCase();
  const targetName = fileNameFromPath(target).toLowerCase();
  const fileName = fileNameFromPath(file).toLowerCase();

  return (
    file === target ||
    file.endsWith(`/${target}`) ||
    fileName === target ||
    fileName === targetName ||
    commonPhotoFolders.some((folder) => file === `${folder}/${target}` || file.endsWith(`/${folder}/${target}`))
  );
};

export const resolveProjectImageFile = (project: ProjectData | null, value: string) => {
  if (!project || !value) return undefined;
  const wanted = normalizePath(value.trim());
  const decoded = normalizePath(decodeURIComponent(wanted));
  const direct =
    project.files[wanted] ||
    project.files[decoded] ||
    project.files[normalizePath(wanted.toLowerCase())];
  if (direct?.dataUrl) return direct;

  return Object.values(project.files).find(
    (file) => file.dataUrl && (pathMatches(file.path, wanted) || pathMatches(file.path, decoded))
  );
};

export const resolveProjectImage = (project: ProjectData | null, value: string) => {
  return resolveProjectImageFile(project, value)?.dataUrl;
};

export const renderCardPng = async (
  row: Record<string, string>,
  card: CardSize,
  template: TemplateImage | null,
  layers: Layer[],
  project: ProjectData | null,
  scale = 3
) => {
  const cardPx = sizeToPx(card);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(cardPx.width * scale);
  canvas.height = Math.round(cardPx.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas rendering is unavailable.");

  ctx.scale(scale, scale);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, cardPx.width, cardPx.height);

  if (template?.dataUrl) {
    const image = await loadImage(template.dataUrl);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, cardPx.width, cardPx.height);
    ctx.clip();
    drawImageFit(ctx, image, 0, 0, cardPx.width, cardPx.height, template.fit);
    ctx.restore();
  }

  for (const layer of layers) {
    if (layer.type === "photo") {
      const imageUrl = resolveProjectImage(project, row[layer.field]);
      if (!imageUrl) continue;
      const image = await loadImage(imageUrl);
      ctx.save();
      roundedRect(ctx, layer.x, layer.y, layer.width, layer.height, layer.radius);
      ctx.clip();
      drawImageFit(
        ctx,
        image,
        layer.x,
        layer.y,
        layer.width,
        layer.height,
        layer.fit,
        layer.zoom,
        layer.offsetX,
        layer.offsetY
      );
      ctx.restore();
    } else {
      drawTextLayer(ctx, layer, row[layer.field] ?? "");
    }
  }

  return canvas.toDataURL("image/png");
};

const drawTextLayer = (ctx: CanvasRenderingContext2D, layer: TextLayer, value: string) => {
  ctx.save();
  ctx.beginPath();
  ctx.rect(layer.x, layer.y, layer.width, layer.height);
  ctx.clip();
  ctx.fillStyle = layer.color;
  ctx.textAlign = layer.align;
  ctx.textBaseline = "top";
  ctx.font = `${layer.italic ? "italic " : ""}${layer.bold ? "700 " : "400 "} ${
    layer.fontSize
  }px "${layer.fontFamily}", sans-serif`;

  const x =
    layer.align === "center"
      ? layer.x + layer.width / 2
      : layer.align === "right"
        ? layer.x + layer.width
        : layer.x;
  const lines = wrapText(ctx, value, layer.width, layer.fontSize);
  lines.forEach((line, index) => ctx.fillText(line, x, layer.y + index * layer.fontSize * 1.18));
  ctx.restore();
};

const wrapText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  fontSize: number
) => {
  const words = String(text).split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth || !current) {
      current = next;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
};

const roundedRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) => {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
};

export const exportPdf = async (
  project: ProjectData,
  rows: Record<string, string>[],
  card: CardSize,
  template: TemplateImage | null,
  layers: Layer[],
  settings: ExportSettings,
  onProgress?: (done: number, total: number) => void
) => {
  const pdf = await PDFDocument.create();
  const paper = sizeToPt({
    width: settings.paperWidth,
    height: settings.paperHeight,
    unit: settings.unit
  });
  const cardPt = sizeToPt(card);
  const cardDraw = settings.rotateCards
    ? { width: cardPt.height, height: cardPt.width }
    : cardPt;
  const marginX = unitToPt(settings.marginX, settings.unit);
  const marginY = unitToPt(settings.marginY, settings.unit);
  const gapX = unitToPt(settings.gapX, settings.unit);
  const gapY = unitToPt(settings.gapY, settings.unit);
  const autoColumns = Math.max(
    1,
    Math.floor((paper.width - marginX * 2 + gapX) / (cardDraw.width + gapX))
  );
  const autoRows = Math.max(
    1,
    Math.floor((paper.height - marginY * 2 + gapY) / (cardDraw.height + gapY))
  );
  const columns = settings.autoGrid ? autoColumns : Math.max(1, settings.columns);
  const gridRows = settings.autoGrid ? autoRows : Math.max(1, settings.rows);
  const perPage = Math.max(1, columns * gridRows);

  let page = pdf.addPage([paper.width, paper.height]);
  for (let index = 0; index < rows.length; index += 1) {
    if (index > 0 && index % perPage === 0) {
      page = pdf.addPage([paper.width, paper.height]);
    }
    const slot = index % perPage;
    const col = slot % columns;
    const row = Math.floor(slot / columns);
    const x = marginX + col * (cardDraw.width + gapX);
    const y = paper.height - marginY - cardDraw.height - row * (cardDraw.height + gapY);
    const pngDataUrl = await renderCardPng(rows[index], card, template, layers, project, 3);
    const png = await pdf.embedPng(pngDataUrl);

    if (settings.rotateCards) {
      page.drawImage(png, {
        x,
        y,
        width: cardPt.width,
        height: cardPt.height,
        rotate: degrees(90)
      });
    } else {
      page.drawImage(png, { x, y, width: cardPt.width, height: cardPt.height });
    }

    if (settings.cropMarks) drawCropMarks(page, x, y, cardDraw.width, cardDraw.height);
    onProgress?.(index + 1, rows.length);
  }

  return pdf.save();
};

const drawCropMarks = (page: any, x: number, y: number, width: number, height: number) => {
  const mark = 10;
  const color = rgb(0.1, 0.1, 0.1);
  const thickness = 0.35;
  const lines = [
    [x - mark, y, x - 2, y],
    [x, y - mark, x, y - 2],
    [x + width + 2, y, x + width + mark, y],
    [x + width, y - mark, x + width, y - 2],
    [x - mark, y + height, x - 2, y + height],
    [x, y + height + 2, x, y + height + mark],
    [x + width + 2, y + height, x + width + mark, y + height],
    [x + width, y + height + 2, x + width, y + height + mark]
  ];
  for (const [x1, y1, x2, y2] of lines) {
    page.drawLine({
      start: { x: x1, y: y1 },
      end: { x: x2, y: y2 },
      color,
      thickness
    });
  }
};

export const buildLayout = (
  card: CardSize,
  template: TemplateImage | null,
  layers: Layer[],
  globalFont: string,
  exportSettings: ExportSettings
): SavedLayout => ({
  version: 1,
  card,
  template,
  layers,
  globalFont,
  exportSettings
});

export const downloadBytes = (bytes: Uint8Array, name: string, mime: string) => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const url = URL.createObjectURL(new Blob([copy.buffer], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 2000);
};

export const saveFile = async (bytes: Uint8Array | string, name: string, mime: string) => {
  if (isTauri()) {
    const dialog = await import("@tauri-apps/plugin-dialog");
    const fs = await import("@tauri-apps/plugin-fs");
    const path = await dialog.save({ defaultPath: name });
    if (!path) return;
    if (typeof bytes === "string") {
      await fs.writeTextFile(path, bytes);
    } else {
      await fs.writeFile(path, bytes);
    }
    return;
  }
  if (typeof bytes === "string") {
    downloadBytes(new TextEncoder().encode(bytes), name, mime);
  } else {
    downloadBytes(bytes, name, mime);
  }
};

export const saveTextToPath = async (path: string, content: string) => {
  const fs = await import("@tauri-apps/plugin-fs");
  await fs.writeTextFile(path, content);
};

export const injectGoogleFont = (url: string) => {
  if (!url.trim()) return;
  const id = `font-${btoa(url).replaceAll("=", "")}`;
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = url.trim();
  document.head.appendChild(link);
};
