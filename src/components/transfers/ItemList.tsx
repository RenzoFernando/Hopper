import { useEffect, useMemo, useRef } from "react";
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
  onDisableDownloadDirectory: () => Promise<void>;
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
  const activeItems = useMemo(
    () => props.items.filter(
      (item) => item.expiresAt === null || Date.parse(item.expiresAt || "") > props.now
    ),
    [props.items, props.now]
  );
  const selectedSet = new Set(props.selectedItemIds);
  const selectedItems = activeItems.filter((item) => selectedSet.has(item.id));
  const allSelected = activeItems.length > 0 && selectedItems.length === activeItems.length;
  const knownIds = useRef<Set<string> | null>(null);
  const arriving = knownIds.current === null ? new Set<string>() : new Set(activeItems.filter((item) => !knownIds.current?.has(item.id)).map((item) => item.id));
  useEffect(() => {
    knownIds.current = new Set(activeItems.map((item) => item.id));
  }, [activeItems]);

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
        <div className="recent-heading-line"><h2 id="recent-title">Bandeja</h2><span className="item-count" id="item-count">{activeItems.length}</span></div>
        {props.showSync ? <div className="recent-tools"><span className={`sync-state ${props.syncVariant ? `is-${props.syncVariant}` : ""}`.trim()} id="sync-state" aria-live="polite">{props.syncLabel || "Sincronizado"}</span><button className={`icon-button refresh-button ${props.refreshing ? "is-spinning" : ""}`.trim()} id="refresh-button" type="button" aria-label="Actualizar" title="Actualizar" disabled={props.refreshing} onClick={() => { void props.onRefresh(); }}><RefreshIcon /></button></div> : <button className={`icon-button refresh-button ${props.refreshing ? "is-spinning" : ""}`.trim()} id="refresh-button" type="button" aria-label="Actualizar" title="Actualizar" disabled={props.refreshing} onClick={() => { void props.onRefresh(); }}><RefreshIcon /></button>}
      </div>
      <div className="bulk-toolbar" aria-label="Acciones de la bandeja">
        <label className="bulk-select-all"><input type="checkbox" checked={allSelected} disabled={activeItems.length === 0} onChange={(event) => props.onSelectionChange(event.target.checked ? activeItems.map((item) => item.id) : [])} /><span>{allSelected ? "Deseleccionar" : "Seleccionar todo"}</span></label>
        <div className="bulk-actions">
          {props.downloadDirectorySupported && <>
            <button type="button" className={`bulk-button ${props.downloadDirectoryName ? "is-active" : ""}`.trim()} title={props.downloadDirectoryName ? `Carpeta activa: ${props.downloadDirectoryName}` : "Seleccionar carpeta para descargas temporales"} disabled={props.batchBusy} onClick={() => { void props.onChooseDownloadDirectory(); }}><FolderIcon /><span>{props.downloadDirectoryName || "Elegir carpeta"}</span></button>
            {props.downloadDirectoryName && <button type="button" className="bulk-button" title="Dejar de usar la carpeta y volver a las descargas normales" disabled={props.batchBusy} onClick={() => invoke(props.onDisableDownloadDirectory)}><span>Usar Descargas</span></button>}
          </>}
          {activeItems.length > 0 && <button type="button" className="bulk-button" disabled={props.batchBusy} onClick={() => invoke(() => props.onDownloadMany(activeItems))}><DownloadIcon /><span>{activeItems.length === 1 ? "Descargar elemento" : "Descargar todos"}</span></button>}
          {selectedItems.length > 0 && <button type="button" className="bulk-button" disabled={props.batchBusy} onClick={() => invoke(() => props.onDownloadMany(selectedItems))}><DownloadIcon /><span>Descargar selección ({selectedItems.length})</span></button>}
          {selectedItems.length > 0 && <button type="button" className="bulk-button is-danger" disabled={props.batchBusy} onClick={() => props.onDeleteManyRequest(selectedItems)}><DeleteIcon /><span>Eliminar selección</span></button>}
        </div>
      </div>
      <div className="items-frame">
        <div className="loading-state" id="loading-state" hidden={!props.loading}><span className="spinner" aria-hidden="true" /><span>Cargando contenido temporal…</span></div>
        <div className="empty-state" id="empty-state" hidden={props.loading || activeItems.length > 0}><div className="empty-mark" aria-hidden="true"><EmptyIcon /></div><h3>{props.emptyTitle}</h3><p>{props.emptyCopy}</p></div>
        <div className="item-list" id="item-list" aria-live="polite" hidden={props.loading || activeItems.length === 0}>
          {activeItems.map((item) => <ItemCard key={item.id} arriving={arriving.has(item.id)} item={item} now={props.now} api={props.api} allowTtlReset={props.allowTtlReset} ttlOptions={props.ttlOptions} selected={selectedSet.has(item.id)} onSelectionChange={toggleItem} onCopy={props.onCopy} onCopyFile={props.onCopyFile} onDownload={props.onDownload} onPreview={props.onPreview} onShare={props.onShare} onDeleteRequest={props.onDeleteRequest} onResetTtl={props.onResetTtl} onActivity={props.onActivity} onError={props.onError} />)}
        </div>
      </div>
    </section>
  );
}
