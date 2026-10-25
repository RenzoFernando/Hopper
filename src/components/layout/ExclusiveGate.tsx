import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { appConfig } from "../../lib/config";

type Mode = {active:boolean;status:string;expiresAt:string|null};
export function ExclusiveGate() {
  const {pathname}=useLocation();
  const [state,setState]=useState<Mode|null>(null);
  useEffect(()=>{
    if(!appConfig.workerBaseUrl)return;
    let alive=true;
    const refresh=async()=>{
      try{const r=await fetch(`${appConfig.workerBaseUrl.replace(/\/$/,"")}/api/exclusive/status`,{cache:"no-store"});if(!r.ok)return;const body=await r.json() as Mode;if(alive)setState(body);}catch{/* La conectividad no debe activar un bloqueo falso. */}
    };
    void refresh();const timer=window.setInterval(()=>void refresh(),10_000);
    return()=>{alive=false;window.clearInterval(timer);};
  },[]);
  if(!state?.active || pathname.startsWith("/admin"))return null;
  return <div className="exclusive-lock-screen" role="alert" aria-live="polite"><div className="exclusive-lock-message"><strong>Hopper temporalmente deshabilitado</strong><p>Administración está utilizando el almacenamiento exclusivo.</p>{state.expiresAt&&<small>Hasta {new Date(state.expiresAt).toLocaleString("es-CO")}</small>}<Link className="secondary-button exclusive-admin-link" to="/admin/super">Acceso administrativo</Link></div></div>;
}
