import { useLayoutEffect } from "react";
import { AppFooter } from "../components/layout/AppFooter";
import { AppHeader } from "../components/layout/AppHeader";

export function NotFoundPage() {
  useLayoutEffect(() => {
    let meta = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const existed = Boolean(meta);
    const previous = meta?.content || "";

    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "robots";
      document.head.append(meta);
    }
    meta.content = "noindex";

    return () => {
      if (!meta) return;
      if (existed) meta.content = previous;
      else meta.remove();
    };
  }, []);

  return <>
    <div className="document-shell not-found-shell">
      <AppHeader variant="simple" />
      <main className="not-found-main">
        <section className="not-found-card" aria-labelledby="not-found-title">
          <div className="not-found-mark" aria-hidden="true">
            <span>4</span>
            <img src="/assets/favicon.svg" alt="" />
            <span>4</span>
          </div>
          <p className="eyebrow">RUTA NO ENCONTRADA</p>
          <h1 id="not-found-title">Esto no está en Hopper.</h1>
          <p className="not-found-copy">La dirección puede estar incompleta, haber cambiado o ya no existir.</p>
          <div className="not-found-actions">
            <a className="primary-button" href="/">Volver a Hopper</a>
            <a className="secondary-link" href="/room">Abrir una sala</a>
          </div>
        </section>
      </main>
    </div>
    <AppFooter />
  </>;
}
