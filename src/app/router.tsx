import { useLayoutEffect, type ReactNode } from "react";
import { Route, Routes } from "react-router-dom";
import { appConfig } from "../lib/config";
import { AdminPage } from "../pages/AdminPage";
import { HomePage } from "../pages/HomePage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { RecoverPage } from "../pages/RecoverPage";
import { RoomPage } from "../pages/RoomPage";
import { ShareTargetPage } from "../pages/ShareTargetPage";
import { SpacePage } from "../pages/SpacePage";

const PUBLIC_APP_URL = new URL(appConfig.publicAppUrl).origin;
let homeSchemaContents: string | null = null;
const INDEX_ROBOTS = "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1";
const PRIVATE_ROBOTS = "noindex,nofollow";

type PageFrameProps = {
  bodyClass: string;
  title: string;
  description: string;
  indexable?: boolean;
  canonicalPath?: string;
  children: ReactNode;
};

function ensureMeta(name: string) {
  let meta = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = name;
    document.head.append(meta);
  }
  return meta;
}

function ensureCanonical() {
  let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement("link");
    canonical.rel = "canonical";
    document.head.append(canonical);
  }
  return canonical;
}


function ensurePropertyMeta(property: string) {
  let meta = document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("property", property);
    document.head.append(meta);
  }
  return meta;
}

function updateSocialMetadata(title: string, description: string, canonicalPath?: string) {
  ensurePropertyMeta("og:title").content = title;
  ensurePropertyMeta("og:description").content = description;
  ensureMeta("twitter:title").content = title;
  ensureMeta("twitter:description").content = description;

  const openGraphUrl = document.querySelector<HTMLMetaElement>('meta[property="og:url"]');
  if (canonicalPath) {
    ensurePropertyMeta("og:url").content = `${PUBLIC_APP_URL}${canonicalPath}`;
  } else {
    openGraphUrl?.remove();
  }
}

function updateHomeStructuredData(indexable: boolean) {
  const script = document.querySelector<HTMLScriptElement>("script[data-hopper-home-schema]");
  if (!script) return;
  if (homeSchemaContents === null) {
    homeSchemaContents = (script.textContent || "").replaceAll("__HOPPER_SITE_ORIGIN__", PUBLIC_APP_URL);
  }
  script.textContent = indexable ? homeSchemaContents : "";
}

function PageFrame({ bodyClass, title, description, indexable = false, canonicalPath, children }: PageFrameProps) {
  useLayoutEffect(() => {
    document.body.className = bodyClass;
    document.title = title;
    ensureMeta("description").content = description;
    ensureMeta("robots").content = indexable ? INDEX_ROBOTS : PRIVATE_ROBOTS;
    updateSocialMetadata(title, description, indexable ? canonicalPath : undefined);
    updateHomeStructuredData(indexable);

    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (indexable && canonicalPath) {
      ensureCanonical().href = `${PUBLIC_APP_URL}${canonicalPath}`;
    } else {
      canonical?.remove();
    }
  }, [bodyClass, canonicalPath, description, indexable, title]);

  return children;
}

export function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<PageFrame bodyClass="app-page" title="Transferir archivos y texto entre dispositivos | Hopper" description="Transfiere texto y archivos entre dispositivos con Hopper mediante un espacio privado con PIN o salas temporales con código y QR." indexable canonicalPath="/"><HomePage /></PageFrame>} />
      <Route path="/space" element={<PageFrame bodyClass="app-page" title="Mi espacio privado para transferencias | Hopper" description="Espacio privado de Hopper para transferir temporalmente texto y archivos entre tus dispositivos."><SpacePage /></PageFrame>} />
      <Route path="/room/:code" element={<PageFrame bodyClass="app-page" title="Sala temporal para compartir archivos | Hopper" description="Sala temporal de Hopper para compartir texto y archivos mediante un código independiente."><RoomPage /></PageFrame>} />
      <Route path="/room" element={<PageFrame bodyClass="app-page" title="Entrar a una sala temporal | Hopper" description="Introduce un código de sala de Hopper para compartir temporalmente texto y archivos."><RoomPage /></PageFrame>} />
      <Route path="/admin" element={<PageFrame bodyClass="document-page" title="Panel de administración de Hopper" description="Panel privado para consultar uso, salud, límites, salas y mantenimiento de Hopper."><AdminPage /></PageFrame>} />
      <Route path="/recover" element={<PageFrame bodyClass="document-page compact-document-page" title="Recuperar el acceso a Hopper" description="Restablece de forma segura el PIN de acceso a Mi espacio mediante un enlace temporal."><RecoverPage /></PageFrame>} />
      <Route path="/share" element={<PageFrame bodyClass="document-page compact-document-page" title="Enviar contenido compartido a Hopper" description="Selecciona un destino de Hopper para recibir contenido desde Web Share Target."><ShareTargetPage /></PageFrame>} />
      <Route path="/404" element={<PageFrame bodyClass="document-page compact-document-page" title="Página no encontrada | Hopper" description="La ruta solicitada no existe en Hopper."><NotFoundPage /></PageFrame>} />
      <Route path="*" element={<PageFrame bodyClass="document-page compact-document-page" title="Página no encontrada | Hopper" description="La ruta solicitada no existe en Hopper."><NotFoundPage /></PageFrame>} />
    </Routes>
  );
}
