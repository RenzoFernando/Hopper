import { useEffect, useRef, useState } from "react";
import { copyTextToClipboard } from "../../lib/clipboard";
import { renderQr } from "../../lib/qrcode";

type Props = { code: string; onClose: () => void; onEnter: () => void };

export function RoomCreatedDialog({ code, onClose, onEnter }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copyLabel, setCopyLabel] = useState("Copiar código");

  useEffect(() => {
    if (code) {
      if (!dialogRef.current?.open) dialogRef.current?.showModal();
      if (canvasRef.current) {
        const url = new URL("room.html", window.location.href);
        url.hash = code;
        renderQr(canvasRef.current, url.toString(), 260);
      }
    } else if (dialogRef.current?.open) dialogRef.current.close();
  }, [code]);

  return <dialog className="qr-dialog room-created-dialog" id="room-created-dialog" ref={dialogRef} onClose={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="dialog-header"><div><p className="eyebrow">SALA</p><h2>Código de la sala</h2></div><button className="icon-button" id="room-created-close" type="button" aria-label="Cerrar" onClick={onClose}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg></button></div>
    <canvas ref={canvasRef} id="room-created-qr" width="260" height="260" aria-label="QR de la sala" />
    <strong className="qr-code" id="room-created-code">{code || "—"}</strong>
    <div className="room-created-actions"><button className="secondary-button" id="room-created-copy" type="button" onClick={() => { void copyTextToClipboard(code).then(() => { setCopyLabel("Copiado"); window.setTimeout(() => setCopyLabel("Copiar código"), 1200); }); }}>{copyLabel}</button><button className="primary-button" id="room-created-enter" type="button" onClick={onEnter}>Entrar a la sala</button></div>
  </dialog>;
}
