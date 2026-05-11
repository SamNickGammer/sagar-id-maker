import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Download,
  FileImage,
  FolderOpen,
  Grid3X3,
  ImagePlus,
  Italic,
  LayoutTemplate,
  Move,
  Plus,
  Save,
  Type,
  Upload
} from "lucide-react";
import { ChangeEvent, PointerEvent, useMemo, useRef, useState } from "react";
import type {
  CardSize,
  ExportSettings,
  Layer,
  PhotoLayer,
  ProjectData,
  SavedLayout,
  TemplateImage,
  TextLayer,
  Unit
} from "./types";
import {
  buildLayout,
  exportPdf,
  importBrowserProject,
  importTauriProject,
  injectGoogleFont,
  isTauri,
  joinLocalPath,
  normalizePath,
  renderCardPng,
  resolveProjectImage,
  saveFile,
  saveTextToPath,
  sizeToPx,
  uid
} from "./lib";

const CARD_PRESETS: Array<{ id: string; label: string; width: number; height: number; unit: Unit }> =
  [
    { id: "2x3-portrait", label: "2 x 3 in portrait", width: 2, height: 3, unit: "in" },
    { id: "3x2-landscape", label: "3 x 2 in landscape", width: 3, height: 2, unit: "in" },
    { id: "cr80-landscape", label: "PVC/CR80 landscape", width: 85.6, height: 53.98, unit: "mm" },
    { id: "cr80-portrait", label: "PVC/CR80 portrait", width: 53.98, height: 85.6, unit: "mm" },
    { id: "custom", label: "Custom size", width: 3, height: 2, unit: "in" }
  ];

const PAPER_PRESETS = {
  A4: { width: 210, height: 297, unit: "mm" as Unit },
  Letter: { width: 8.5, height: 11, unit: "in" as Unit },
  Legal: { width: 8.5, height: 14, unit: "in" as Unit },
  Custom: { width: 210, height: 297, unit: "mm" as Unit }
};

const defaultCard: CardSize = { preset: "3x2-landscape", width: 3, height: 2, unit: "in" };
const defaultExport: ExportSettings = {
  paperPreset: "A4",
  paperWidth: 210,
  paperHeight: 297,
  unit: "mm",
  autoGrid: true,
  columns: 3,
  rows: 4,
  marginX: 8,
  marginY: 8,
  gapX: 4,
  gapY: 4,
  cropMarks: true,
  rotateCards: false
};

type DragState =
  | { mode: "move"; id: string; startX: number; startY: number; layerX: number; layerY: number }
  | {
      mode: "resize";
      id: string;
      startX: number;
      startY: number;
      width: number;
      height: number;
    };

