import type { ClipboardEvent, DragEvent, KeyboardEvent } from "react";
import { useRef } from "react";
import { formatBytes, ttlLabel } from "../../lib/format";
import type { SelectedFileEntry } from "../../features/transfers/types";
import { TransferQueue } from "./TransferQueue";
import { UploadIcon } from "./icons";

type Props = {
  text: string;
  ttlMinutes: number;
  ttlOptions: number[];
  maxFileBytes: number;
  selectedFiles: SelectedFileEntry[];
  sending: boolean;
  dragging: boolean;
  roomMode?: boolean;
  onTextChange: (value: string) => void;
  onTtlChange: (value: number) => void;
  onAddFiles: (files: FileList | File[]) => void;
  onPasteFiles: (files: File[]) => void;
  onSend: () => void;
  onRemove: (key: string) => void;
  onCancel: (key: string) => void;
  onRetry: (key: string) => void;
  onDragging: (value: boolean) => void;
};

export function Composer(props: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pasteFiles = (event: ClipboardEvent<HTMLElement>) => {
    const files = Array.from(event.clipboardData.files || []);
    if (files.length > 0) props.onPasteFiles(files);
    else {
      const itemFiles = Array.from(event.clipboardData.items || []).filter((item) => item.kind === "file").map((item) => item.getAsFile()).filter((file): file is File => Boolean(file));
      if (itemFiles.length > 0) props.onPasteFiles(itemFiles);
    }
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    props.onDragging(false);
    if (!props.sending && event.dataTransfer.files.length > 0) props.onAddFiles(event.dataTransfer.files);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      props.onSend();
    }
  };

  return (
    <section className={`composer-card ${props.sending ? "is-sending" : ""}`.trim()} aria-labelledby="workspace-title">
      <div className="composer-heading"><h1 id="workspace-title">Enviar</h1></div>
      <label className="sr-only" htmlFor="text-input">Texto o código</label>
      <textarea id="text-input" rows={3} maxLength={250000} placeholder="Pega tu texto aquí…" value={props.text} disabled={props.sending} onChange={(event) => props.onTextChange(event.target.value)} onKeyDown={onKeyDown} onPaste={pasteFiles} />
      <div className={`drop-zone ${props.dragging ? "is-dragging" : ""} ${props.sending ? "is-disabled" : ""}`.trim()} id="drop-zone" tabIndex={0} role="button" aria-label="Adjuntar archivos" aria-disabled={props.sending} onClick={() => { if (!props.sending) inputRef.current?.click(); }} onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ") && !props.sending) { event.preventDefault(); inputRef.current?.click(); } }} onDragEnter={(event) => { event.preventDefault(); props.onDragging(true); }} onDragOver={(event) => { event.preventDefault(); props.onDragging(true); }} onDragLeave={(event) => { event.preventDefault(); props.onDragging(false); }} onDrop={onDrop}>
        <input ref={inputRef} id="file-input" type="file" multiple hidden disabled={props.sending} onChange={(event) => { if (event.target.files) props.onAddFiles(event.target.files); event.target.value = ""; }} />
        <div className="drop-copy"><UploadIcon /><span><strong>Adjunta archivos</strong> o arrástralos aquí</span></div>
        <span className="drop-limit" id="drop-limit">Hasta {formatBytes(props.maxFileBytes)} por archivo</span>
      </div>
      <TransferQueue entries={props.selectedFiles} onRemove={props.onRemove} onCancel={props.onCancel} onRetry={props.onRetry} />
      <div className={`composer-actions ${props.roomMode ? "room-composer-actions" : ""}`.trim()}>
        {!props.roomMode && <label className="ttl-field" htmlFor="ttl-select"><span>Expira en</span><select id="ttl-select" name="ttl" value={props.ttlMinutes} disabled={props.sending} onChange={(event) => props.onTtlChange(Number(event.target.value))}>{props.ttlOptions.map((minutes) => <option value={minutes} key={minutes}>{ttlLabel(minutes)}</option>)}</select></label>}
        <button className="primary-button send-button" id="send-button" type="button" disabled={props.sending} onClick={props.onSend}>{props.sending ? "Enviando…" : "Enviar"}</button>
      </div>
    </section>
  );
}
