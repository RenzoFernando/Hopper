import type { TransferApi } from "../../features/transfers/types";
import type { HopperItem } from "../../schemas/item";
import { ItemCard } from "./ItemCard";
import { DeleteIcon, DownloadIcon, EmptyIcon, FolderIcon, RefreshIcon } from "./icons";

type Props = {
  items: HopperItem[];
  now: number;
  loading: boolean;
  refreshing: boolean;
  batchBusy: boolean;
  syncLabel?: string;
  syncVariant?: string;
  showSync?: boolean;
  emptyTitle: string;
  emptyCopy: string;
  api: TransferApi;
  allowTtlReset: boolean;
  ttlOptions: number[];
  selectedItemIds: string[];
  downloadDirectorySupported: boolean;
  downloadDirectoryName: string;
  onSelectionChange: (ids: string[]) => void;
  onChooseDownloadDirectory: () => Promise<void>;
  onDownloadMany: (items: HopperItem[]) => Promise<void>;
  onDeleteManyRequest: (items: HopperItem[]) => void;
  onRefresh: () => Promise<void>;
  onCopy: (item: HopperItem) => Promise<void>;
  onCopyFile: (item: HopperItem) => Promise<void>;
  onDownload: (item: HopperItem) => Promise<void>;
  onPreview: (item: HopperItem) => Promise<void>;
  onShare: (item: HopperItem) => Promise<void>;
  onDeleteRequest: (item: HopperItem) => void;
  onResetTtl: (item: HopperItem, minutes: number) => Promise<void>;
  onActivity: () => void;
  onError: (message: string) => void;
};

export function ItemList(props: Props) {
  const activeItems = props.items.filter((item) => item.expiresAt === null || Date.parse(item.expiresAt || "") > props.now);
  const files = activeItems.filter((item) => item.type === "file");
  const selectedSet = new Set(props.selectedItemIds);
  const selectedFiles = files.filter((item) => selectedSet.has(item.id));
  const allSelected = files.length > 0 && selectedFiles.length === files.length;

  const invoke = (operation: () => Promise<void>) => {
    void operation().catch((error: unknown) => props.onError(error instanceof Error ? error.message : "No fue posible completar la acción."));
  };

  const toggleItem = (item: HopperItem, selected: boolean) => {
    const next = new Set(props.selectedItemIds);
    if (selected) next.add(item.id);
    else next.delete(item.id);
    props.onSelectionChange([...next]);
  };

  return (
    <section className="recent-section" aria-labelledby="recent-title">
      <div className="recent-header">
        <div className="recent-heading-line"><h2 id="recent-title">Recientes</h2><span className="item-count" id="item-count">{activeItems.length}</span></div>
        {props.showSync ? <div className="recent-tools"><span className={`sync-state ${props.syncVariant ? `is-${props.syncVariant}` : ""}`.trim()} id="sync-state" aria-live="polite">{props.syncLabel || "Sincronizado"}</span><button className={`icon-button refresh-button ${props.refreshing ? "is-spinning" : ""}`.trim()} id="refresh-button" type="button" aria-label="Actualizar" title="Actualizar" disabled={props.refreshing} onClick={() => { void props.onRefresh(); }}><RefreshIcon /></button></div> : <button className={`icon-button refresh-button ${props.refreshing ? "is-spinning" : ""}`.trim()} id="refresh-button" type="button" aria-label="Actualizar" title="Actualizar" disabled={props.refreshing} onClick={() => { void props.onRefresh(); }}><RefreshIcon /></button>}
      </div>
      {files.length > 0 && <div className="bulk-toolbar" aria-label="Acciones de archivos">
        <label className="bulk-select-all"><input type="checkbox" checked={allSelected} onChange={(event) => props.onSelectionChange(event.target.checked ? files.map((item) => item.id) : [])} /><span>{allSelected ? "Deseleccionar" : "Seleccionar todo"}</span></label>
        <div className="bulk-actions">
          {props.downloadDirectorySupported && <button type="button" className={`bulk-button ${props.downloadDirectoryName ? "is-active" : ""}`.trim()} title={props.downloadDirectoryName ? `Carpeta activa: ${props.downloadDirectoryName}` : "Elegir carpeta para las descargas de Hopper"} disabled={props.batchBusy} onClick={() => { void props.onChooseDownloadDirectory(); }}><FolderIcon /><span>{props.downloadDirectoryName || "Carpeta Hopper"}</span></button>}
          <button type="button" className="bulk-button" disabled={props.batchBusy} onClick={() => invoke(() => props.onDownloadMany(files))}><DownloadIcon /><span>{files.length === 1 ? "Descargar archivo" : "Descargar todos"}</span></button>
          {selectedFiles.length > 0 && <button type="button" className="bulk-button" disabled={props.batchBusy} onClick={() => invoke(() => props.onDownloadMany(selectedFiles))}><DownloadIcon /><span>Descargar selección ({selectedFiles.length})</span></button>}
          {selectedFiles.length > 0 && <button type="button" className="bulk-button is-danger" disabled={props.batchBusy} onClick={() => props.onDeleteManyRequest(selectedFiles)}><DeleteIcon /><span>Eliminar selección</span></button>}
        </div>
      </div>}
      <div className="items-frame">
        <div className="loading-state" id="loading-state" hidden={!props.loading}><span className="spinner" aria-hidden="true" /><span>Cargando contenido temporal…</span></div>
        <div className="empty-state" id="empty-state" hidden={props.loading || activeItems.length > 0}><div className="empty-mark" aria-hidden="true"><EmptyIcon /></div><h3>{props.emptyTitle}</h3><p>{props.emptyCopy}</p></div>
        <div className="item-list" id="item-list" aria-live="polite" hidden={props.loading || activeItems.length === 0}>
          {activeItems.map((item) => <ItemCard key={item.id} item={item} now={props.now} api={props.api} allowTtlReset={props.allowTtlReset} ttlOptions={props.ttlOptions} selected={selectedSet.has(item.id)} onSelectionChange={toggleItem} onCopy={props.onCopy} onCopyFile={props.onCopyFile} onDownload={props.onDownload} onPreview={props.onPreview} onShare={props.onShare} onDeleteRequest={props.onDeleteRequest} onResetTtl={props.onResetTtl} onActivity={props.onActivity} onError={props.onError} />)}
        </div>
      </div>
    </section>
  );
}
