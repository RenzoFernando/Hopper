import { formatBytes } from "../../lib/format";
import type { SelectedFileEntry } from "../../features/transfers/types";
import { CloseIcon, RefreshIcon } from "./icons";

function statusValue(entry: SelectedFileEntry) {
  const progress = Math.max(0, Math.min(100, Number(entry.progress) || 0));
  if (entry.status === "error") return { label: "Error · Reintentar", variant: "error" };
  if (entry.status === "preparando") return { label: "Preparando", variant: "info" };
  if (entry.status === "queued" || !entry.status) return { label: "Listo para enviar", variant: "" };
  if (entry.status === "subiendo") return { label: `${Math.max(1, Math.min(99, progress))}% · Subiendo`, variant: "info" };
  if (entry.status === "confirmando") return { label: "100% · Confirmando", variant: "info" };
  if (entry.status === "listo") return { label: "100% · Listo", variant: "success" };
  return { label: "Listo para enviar", variant: "" };
}

export function TransferQueue({ entries, onRemove, onCancel, onRetry }: { entries: SelectedFileEntry[]; onRemove: (key: string) => void; onCancel: (key: string) => void; onRetry: (key: string) => void }) {
  return (
    <div className="selected-files" id="selected-files" hidden={entries.length === 0} aria-label="Archivos seleccionados">
      {entries.map((entry) => {
        const status = statusValue(entry);
        const active = ["subiendo", "confirmando", "preparando"].includes(entry.status);
        const error = entry.status === "error";
        return (
          <div className="selected-file" data-file-key={entry.key} key={entry.key}>
            <div className="selected-file-copy">
              <span className="selected-file-name">{entry.file.name}</span>
              <span className="selected-file-size">{formatBytes(entry.file.size)}</span>
              <span className={`selected-file-status selected-file-progress-label ${status.variant ? `is-${status.variant}` : ""}`.trim()}>{status.label}</span>
            </div>
            {active ? (
              <button className="remove-file-button is-cancel" type="button" data-action="cancel-selected-file" data-file-key={entry.key} aria-label={`Cancelar ${entry.file.name}`} title="Cancelar" onClick={() => onCancel(entry.key)}><CloseIcon /></button>
            ) : error ? (
              <button className="selected-file-retry-button" type="button" data-action="retry-selected-file" data-file-key={entry.key} aria-label={`Reintentar ${entry.file.name}`} title="Reintentar" onClick={() => onRetry(entry.key)}><RefreshIcon /></button>
            ) : (
              <button className="remove-file-button" type="button" data-action="remove-selected-file" data-file-key={entry.key} aria-label={`Quitar ${entry.file.name}`} title="Quitar" onClick={() => onRemove(entry.key)}><CloseIcon /></button>
            )}
            <div className="file-progress" hidden={!active}><span style={{ width: `${Math.max(0, Math.min(100, entry.progress))}%` }} /></div>
          </div>
        );
      })}
    </div>
  );
}
