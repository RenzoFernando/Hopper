import { useState, type RefObject } from "react";
import { formatBytes } from "../../lib/format";
import { formatCapacity } from "../../features/supercharge/model";

function UploadIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 16V3m0 0L7 8m5-5 5 5M4 15v3.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

type Props = {
  inputRef: RefObject<HTMLInputElement | null>;
  disabled: boolean;
  file: File | null;
  available: number;
  progress: number | null;
  onPick: (file: File | null) => void;
  onClear: () => void;
  onSend: () => void;
};

export function SuperFilePicker({ inputRef, disabled, file, available, progress, onPick, onClear, onSend }: Props) {
  const [dragging, setDragging] = useState(false);
  const openPicker = () => { if (!disabled) inputRef.current?.click(); };
  return <section className="admin-panel super-panel">
    <h2>Transferir archivos</h2>
    <input ref={inputRef} className="super-file-input" id="super-upload" type="file" aria-label="Seleccionar archivo" disabled={disabled} onChange={event => onPick(event.target.files?.[0] ?? null)} />
    <div className={`super-dropzone ${dragging ? "is-dragging" : ""}`} role="button" aria-disabled={disabled} tabIndex={disabled ? -1 : 0} aria-label="Adjuntar archivo" onClick={openPicker}
      onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openPicker(); } }}
      onDragOver={event => { event.preventDefault(); if (!disabled) setDragging(true); }}
      onDragLeave={event => { event.preventDefault(); setDragging(false); }}
      onDrop={event => { event.preventDefault(); setDragging(false); if (!disabled) onPick(event.dataTransfer.files[0] ?? null); }}>
      <UploadIcon /><span><strong>Adjunta un archivo</strong> o arrástralo aquí</span><small>Hasta {formatCapacity(available)} disponibles</small>
    </div>
    {file && <div className="super-selected"><span>{file.name} · {formatBytes(file.size)}</span><button type="button" className="super-file-clear" disabled={disabled} aria-label="Quitar archivo" onClick={onClear}>×</button></div>}
    {progress !== null && <div className="super-upload-progress"><progress max="100" value={progress} aria-label="Progreso de subida">{progress}%</progress><small>{progress}%</small></div>}
    <div className="super-upload-actions"><button type="button" className="primary-button" disabled={!file || disabled} onClick={onSend}>Subir archivo</button></div>
  </section>;
}
