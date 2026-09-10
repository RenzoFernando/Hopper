import { useCallback, useEffect, useRef, useState } from "react";
import type { TransferWorkspaceOptions } from "../../features/transfers/types";
import { useTransferWorkspace } from "../../features/transfers/useTransferWorkspace";
import { useNow } from "../../hooks/useNow";
import { useToasts, type ToastController } from "../../hooks/useToasts";
import { ToastRegion } from "../ui/ToastRegion";
import { Composer } from "./Composer";
import { ItemList } from "./ItemList";

type SyncVariant = "" | "busy" | "offline" | "ok";
type Props = TransferWorkspaceOptions & { roomMode?: boolean; showRoomSync?: boolean; toastController?: ToastController };

export function TransferWorkspace(props: Props) {
  const localToasts = useToasts();
  const { toasts, showToast } = props.toastController ?? localToasts;
  const [sync, setSync] = useState<{ label: string; variant: SyncVariant }>({ label: "Sincronizado", variant: "" });
  const internalSync = useCallback((label: string, variant: SyncVariant) => setSync({ label, variant }), []);
  const syncCallback = props.onSyncChange ?? internalSync;
  const workspace = useTransferWorkspace({ ...props, onSyncChange: syncCallback }, showToast);
  const { addFiles } = workspace;
  const now = useNow();
  const previewRef = useRef<HTMLDialogElement>(null);
  const deleteRef = useRef<HTMLDialogElement>(null);
  const [refreshing, setRefreshing] = useState(false);

  const addPastedFiles = useCallback((files: File[]) => {
    addFiles(files);
    showToast(files.length === 1 ? "Archivo pegado." : `${files.length} archivos pegados.`, "success");
  }, [addFiles, showToast]);

  useEffect(() => {
    if (workspace.preview && !previewRef.current?.open) previewRef.current?.showModal();
    if (!workspace.preview && previewRef.current?.open) previewRef.current.close();
  }, [workspace.preview]);

  useEffect(() => {
    if (workspace.deleteTarget && !deleteRef.current?.open) deleteRef.current?.showModal();
    if (!workspace.deleteTarget && deleteRef.current?.open) deleteRef.current.close();
  }, [workspace.deleteTarget]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLTextAreaElement && target.id === "text-input") return;
      const files = Array.from(event.clipboardData?.files || []);
      if (files.length > 0) addPastedFiles(files);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [addPastedFiles]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await workspace.refresh();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "No fue posible actualizar Hopper.", "error");
    } finally {
      setRefreshing(false);
    }
  };

  const closePreview = () => workspace.setPreview(null);
  const confirmDelete = async () => {
    const item = workspace.deleteTarget;
    workspace.setDeleteTarget(null);
    if (item) await workspace.deleteItem(item);
  };

  return <>
    <div className="workspace-inner">
      <Composer text={workspace.text} ttlMinutes={workspace.ttlMinutes} ttlOptions={workspace.ttlOptions} maxFileBytes={workspace.maxFileBytes} selectedFiles={workspace.selectedFiles} sending={workspace.sending} dragging={workspace.dragging} roomMode={Boolean(props.roomMode)} onTextChange={workspace.setText} onTtlChange={workspace.setTtlMinutes} onAddFiles={workspace.addFiles} onPasteFiles={addPastedFiles} onSend={() => { void workspace.send(); }} onRemove={workspace.removeFile} onCancel={workspace.cancelFile} onRetry={(key) => { void workspace.retryFile(key); }} onDragging={workspace.setDragging} />
      <ItemList items={workspace.items} now={now} loading={workspace.loading} refreshing={refreshing} syncLabel={sync.label} syncVariant={sync.variant} showSync={Boolean(props.showRoomSync)} emptyTitle={props.emptyTitle || (props.roomMode ? "La sala está vacía" : "La bandeja está vacía")} emptyCopy={props.emptyCopy || (props.roomMode ? "Envía texto o archivos y aparecerán aquí." : "Envía texto o archivos y aparecerán aquí en los demás dispositivos.")} api={workspace.api} allowTtlReset={workspace.allowTtlReset} ttlOptions={workspace.ttlOptions} onRefresh={refresh} onCopy={workspace.copyItem} onDownload={workspace.downloadItem} onPreview={workspace.previewItem} onShare={workspace.shareItem} onDeleteRequest={workspace.setDeleteTarget} onResetTtl={workspace.resetTtl} onActivity={workspace.onActivity} onError={(message) => showToast(message, "error")} />
    </div>
    <dialog className="preview-dialog" id="preview-dialog" ref={previewRef} onClick={(event) => { if (event.target === event.currentTarget) closePreview(); }}><div className="dialog-header"><div><p className="eyebrow">VISTA PREVIA</p><h2 id="preview-title">{workspace.preview?.item.name || "Imagen"}</h2></div><button className="icon-button" id="preview-close" type="button" aria-label="Cerrar vista previa" onClick={closePreview}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg></button></div><div className="preview-body"><img id="preview-image" src={workspace.preview?.url || undefined} alt={workspace.preview ? `Vista previa de ${workspace.preview.item.name || "imagen"}` : ""} /></div></dialog>
    <dialog className="confirm-dialog" id="delete-dialog" ref={deleteRef} onClose={() => workspace.setDeleteTarget(null)}><form method="dialog" onSubmit={(event) => { const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null; if (submitter?.value === "confirm") { event.preventDefault(); void confirmDelete(); } }}><p className="eyebrow">ELIMINAR AHORA</p><h2>¿Eliminar este elemento?</h2><p id="delete-copy">{workspace.deleteTarget?.type === "file" ? `“${workspace.deleteTarget.name}” se eliminará inmediatamente y dejará de estar disponible en todos los dispositivos.` : "El texto se eliminará inmediatamente y dejará de estar disponible en todos los dispositivos."}</p><div className="dialog-actions"><button className="secondary-button" value="cancel">Cancelar</button><button className="danger-button" id="delete-confirm" value="confirm">Eliminar</button></div></form></dialog>
    <ToastRegion toasts={toasts} />
  </>;
}
