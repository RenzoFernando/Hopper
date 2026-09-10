import { useLayoutEffect, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { recoveryTokenFromHash, roomCodeFromLegacyHash, roomPath } from "../lib/navigation";
import { isCompleteRoomCode } from "../lib/room-code";
import { AdminPage } from "../pages/AdminPage";
import { HomePage } from "../pages/HomePage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { RecoverPage } from "../pages/RecoverPage";
import { RoomPage } from "../pages/RoomPage";
import { ShareTargetPage } from "../pages/ShareTargetPage";
import { SpacePage } from "../pages/SpacePage";

type PageFrameProps = {
  bodyClass: string;
  title: string;
  description: string;
  children: ReactNode;
};

function PageFrame({ bodyClass, title, description, children }: PageFrameProps) {
  useLayoutEffect(() => {
    document.body.className = bodyClass;
    document.title = title;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (meta) meta.content = description;
  }, [bodyClass, description, title]);

  return children;
}

function LegacyRoomRoute() {
  const location = useLocation();
  const code = roomCodeFromLegacyHash(location.hash);
  return <Navigate replace to={isCompleteRoomCode(code) ? roomPath(code) : "/room"} />;
}

function LegacyRecoverRoute() {
  const location = useLocation();
  const token = recoveryTokenFromHash(location.hash);
  return <Navigate replace to={token ? `/recover#${encodeURIComponent(token)}` : "/recover"} />;
}

function LegacyShareRoute() {
  const location = useLocation();
  return <Navigate replace to={`/share${location.search}`} />;
}

export function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<PageFrame bodyClass="app-page" title="Hopper" description="Hopper permite transferir temporalmente texto y archivos entre dispositivos mediante un PIN o una sala."><HomePage /></PageFrame>} />
      <Route path="/space" element={<PageFrame bodyClass="app-page" title="Mi espacio — Hopper" description="Espacio privado de transferencia temporal de Hopper."><SpacePage /></PageFrame>} />
      <Route path="/room/:code" element={<PageFrame bodyClass="app-page" title="Sala — Hopper" description="Sala temporal de transferencia de Hopper."><RoomPage /></PageFrame>} />
      <Route path="/room" element={<PageFrame bodyClass="app-page" title="Sala — Hopper" description="Sala temporal de transferencia de Hopper."><RoomPage /></PageFrame>} />
      <Route path="/admin" element={<PageFrame bodyClass="document-page" title="Administración — Hopper" description="Administración, uso y salud de Hopper."><AdminPage /></PageFrame>} />
      <Route path="/recover" element={<PageFrame bodyClass="document-page compact-document-page" title="Recuperar acceso — Hopper" description="Recuperación segura del PIN de Hopper."><RecoverPage /></PageFrame>} />
      <Route path="/share" element={<PageFrame bodyClass="document-page compact-document-page" title="Compartir — Hopper" description="Enviar contenido compartido a Hopper."><ShareTargetPage /></PageFrame>} />
      <Route path="/404" element={<PageFrame bodyClass="document-page compact-document-page" title="404 — Hopper" description="La ruta solicitada no existe en Hopper."><NotFoundPage /></PageFrame>} />

      <Route path="/index.html" element={<Navigate replace to="/" />} />
      <Route path="/admin.html" element={<Navigate replace to="/admin" />} />
      <Route path="/room.html" element={<LegacyRoomRoute />} />
      <Route path="/recover.html" element={<LegacyRecoverRoute />} />
      <Route path="/share-target.html" element={<LegacyShareRoute />} />
      <Route path="*" element={<PageFrame bodyClass="document-page compact-document-page" title="404 — Hopper" description="La ruta solicitada no existe en Hopper."><NotFoundPage /></PageFrame>} />
    </Routes>
  );
}
