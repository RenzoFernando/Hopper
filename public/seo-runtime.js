(() => {
  const script = document.querySelector("script[data-hopper-seo]");
  const ga4Id = String(script?.dataset.ga4 || "").trim();
  const validGa4 = /^G-[A-Z0-9]+$/i.test(ga4Id);

  if (validGa4) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function gtag() { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", ga4Id, {
      anonymize_ip: true,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      page_location: window.location.href,
      page_title: document.title
    });

    const gaScript = document.createElement("script");
    gaScript.async = true;
    gaScript.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga4Id)}`;
    document.head.append(gaScript);
  }

  const track = (name, parameters = {}) => {
    if (validGa4 && typeof window.gtag === "function") window.gtag("event", name, parameters);
  };

  for (const link of document.querySelectorAll("[data-cta]")) {
    link.addEventListener("click", () => track("cta_open_hopper", { page_path: window.location.pathname }));
  }

  for (const button of document.querySelectorAll("[data-share]")) {
    button.addEventListener("click", async () => {
      const title = document.title;
      const url = window.location.href;
      try {
        if (typeof navigator.share === "function") {
          await navigator.share({ title, url });
          track("share", { method: "web_share", content_type: "seo_page", item_id: window.location.pathname });
          return;
        }
        await navigator.clipboard.writeText(url);
        const original = button.textContent;
        button.textContent = "Enlace copiado";
        window.setTimeout(() => { button.textContent = original; }, 1800);
        track("share", { method: "clipboard", content_type: "seo_page", item_id: window.location.pathname });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        button.textContent = "No se pudo compartir";
        window.setTimeout(() => { button.textContent = "Compartir esta página"; }, 1800);
      }
    });
  }
})();