export default function App() {
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const templateInputRef = useRef<HTMLInputElement | null>(null);
  const fontInputRef = useRef<HTMLInputElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  const [project, setProject] = useState<ProjectData | null>(null);
  const [card, setCard] = useState<CardSize>(defaultCard);
  const [template, setTemplate] = useState<TemplateImage | null>(null);
  const [layers, setLayers] = useState<Layer[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [globalFont, setGlobalFont] = useState("Aptos");
  const [googleFontUrl, setGoogleFontUrl] = useState("");
  const [exportSettings, setExportSettings] = useState<ExportSettings>(defaultExport);
  const [status, setStatus] = useState("Start by opening a project folder or importing a template.");
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [exportProgress, setExportProgress] = useState("");
  const [previewPng, setPreviewPng] = useState<string | null>(null);

  const cardPx = useMemo(() => sizeToPx(card), [card]);
  const currentRow = project?.rows[Math.min(previewIndex, Math.max(project.rows.length - 1, 0))] ?? {};
  const selectedLayer = layers.find((layer) => layer.id === selectedId) ?? null;
  const usableColumns = project?.columns ?? [];

  const gridEstimate = useMemo(() => {
    const paper = PAPER_PRESETS[exportSettings.paperPreset] ?? PAPER_PRESETS.A4;
    const paperWidth = exportSettings.paperPreset === "Custom" ? exportSettings.paperWidth : paper.width;
    const paperHeight =
      exportSettings.paperPreset === "Custom" ? exportSettings.paperHeight : paper.height;
    const paperUnit = exportSettings.paperPreset === "Custom" ? exportSettings.unit : paper.unit;
    const toBase = (value: number, unit: Unit) =>
      unit === "mm" ? value : unit === "in" ? value * 25.4 : (value / 96) * 25.4;
    const cardW = toBase(card.width, card.unit);
    const cardH = toBase(card.height, card.unit);
    const paperW = toBase(paperWidth, paperUnit);
    const paperH = toBase(paperHeight, paperUnit);
    const marginX = toBase(exportSettings.marginX, exportSettings.unit);
    const marginY = toBase(exportSettings.marginY, exportSettings.unit);
    const gapX = toBase(exportSettings.gapX, exportSettings.unit);
    const gapY = toBase(exportSettings.gapY, exportSettings.unit);
    return {
      columns: Math.max(1, Math.floor((paperW - marginX * 2 + gapX) / (cardW + gapX))),
      rows: Math.max(1, Math.floor((paperH - marginY * 2 + gapY) / (cardH + gapY)))
    };
  }, [card, exportSettings]);

  const openProject = async () => {
    try {
      if (isTauri()) {
        const nextProject = await importTauriProject();
        if (nextProject) applyProject(nextProject);
      } else {
        folderInputRef.current?.click();
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not open that project folder.");
    }
  };

  const onBrowserFolder = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files?.length) return;
    try {
      const nextProject = await importBrowserProject(files);
      applyProject(nextProject);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not read the folder.");
    } finally {
      event.target.value = "";
    }
  };

  const applyProject = (nextProject: ProjectData) => {
    setProject(nextProject);
    setPreviewIndex(0);
    if (nextProject.template) setTemplate(nextProject.template);
    if (nextProject.layoutJson) {
      try {
        applyLayout(JSON.parse(nextProject.layoutJson) as SavedLayout, nextProject.template);
        setStatus(`Loaded ${nextProject.rows.length} rows and restored saved layout.`);
        return;
      } catch {
        setStatus(`Loaded ${nextProject.rows.length} rows. Saved layout could not be restored.`);
        return;
      }
    }
    setStatus(`Loaded ${nextProject.rows.length} rows from ${nextProject.spreadsheetName}.`);
  };

  const applyLayout = (layout: SavedLayout, fallbackTemplate?: TemplateImage) => {
    setCard(layout.card);
    setTemplate(layout.template ?? fallbackTemplate ?? null);
    setLayers(layout.layers);
    setGlobalFont(layout.globalFont);
    setExportSettings(layout.exportSettings);
  };

  const importTemplate = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setTemplate({ name: file.name, dataUrl: String(reader.result), fit: "cover" });
      setStatus(`Template loaded: ${file.name}`);
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  };

  const importFont = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const family = file.name.replace(/\.(ttf|otf)$/i, "");
    const url = URL.createObjectURL(file);
    const style = document.createElement("style");
    style.textContent = `@font-face{font-family:"${family}";src:url("${url}")}`;
    document.head.appendChild(style);
    setGlobalFont(family);
    setLayers((items) =>
      items.map((layer) => (layer.type === "text" ? { ...layer, fontFamily: family } : layer))
    );
    setStatus(`Local font loaded: ${family}`);
    event.target.value = "";
  };

  const addPhotoLayer = () => {
    const layer: PhotoLayer = {
      id: uid(),
      type: "photo",
      field: usableColumns[0] ?? "",
      x: cardPx.width * 0.08,
      y: cardPx.height * 0.16,
      width: cardPx.width * 0.26,
      height: cardPx.height * 0.46,
      fit: "cover",
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      radius: 0
    };
    setLayers((items) => [...items, layer]);
    setSelectedId(layer.id);
  };

  const addTextLayer = (field: string, x = cardPx.width * 0.44, y = cardPx.height * 0.24) => {
    const layer: TextLayer = {
      id: uid(),
      type: "text",
      field,
      x,
      y,
      width: cardPx.width * 0.46,
      height: 30,
      fontFamily: globalFont,
      fontSize: 18,
      color: "#161616",
      align: "left",
      bold: true,
      italic: false
    };
    setLayers((items) => [...items, layer]);
    setSelectedId(layer.id);
  };

  const updateLayer = (id: string, patch: Partial<Layer>) => {
    setLayers((items) =>
      items.map((layer) => (layer.id === id ? ({ ...layer, ...patch } as Layer) : layer))
    );
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    setLayers((items) => items.filter((layer) => layer.id !== selectedId));
    setSelectedId(null);
  };

  const pointerToCard = (event: PointerEvent<HTMLDivElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * cardPx.width,
      y: ((event.clientY - rect.top) / rect.height) * cardPx.height
    };
  };

  const onLayerPointerDown = (event: PointerEvent<HTMLDivElement>, layer: Layer) => {
    event.stopPropagation();
    const point = pointerToCard(event);
    setSelectedId(layer.id);
    setDragState({
      mode: "move",
      id: layer.id,
      startX: point.x,
      startY: point.y,
      layerX: layer.x,
      layerY: layer.y
    });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onResizePointerDown = (event: PointerEvent<HTMLButtonElement>, layer: Layer) => {
    event.stopPropagation();
    const point = pointerToCard(event as unknown as PointerEvent<HTMLDivElement>);
    setSelectedId(layer.id);
    setDragState({
      mode: "resize",
      id: layer.id,
      startX: point.x,
      startY: point.y,
      width: layer.width,
      height: layer.height
    });
  };

  const onCanvasPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragState) return;
    const point = pointerToCard(event);
    if (dragState.mode === "move") {
      const x = Math.max(0, Math.min(cardPx.width - 8, dragState.layerX + point.x - dragState.startX));
      const y = Math.max(
        0,
        Math.min(cardPx.height - 8, dragState.layerY + point.y - dragState.startY)
      );
      updateLayer(dragState.id, { x, y } as Partial<Layer>);
    } else {
      updateLayer(dragState.id, {
        width: Math.max(12, dragState.width + point.x - dragState.startX),
        height: Math.max(12, dragState.height + point.y - dragState.startY)
      } as Partial<Layer>);
    }
  };

  const onDropColumn = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const field = event.dataTransfer.getData("field");
    if (!field) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    addTextLayer(
      field,
      ((event.clientX - rect.left) / rect.width) * cardPx.width,
      ((event.clientY - rect.top) / rect.height) * cardPx.height
    );
  };

  const changePreset = (presetId: string) => {
    const preset = CARD_PRESETS.find((item) => item.id === presetId)!;
    setCard({ preset: preset.id, width: preset.width, height: preset.height, unit: preset.unit });
  };

  const updateGlobalFont = (font: string) => {
    setGlobalFont(font);
    setLayers((items) =>
      items.map((layer) => (layer.type === "text" ? { ...layer, fontFamily: font } : layer))
    );
  };

  const saveLayout = async () => {
    const layout = buildLayout(card, template, layers, globalFont, exportSettings);
    const content = JSON.stringify(layout, null, 2);
    if (isTauri() && project?.rootPath) {
      await saveTextToPath(joinLocalPath(project.rootPath, "id-maker-layout.json"), content);
      setStatus("Layout saved into the selected project folder.");
      return;
    }
    await saveFile(content, "id-maker-layout.json", "application/json");
    setStatus("Layout downloaded as id-maker-layout.json.");
  };

  const exportCurrentPdf = async () => {
    if (!project?.rows.length) {
      setStatus("Open a project folder with spreadsheet rows before exporting.");
      return;
    }
    const missing = collectMissingPhotos(project, layers);
    if (missing.length) {
      setStatus(`Missing photos: ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "..." : ""}`);
      return;
    }
    try {
      setExportProgress("Preparing PDF...");
      const bytes = await exportPdf(
        project,
        project.rows,
        card,
        template,
        layers,
        exportSettings,
        (done, total) => setExportProgress(`Rendering ${done}/${total}`)
      );
      await saveFile(bytes, `${project.rootName || "id-cards"}.pdf`, "application/pdf");
      setExportProgress("");
      setStatus("PDF export complete.");
    } catch (error) {
      setExportProgress("");
      setStatus(error instanceof Error ? error.message : "PDF export failed.");
    }
  };

  const refreshPreview = async () => {
    try {
      const png = await renderCardPng(currentRow, card, template, layers, project, 2);
      setPreviewPng(png);
      setStatus("Preview image rendered from the same engine used for PDF export.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Preview render failed.");
    }
  };

  const paperPreset = PAPER_PRESETS[exportSettings.paperPreset] ?? PAPER_PRESETS.A4;
  const selectedPhotoUrl =
    selectedLayer?.type === "photo" ? resolveProjectImage(project, currentRow[selectedLayer.field]) : "";

  return (
    <main className="app-shell">
      <input
        ref={folderInputRef}
        type="file"
        className="hidden-input"
        multiple
        // @ts-expect-error webkitdirectory is still not in React's standard input typings.
        webkitdirectory=""
        onChange={onBrowserFolder}
      />
      <input
        ref={templateInputRef}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden-input"
        onChange={importTemplate}
      />
      <input
        ref={fontInputRef}
        type="file"
        accept=".ttf,.otf"
        className="hidden-input"
        onChange={importFont}
      />

      <header className="topbar">
        <div>
          <p className="eyebrow">Offline desktop workflow</p>
          <h1>ID Maker</h1>
        </div>
        <div className="topbar-actions">
          <button className="primary" onClick={openProject}>
            <FolderOpen size={17} /> Open project folder
          </button>
          <button onClick={() => templateInputRef.current?.click()}>
            <FileImage size={17} /> Template
          </button>
          <button onClick={saveLayout}>
            <Save size={17} /> Save layout
          </button>
          <button className="print" onClick={exportCurrentPdf}>
            <Download size={17} /> Export PDF
          </button>
        </div>
      </header>

      <section className="workspace">
        <aside className="panel left-panel">
          <section className="panel-section">
            <div className="section-title">
              <LayoutTemplate size={16} />
              Card setup
            </div>
            <label>
              Preset
              <select value={card.preset} onChange={(event) => changePreset(event.target.value)}>
                {CARD_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="two">
              <label>
                Width
                <input
                  type="number"
                  value={card.width}
                  min="0.1"
                  step="0.01"
                  onChange={(event) =>
                    setCard({ ...card, preset: "custom", width: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                Height
                <input
                  type="number"
                  value={card.height}
                  min="0.1"
                  step="0.01"
                  onChange={(event) =>
                    setCard({ ...card, preset: "custom", height: Number(event.target.value) })
                  }
                />
              </label>
            </div>
            <label>
              Unit
              <select
                value={card.unit}
                onChange={(event) => setCard({ ...card, preset: "custom", unit: event.target.value as Unit })}
              >
                <option value="in">inches</option>
                <option value="mm">millimeters</option>
                <option value="px">pixels</option>
              </select>
            </label>
            <label>
              Template fit
              <select
                value={template?.fit ?? "cover"}
                onChange={(event) =>
                  template && setTemplate({ ...template, fit: event.target.value as TemplateImage["fit"] })
                }
              >
                <option value="cover">cover / crop</option>
                <option value="contain">contain</option>
                <option value="stretch">stretch</option>
                <option value="center">center</option>
              </select>
            </label>
          </section>

          <section className="panel-section">
            <div className="section-title">
              <Grid3X3 size={16} />
              Spreadsheet fields
            </div>
            <p className="small-copy">
              Drag any column onto the card. Photo columns are selected only inside a photo layer.
            </p>
            <div className="field-list">
              {usableColumns.length ? (
                usableColumns.map((column) => (
                  <button
                    className="field-pill"
                    draggable
                    key={column}
                    onDragStart={(event) => event.dataTransfer.setData("field", column)}
                    onDoubleClick={() => addTextLayer(column)}
                  >
                    <Type size={14} /> {column}
                  </button>
                ))
              ) : (
                <p className="empty-state">Open a folder containing a spreadsheet.</p>
              )}
            </div>
            <button className="wide" onClick={addPhotoLayer}>
              <ImagePlus size={16} /> Add photo box
            </button>
          </section>
        </aside>

        <section className="stage">
          <div className="stage-toolbar">
            <div>
              <strong>{project?.rootName ?? "No project loaded"}</strong>
              <span>{project ? `${project.rows.length} rows - ${project.spreadsheetName}` : status}</span>
            </div>
            <label className="row-picker">
              Preview row
              <input
                type="number"
                min="0"
                max={Math.max(0, (project?.rows.length ?? 1) - 1)}
                value={previewIndex}
                onChange={(event) => setPreviewIndex(Number(event.target.value))}
              />
            </label>
          </div>

          <div className="canvas-wrap">
            <div
              ref={canvasRef}
              className="card-canvas"
              style={{ aspectRatio: `${cardPx.width} / ${cardPx.height}` }}
              onPointerMove={onCanvasPointerMove}
              onPointerUp={() => setDragState(null)}
              onPointerCancel={() => setDragState(null)}
              onDrop={onDropColumn}
              onDragOver={(event) => event.preventDefault()}
              onPointerDown={() => setSelectedId(null)}
            >
              {template ? (
                <img className={`template-image fit-${template.fit}`} src={template.dataUrl} alt="" />
              ) : (
                <div className="template-placeholder">
                  <Upload size={28} />
                  <span>Import a PNG/JPG template</span>
                </div>
              )}

              {layers.map((layer) => (
                <div
                  key={layer.id}
                  className={`canvas-layer ${layer.type} ${selectedId === layer.id ? "selected" : ""}`}
                  style={layerStyle(layer, cardPx)}
                  onPointerDown={(event) => onLayerPointerDown(event, layer)}
                >
                  {layer.type === "text" ? (
                    <span style={textLayerStyle(layer)}>{currentRow[layer.field] || layer.field}</span>
                  ) : (
                    <PhotoPreview layer={layer} src={resolveProjectImage(project, currentRow[layer.field])} />
                  )}
                  <button
                    className="resize-handle"
                    aria-label="Resize layer"
                    onPointerDown={(event) => onResizePointerDown(event, layer)}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="status-bar">
            <span>{exportProgress || status}</span>
            <button onClick={refreshPreview}>Render proof</button>
          </div>
          {previewPng && (
            <div className="proof-strip">
              <img src={previewPng} alt="Rendered card proof" />
              <span>Proof uses the export renderer.</span>
            </div>
          )}
        </section>

        <aside className="panel right-panel">
          <section className="panel-section">
            <div className="section-title">
              <Move size={16} />
              Inspector
            </div>
            {selectedLayer ? (
              <Inspector
                layer={selectedLayer}
                columns={usableColumns}
                onChange={(patch) => updateLayer(selectedLayer.id, patch)}
                onDelete={deleteSelected}
                selectedPhotoUrl={selectedPhotoUrl}
              />
            ) : (
              <p className="empty-state">Select a text or photo layer to edit position, font, and crop.</p>
            )}
          </section>

          <section className="panel-section">
            <div className="section-title">
              <Type size={16} />
              Fonts
            </div>
            <label>
              Global dynamic font
              <input value={globalFont} onChange={(event) => updateGlobalFont(event.target.value)} />
            </label>
            <button className="wide" onClick={() => fontInputRef.current?.click()}>
              <Upload size={16} /> Load local .ttf/.otf
            </button>
            <label>
              Google Fonts CSS link
              <input
                value={googleFontUrl}
                placeholder="https://fonts.googleapis.com/css2?..."
                onChange={(event) => setGoogleFontUrl(event.target.value)}
              />
            </label>
            <button
              className="wide"
              onClick={() => {
                injectGoogleFont(googleFontUrl);
                setStatus("Google Font stylesheet added for preview/export rendering.");
              }}
            >
              Apply Google Font link
            </button>
          </section>

          <section className="panel-section export-panel">
            <div className="section-title">
              <Download size={16} />
              PDF export
            </div>
            <label>
              Paper
              <select
                value={exportSettings.paperPreset}
                onChange={(event) => {
                  const preset = event.target.value as ExportSettings["paperPreset"];
                  const paper = PAPER_PRESETS[preset];
                  setExportSettings({
                    ...exportSettings,
                    paperPreset: preset,
                    paperWidth: paper.width,
                    paperHeight: paper.height,
                    unit: paper.unit
                  });
                }}
              >
                <option value="A4">A4</option>
                <option value="Letter">Letter</option>
                <option value="Legal">Legal</option>
                <option value="Custom">Custom</option>
              </select>
            </label>
            <div className="two">
              <label>
                Paper W
                <input
                  type="number"
                  value={exportSettings.paperWidth}
                  disabled={exportSettings.paperPreset !== "Custom"}
                  onChange={(event) =>
                    setExportSettings({ ...exportSettings, paperWidth: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                Paper H
                <input
                  type="number"
                  value={exportSettings.paperHeight}
                  disabled={exportSettings.paperPreset !== "Custom"}
                  onChange={(event) =>
                    setExportSettings({ ...exportSettings, paperHeight: Number(event.target.value) })
                  }
                />
              </label>
            </div>
            <div className="two">
              <label>
                Margin
                <input
                  type="number"
                  value={exportSettings.marginX}
                  onChange={(event) =>
                    setExportSettings({
                      ...exportSettings,
                      marginX: Number(event.target.value),
                      marginY: Number(event.target.value)
                    })
                  }
                />
              </label>
              <label>
                Gap
                <input
                  type="number"
                  value={exportSettings.gapX}
                  onChange={(event) =>
                    setExportSettings({
                      ...exportSettings,
                      gapX: Number(event.target.value),
                      gapY: Number(event.target.value)
                    })
                  }
                />
              </label>
            </div>
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={exportSettings.autoGrid}
                onChange={(event) =>
                  setExportSettings({ ...exportSettings, autoGrid: event.target.checked })
                }
              />
              Auto grid ({gridEstimate.columns} x {gridEstimate.rows})
            </label>
            <div className="two">
              <label>
                Columns
                <input
                  type="number"
                  min="1"
                  value={exportSettings.autoGrid ? gridEstimate.columns : exportSettings.columns}
                  disabled={exportSettings.autoGrid}
                  onChange={(event) =>
                    setExportSettings({ ...exportSettings, columns: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                Rows
                <input
                  type="number"
                  min="1"
                  value={exportSettings.autoGrid ? gridEstimate.rows : exportSettings.rows}
                  disabled={exportSettings.autoGrid}
                  onChange={(event) =>
                    setExportSettings({ ...exportSettings, rows: Number(event.target.value) })
                  }
                />
              </label>
            </div>
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={exportSettings.cropMarks}
                onChange={(event) =>
                  setExportSettings({ ...exportSettings, cropMarks: event.target.checked })
                }
              />
              Crop marks
            </label>
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={exportSettings.rotateCards}
                onChange={(event) =>
                  setExportSettings({ ...exportSettings, rotateCards: event.target.checked })
                }
              />
              Rotate cards 90 degrees
            </label>
          </section>
        </aside>
      </section>
    </main>
  );
}

function PhotoPreview({ layer, src }: { layer: PhotoLayer; src?: string }) {
  if (!src) return <span className="photo-empty">Photo: {layer.field || "choose column"}</span>;
  return (
    <img
      src={src}
      alt=""
      style={{
        width: "100%",
        height: "100%",
        objectFit: layer.fit === "stretch" ? "fill" : layer.fit,
        transform: `scale(${layer.zoom}) translate(${layer.offsetX / 8}px, ${layer.offsetY / 8}px)`,
        borderRadius: layer.radius
      }}
    />
  );
}

function Inspector({
  layer,
  columns,
  onChange,
  onDelete,
  selectedPhotoUrl
}: {
  layer: Layer;
  columns: string[];
  onChange: (patch: Partial<Layer>) => void;
  onDelete: () => void;
  selectedPhotoUrl?: string;
}) {
  return (
    <div className="inspector">
      <label>
        Bound column
        <select value={layer.field} onChange={(event) => onChange({ field: event.target.value } as Partial<Layer>)}>
          {columns.map((column) => (
            <option key={column} value={column}>
              {column}
            </option>
          ))}
        </select>
      </label>
      <div className="two">
        <label>
          X
          <input
            type="number"
            value={Math.round(layer.x)}
            onChange={(event) => onChange({ x: Number(event.target.value) } as Partial<Layer>)}
          />
        </label>
        <label>
          Y
          <input
            type="number"
            value={Math.round(layer.y)}
            onChange={(event) => onChange({ y: Number(event.target.value) } as Partial<Layer>)}
          />
        </label>
      </div>
      <div className="two">
        <label>
          Width
          <input
            type="number"
            value={Math.round(layer.width)}
            onChange={(event) => onChange({ width: Number(event.target.value) } as Partial<Layer>)}
          />
        </label>
        <label>
          Height
          <input
            type="number"
            value={Math.round(layer.height)}
            onChange={(event) => onChange({ height: Number(event.target.value) } as Partial<Layer>)}
          />
        </label>
      </div>

      {layer.type === "text" ? (
        <TextInspector layer={layer} onChange={onChange} />
      ) : (
        <PhotoInspector layer={layer} onChange={onChange} selectedPhotoUrl={selectedPhotoUrl} />
      )}

      <button className="danger wide" onClick={onDelete}>
        Delete layer
      </button>
    </div>
  );
}

function TextInspector({
  layer,
  onChange
}: {
  layer: TextLayer;
  onChange: (patch: Partial<Layer>) => void;
}) {
  return (
    <>
      <label>
        Font family
        <input value={layer.fontFamily} onChange={(event) => onChange({ fontFamily: event.target.value })} />
      </label>
      <div className="two">
        <label>
          Size
          <input
            type="number"
            min="4"
            value={layer.fontSize}
            onChange={(event) => onChange({ fontSize: Number(event.target.value) })}
          />
        </label>
        <label>
          Color
          <input type="color" value={layer.color} onChange={(event) => onChange({ color: event.target.value })} />
        </label>
      </div>
      <div className="segmented">
        <button
          className={layer.align === "left" ? "active" : ""}
          onClick={() => onChange({ align: "left" })}
          title="Align left"
        >
          <AlignLeft size={15} />
        </button>
        <button
          className={layer.align === "center" ? "active" : ""}
          onClick={() => onChange({ align: "center" })}
          title="Align center"
        >
          <AlignCenter size={15} />
        </button>
        <button
          className={layer.align === "right" ? "active" : ""}
          onClick={() => onChange({ align: "right" })}
          title="Align right"
        >
          <AlignRight size={15} />
        </button>
        <button
          className={layer.bold ? "active" : ""}
          onClick={() => onChange({ bold: !layer.bold })}
          title="Bold"
        >
          <Bold size={15} />
        </button>
        <button
          className={layer.italic ? "active" : ""}
          onClick={() => onChange({ italic: !layer.italic })}
          title="Italic"
        >
          <Italic size={15} />
        </button>
      </div>
    </>
  );
}

function PhotoInspector({
  layer,
  onChange,
  selectedPhotoUrl
}: {
  layer: PhotoLayer;
  onChange: (patch: Partial<Layer>) => void;
  selectedPhotoUrl?: string;
}) {
  return (
    <>
      <label>
        Photo fit
        <select value={layer.fit} onChange={(event) => onChange({ fit: event.target.value as PhotoLayer["fit"] })}>
          <option value="cover">cover / crop</option>
          <option value="contain">contain</option>
          <option value="stretch">stretch</option>
        </select>
      </label>
      <label>
        Zoom
        <input
          type="range"
          min="1"
          max="3"
          step="0.01"
          value={layer.zoom}
          onChange={(event) => onChange({ zoom: Number(event.target.value) })}
        />
      </label>
      <div className="two">
        <label>
          Crop X
          <input
            type="number"
            value={layer.offsetX}
            onChange={(event) => onChange({ offsetX: Number(event.target.value) })}
          />
        </label>
        <label>
          Crop Y
          <input
            type="number"
            value={layer.offsetY}
            onChange={(event) => onChange({ offsetY: Number(event.target.value) })}
          />
        </label>
      </div>
      <label>
        Corner radius
        <input
          type="number"
          value={layer.radius}
          onChange={(event) => onChange({ radius: Number(event.target.value) })}
        />
      </label>
      <div className="photo-check">{selectedPhotoUrl ? "Photo resolved for preview row." : "No photo found for this row."}</div>
    </>
  );
}

const layerStyle = (layer: Layer, cardPx: { width: number; height: number }) => ({
  left: `${(layer.x / cardPx.width) * 100}%`,
  top: `${(layer.y / cardPx.height) * 100}%`,
  width: `${(layer.width / cardPx.width) * 100}%`,
  height: `${(layer.height / cardPx.height) * 100}%`,
  borderRadius: layer.type === "photo" ? layer.radius : 0
});

const textLayerStyle = (layer: TextLayer) => ({
  fontFamily: `"${layer.fontFamily}", sans-serif`,
  fontSize: `${layer.fontSize}px`,
  color: layer.color,
  fontWeight: layer.bold ? 700 : 400,
  fontStyle: layer.italic ? "italic" : "normal",
  textAlign: layer.align
});

const collectMissingPhotos = (project: ProjectData, layers: Layer[]) => {
  const photoLayers = layers.filter((layer): layer is PhotoLayer => layer.type === "photo");
  const missing: string[] = [];
  for (const [index, row] of project.rows.entries()) {
    for (const layer of photoLayers) {
      const value = row[layer.field];
      if (!value || !resolveProjectImage(project, value)) {
        missing.push(`row ${index} (${layer.field}: ${normalizePath(value || "empty")})`);
      }
    }
  }
  return missing;
};
