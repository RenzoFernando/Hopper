import { useEffect, useRef, useState, type ReactNode } from "react";
import type { TransferApi } from "../../features/transfers/types";
import { fileTypeInfo } from "../../lib/file-types";
import { formatBytes, formatCountdown, textPreview, ttlLabel } from "../../lib/format";
import { extractHttpUrls, splitHttpText } from "../../lib/links";
import type { HopperItem } from "../../schemas/item";
import { CopyIcon, DeleteIcon, DownloadIcon, ExternalLinkIcon, FileKindIcon, PlayIcon, PreviewIcon, ShareIcon, TextIcon } from "./icons";

type Props = {
  item: HopperItem;
  now: number;
  api: TransferApi;
  allowTtlReset: boolean;
  ttlOptions: number[];
  selected: boolean;
  onSelectionChange: (item: HopperItem, selected: boolean) => void;
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

function ActionButton({ label, className = "is-info", onClick, children }: { label: string; className?: string; onClick: () => void; children: ReactNode }) {
  return <button type="button" className={`action-button ${className}`.trim()} aria-label={label} title={label} onClick={onClick}>{children}</button>;
}

function ActionLink({ label, href, children }: { label: string; href: string; children: ReactNode }) {
  return <a className="action-button is-info" href={href} target="_blank" rel="noopener noreferrer" aria-label={label} title={label}>{children}</a>;
}

export function ItemCard(props: Props) {
  const { item } = props;
  const audioRef = useRef<HTMLAudioElement>(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [audioExpiresAt, setAudioExpiresAt] = useState(0);
  const [audioLoading, setAudioLoading] = useState(false);

  useEffect(() => {
    if (!audioUrl || !audioExpiresAt || audioExpiresAt > props.now) return;
    if (audioRef.current && !audioRef.current.paused) return;
    setAudioUrl("");
    setAudioExpiresAt(0);
  }, [audioExpiresAt, audioUrl, props.now]);

  const invoke = (operation: () => Promise<void>) => {
    void operation().catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      props.onError(error instanceof Error ? error.message : "No fue posible completar la acción.");
    });
  };

  const loadAudio = async () => {
    setAudioLoading(true);
    try {
      const result = await props.api.getFileUrl(item.id, "stream");
      setAudioUrl(result.url);
      setAudioExpiresAt(Date.now() + Math.max(1, Number(result.expiresIn) || 300) * 1000);
      props.onActivity();
      window.setTimeout(() => { void audioRef.current?.play().catch(() => undefined); }, 0);
    } catch (error) {
      props.onError(error instanceof Error ? error.message : "No fue posible cargar el audio.");
    } finally {
      setAudioLoading(false);
    }
  };

  const createdDate = new Date(item.createdAt);
  const textContent = item.type === "text" ? String(item.content || "") : "";
  const textLinks = item.type === "text" ? extractHttpUrls(textContent) : [];
  const textLinkSet = new Set(textLinks);
  const previewText = item.type === "text" ? textPreview(textContent) : "";
  const previewParts = item.type === "text" ? splitHttpText(previewText) : [];
  const fileInfo = item.type === "file" ? fileTypeInfo(item.name || "", item.mimeType || "") : null;
  const detail = item.type === "text" ? `${textContent.length.toLocaleString("es-CO")} caracteres` : formatBytes(item.size || 0);
  const created = Number.isNaN(createdDate.getTime()) ? "Temporal" : createdDate.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
  const canPreview = item.type === "file" && Boolean(fileInfo?.previewKind);

  return (
    <article className={`item-card ${props.selected ? "is-selected" : ""}`.trim()} data-item-id={item.id} data-expires-at={item.expiresAt || undefined}>
      <div className="item-main">
        {item.type === "file" && <label className="item-select" title={`Seleccionar ${item.name || "archivo"}`}><input type="checkbox" checked={props.selected} aria-label={`Seleccionar ${item.name || "archivo"}`} onChange={(event) => props.onSelectionChange(item, event.target.checked)} /><span aria-hidden="true" /></label>}
        <div className={`item-type-mark ${item.type === "text" ? "is-text" : item.audio ? "is-audio" : "is-file"}`}>
          {item.type === "text" ? <TextIcon /> : <FileKindIcon kind={fileInfo?.kind || "file"} />}
        </div>
        <div className="item-copy">
          <h3 className="item-title">{item.type === "text" ? "Texto" : item.name}</h3>
          <p className="item-preview">{item.type === "text" ? previewParts.map((part, index) => part.href && textLinkSet.has(part.href) ? <a className="item-preview-link" href={part.href} target="_blank" rel="noopener noreferrer" key={`${part.href}-${index}`}>{part.text}</a> : <span key={`text-${index}`}>{part.text}</span>) : `${fileInfo?.label || "Archivo"} · ${item.mimeType || "application/octet-stream"}`}</p>
          <div className="item-meta"><span>{detail}</span><span>{created}</span></div>
          {item.audio && <div className="audio-row">
            <button type="button" className="audio-load-button" data-action="load-audio" data-item-id={item.id} hidden={Boolean(audioUrl)} disabled={audioLoading} onClick={() => { void loadAudio(); }}><PlayIcon /><span>Reproducir audio</span></button>
            <audio ref={audioRef} controls preload="none" hidden={!audioUrl} src={audioUrl || undefined} data-audio-item-id={item.id} data-url-expires-at={audioExpiresAt || undefined} aria-label={`Reproductor de ${item.name || "audio"}`} onError={() => { setAudioUrl(""); setAudioExpiresAt(0); }} />
          </div>}
        </div>
      </div>
      <div className="item-actions">
        <div className="expiry-controls">
          <span className="expiry-countdown" data-expires-at={item.expiresAt || undefined} aria-label="Tiempo restante">{formatCountdown(item.expiresAt, props.now)}</span>
          {props.allowTtlReset && <select className="expiry-select" data-item-id={item.id} aria-label="Reiniciar tiempo de expiración" defaultValue="" onChange={(event) => { const minutes = Number(event.target.value); event.target.value = ""; if (Number.isFinite(minutes) && minutes >= 0) void props.onResetTtl(item, minutes); }}>
            <option value="">Tiempo</option>
            {props.ttlOptions.map((minutes) => <option value={minutes} key={minutes}>{ttlLabel(minutes)}</option>)}
          </select>}
        </div>
        {item.type === "text" ? <>{textLinks[0] && <ActionLink label="Abrir enlace" href={textLinks[0]}><ExternalLinkIcon /></ActionLink>}<ActionButton label="Copiar" onClick={() => invoke(() => props.onCopy(item))}><CopyIcon /></ActionButton></> : <>
          {canPreview && <ActionButton label="Ver" onClick={() => invoke(() => props.onPreview(item))}><PreviewIcon /></ActionButton>}
          {(fileInfo?.copyable || fileInfo?.previewKind === "image") && <ActionButton label={fileInfo.previewKind === "image" ? "Copiar imagen" : "Copiar contenido"} onClick={() => invoke(() => props.onCopyFile(item))}><CopyIcon /></ActionButton>}
          <ActionButton label="Descargar" onClick={() => invoke(() => props.onDownload(item))}><DownloadIcon /></ActionButton>
        </>}
        {typeof navigator.share === "function" && <ActionButton label="Compartir" onClick={() => invoke(() => props.onShare(item))}><ShareIcon /></ActionButton>}
        <ActionButton label="Eliminar" className="is-danger" onClick={() => props.onDeleteRequest(item)}><DeleteIcon /></ActionButton>
      </div>
    </article>
  );
}