import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { exclusiveApi, multipartUpload } from "../api/exclusive";
import { sessionStore } from "../api/client";
import { authApi } from "../api/auth";
import { AppHeader } from "../components/layout/AppHeader";
import { AppFooter } from "../components/layout/AppFooter";
import { formatBytes } from "../lib/format";

type Uploaded = {id:string;name:string;size:number;status:string;created_at:string};
type Status = {active:boolean;status:string;expiresAt:string|null;limitBytes:number;files:Uploaded[]};
const durations=[{value:60,label:"1 hora"},{value:360,label:"6 horas"},{value:720,label:"12 horas"},{value:1440,label:"24 horas"}];

export function SuperPage() {
  const navigate=useNavigate();
  const [data,setData]=useState<Status|null>(null);
  const [serviceReady,setServiceReady]=useState(false);
  const [authenticated,setAuthenticated]=useState(()=>sessionStore.hasPersonal());
  const [pin,setPin]=useState("");
  const [duration,setDuration]=useState(60);
  const [confirmed,setConfirmed]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [progress,setProgress]=useState<number|null>(null);
  const [file,setFile]=useState<File|null>(null);
  const reload=useCallback(async()=>{
    try {
      const result=await exclusiveApi.status();
      setData(result);
      setServiceReady(true);
      setMessage((current) => current.startsWith("La API de carga exclusiva") ? "" : current);
    } catch(error) {
      setServiceReady(false);
      setData(null);
      const status=error && typeof error==="object" && "status" in error ? (error as {status:number}).status : 0;
      if(status===401){sessionStore.clearPersonal();setAuthenticated(false);}
      setMessage(status===404
        ? "La API de carga exclusiva no está desplegada. Primero aplica la migración D1 0003 y actualiza el Worker."
        : status===500
          ? "La API de carga exclusiva todavía no está preparada. Comprueba la migración D1 y el Worker."
          : error instanceof Error ? error.message : "No se pudo comprobar la sesión.");
    }
  },[]);
  useEffect(()=>{void reload();const timer=window.setInterval(()=>void reload(),15_000);return()=>window.clearInterval(timer);},[reload]);
  const login=async()=>{
    if(busy)return;setBusy(true);setMessage("");
    try{const result=await authApi.login(pin);if(!result.ok)throw new Error(result.status==="locked"?"PIN bloqueado.":"PIN incorrecto.");setAuthenticated(true);setPin("");await reload();}
    catch(error){setMessage(error instanceof Error?error.message:"No fue posible iniciar sesión.");}
    finally{setBusy(false);}
  };
  const act=async(kind:"start"|"retry"|"end")=>{
    if(busy)return;
    setBusy(true);setMessage("");
    try {
      if(!serviceReady || !data)throw new Error("No es posible activar este modo sin verificar primero la API y la base de datos.");
      if(kind==="start" && !confirmed)throw new Error("Confirma que se borrarán todos los elementos y se cerrarán todas las salas.");
      if(!/^\d{4}$/.test(pin))throw new Error("Escribe tu PIN de cuatro dígitos.");
      if(kind==="end"){
        if(!window.confirm("Se eliminarán todos los archivos de carga exclusiva. ¿Finalizar?"))return;
        const result=await exclusiveApi.end(pin) as {active?:boolean;failed?:number};
        if(result.active)throw new Error("B2 no confirmó la limpieza; Hopper permanece bloqueado.");
        sessionStore.clearPersonal();sessionStore.clearRoom();navigate("/",{replace:true});return;
      }
      const result=kind==="start"?await exclusiveApi.start(pin,duration):await exclusiveApi.retry(pin);
      sessionStore.setPersonal(result.token,result.expiresIn);sessionStore.clearRoom();
      setPin("");setConfirmed(false);await reload();
      setMessage("Modo exclusivo activo. Las sesiones anteriores quedaron invalidadas.");
    }catch(error){setMessage(error instanceof Error?error.message:"No fue posible completar la operación.");await reload();}
    finally{setBusy(false);}
  };
  const send=async()=>{
    if(!file||busy)return;
    setBusy(true);setMessage("");setProgress(0);
    try{await multipartUpload(file,(uploaded)=>setProgress(Math.min(100,Math.floor(uploaded/file.size*100))));setFile(null);setMessage("Archivo publicado.");await reload();}
    catch(error){setMessage(error instanceof Error?error.message:"La carga falló. Puedes eliminar el archivo pendiente.");await reload();}
    finally{setBusy(false);setProgress(null);}
  };
  const download=async(id:string)=>{
    const tab=window.open("about:blank","_blank");
    try{const item=await exclusiveApi.download(id);if(tab)tab.location.href=item.url;else window.location.assign(item.url);}
    catch(error){tab?.close();setMessage(error instanceof Error?error.message:"No se pudo descargar.");}
  };
  const remove=async(id:string)=>{
    if(!window.confirm("¿Eliminar este archivo del almacenamiento exclusivo?"))return;
    setBusy(true);try{await exclusiveApi.remove(id);await reload();}catch(error){setMessage(error instanceof Error?error.message:"No se pudo eliminar.");}finally{setBusy(false);}
  };
  const used=(data?.files||[]).reduce((sum,row)=>sum+row.size,0);
  return <><div className="document-shell"><AppHeader variant="admin" onLogout={()=>{sessionStore.clearPersonal();navigate("/");}} />
    <main className="admin-main super-main">
      <div className="admin-heading"><div><p className="eyebrow">ADMINISTRACIÓN</p><h1>Carga exclusiva</h1></div></div>
      {!authenticated && <section className="admin-panel super-panel"><h2>Acceso administrativo</h2><p>Introduce el PIN para gestionar la sesión exclusiva.</p><label>PIN<input type="password" inputMode="numeric" maxLength={4} autoComplete="off" value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,"").slice(0,4))}/></label><button className="primary-button" disabled={busy||pin.length!==4} onClick={()=>void login()}>Entrar</button></section>}
      {authenticated && <section className="admin-panel super-panel">
        <div className="super-heading"><strong>Estado</strong><span>{!serviceReady?"No disponible":data?.status==="active"?"Activa":data?.status==="preparing"?"Limpiando":data?.status==="closing"?"Cerrando":"Inactiva"}</span></div>
        <p className="super-caption">{!serviceReady?"No se ha confirmado la conexión con el servicio exclusivo.":data?.active?`Finaliza: ${data.expiresAt?new Date(data.expiresAt).toLocaleString("es-CO"):"—"}`:"Transferencias normales habilitadas"}</p>
        {authenticated && data?.status==="active"&&<p className="super-caption">{formatBytes(used)} reservados de {formatBytes(data.limitBytes)} nominales</p>}
      </section>}
      {authenticated && serviceReady && data?.status==="inactive" && <section className="admin-panel super-panel"><h2>Iniciar sesión exclusiva</h2><label>Duración<select value={duration} onChange={e=>setDuration(Number(e.target.value))}>{durations.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}</select></label><p>Se cerrarán las salas, se eliminarán definitivamente los elementos actuales y se invalidarán todas las sesiones. La capacidad nominal de esta operación es 10 GiB.</p><label className="super-confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Confirmo el borrado irreversible y el bloqueo temporal.</label><label>PIN actual<input type="password" inputMode="numeric" maxLength={4} value={pin} onChange={e=>setPin(e.target.value)}/></label><button className="danger-outline-button" disabled={busy||!confirmed||!serviceReady||data?.status!=="inactive"} onClick={()=>void act("start")}>Vaciar y activar</button></section>}
      {authenticated && data?.status==="preparing"&&<section className="admin-panel super-panel"><h2>Limpieza pendiente</h2><p>El almacenamiento no confirmó el vaciado. Hopper permanece bloqueado.</p><label>PIN<input type="password" inputMode="numeric" value={pin} onChange={e=>setPin(e.target.value)}/></label><button className="secondary-button" disabled={busy} onClick={()=>void act("retry")}>Reintentar limpieza</button></section>}
      {authenticated && data?.status==="active"&&<section className="admin-panel super-panel"><h2>Transferir archivos</h2><p>Hasta 10 GiB por archivo, con subida directa en fragmentos de 32 MiB.</p><input type="file" aria-label="Seleccionar archivo de carga exclusiva" disabled={busy} onChange={e=>setFile(e.target.files?.[0]||null)}/>{file&&<p>{file.name} · {formatBytes(file.size)}</p>}{progress!==null&&<progress max="100" value={progress}>{progress}%</progress>}<button className="primary-button" disabled={!file||busy} onClick={()=>void send()}>Subir archivo</button></section>}
      {authenticated && data?.active&&<section className="admin-panel super-panel"><h2>Archivos ({data.files.length})</h2><div className="super-files">{data.files.map(f=><div className="super-file" key={f.id}><div><strong>{f.name}</strong><small>{formatBytes(f.size)} · {f.status==="ready"?"Disponible": "Pendiente"}</small></div><div><button className="secondary-button" disabled={busy||f.status!=="ready"} onClick={()=>void download(f.id)}>Descargar</button><button className="danger-outline-button" disabled={busy} onClick={()=>void remove(f.id)}>Eliminar</button></div></div>)}</div></section>}
      {authenticated && data?.active&&<section className="admin-panel super-panel"><h2>Finalizar sesión</h2><p>Esta acción elimina los archivos de esta sesión y reactiva Hopper cuando B2 confirme la limpieza.</p><label>PIN actual<input type="password" inputMode="numeric" value={pin} onChange={e=>setPin(e.target.value)}/></label><button className="danger-outline-button" disabled={busy} onClick={()=>void act("end")}>{data.status==="closing"?"Reintentar liberación":"Finalizar y liberar"}</button></section>}
      {message&&<p className="super-message" role="status">{message}</p>}
    </main></div><AppFooter /></>;
}
