import type { TransferApi } from "../../features/transfers/types";
import type { HopperItem } from "../../schemas/item";
import { ItemCard } from "./ItemCard";
import { EmptyIcon, RefreshIcon } from "./icons";

type Props = {
  items: HopperItem[];
  now: number;
  loading: boolean;
  refreshing: boolean;
  syncLabel?: string;
  syncVariant?: string;
  showSync?: boolean;
  emptyTitle: string;
  emptyCopy: string;
  api: TransferApi;
  allowTtlReset: boolean;
  ttlOptions: number[];
  onRefresh: () => Promise<void>;
  onCopy: (item: HopperItem) => Promise<void>;
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
  return (
    <section className="recent-section" aria-labelledby="recent-title">
      <div className="recent-header">
        <div className="recent-heading-line"><h2 id="recent-title">Recientes</h2><span className="item-count" id="item-count">{activeItems.length}</span></div>
        {props.showSync ? <div className="recent-tools"><span className={`sync-state ${props.syncVariant ? `is-${props.syncVariant}` : ""}`.trim()} id="sync-state" aria-live="polite">{props.syncLabel || "Sincronizado"}</span><button className={`icon-button refresh-button ${props.refreshing ? "is-spinning" : ""}`.trim()} id="refresh-button" type="button" aria-label="Actualizar" title="Actualizar" disabled={props.refreshing} onClick={() => { void props.onRefresh(); }}><RefreshIcon /></button></div> : <button className={`icon-button refresh-button ${props.refreshing ? "is-spinning" : ""}`.trim()} id="refresh-button" type="button" aria-label="Actualizar" title="Actualizar" disabled={props.refreshing} onClick={() => { void props.onRefresh(); }}><RefreshIcon /></button>}
      </div>
      <div className="items-frame">
        <div className="loading-state" id="loading-state" hidden={!props.loading}><span className="spinner" aria-hidden="true" /><span>Cargando contenido temporal…</span></div>
        <div className="empty-state" id="empty-state" hidden={props.loading || activeItems.length > 0}><div className="empty-mark" aria-hidden="true"><EmptyIcon /></div><h3>{props.emptyTitle}</h3><p>{props.emptyCopy}</p></div>
        <div className="item-list" id="item-list" aria-live="polite" hidden={props.loading || activeItems.length === 0}>
          {activeItems.map((item) => <ItemCard key={item.id} item={item} now={props.now} api={props.api} allowTtlReset={props.allowTtlReset} ttlOptions={props.ttlOptions} onCopy={props.onCopy} onDownload={props.onDownload} onPreview={props.onPreview} onShare={props.onShare} onDeleteRequest={props.onDeleteRequest} onResetTtl={props.onResetTtl} onActivity={props.onActivity} onError={props.onError} />)}
        </div>
      </div>
    </section>
  );
}
