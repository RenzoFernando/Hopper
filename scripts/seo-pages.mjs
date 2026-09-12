const SITE_URL = "https://hopper-transfer.pages.dev";
const APP_NAME = "Hopper";
const REPOSITORY_URL = "https://github.com/RenzoFernando/Hopper";
const AUTHOR = {
  name: "Renzo Fernando Mosquera Daza",
  url: "https://github.com/RenzoFernando",
  sameAs: [
    "https://www.linkedin.com/in/renzofernando/",
    "https://www.instagram.com/_renzofernando/"
  ]
};

export const SEO_PAGES = [
  {
    path: "/transferir-archivos",
    intent: "transferir archivos entre dispositivos",
    title: "Transferir archivos entre dispositivos | Hopper",
    description: "Transfiere archivos entre celular, computador y otros dispositivos con Hopper, usando un espacio privado o salas temporales con código.",
    eyebrow: "TRANSFERENCIA DE ARCHIVOS",
    h1: "Mueve archivos entre tus dispositivos sin cables",
    intro: "Hopper permite pasar archivos entre dispositivos desde el navegador. Puedes usar tu espacio privado con PIN o crear una sala temporal para compartir mediante un código o QR, sin convertir el proceso en una configuración larga.",
    takeaways: [
      "Hasta 512 MB por archivo en Mi espacio.",
      "Hasta 256 MB por archivo y 512 MB totales dentro de una sala.",
      "Expiración configurable en Mi espacio y salas temporales que se cierran solas."
    ],
    steps: [
      ["Abre Hopper", "Entra desde los dispositivos entre los que quieres mover el archivo."],
      ["Comparte el acceso", "Usa el mismo PIN para Mi espacio o crea una sala y comparte su código o QR."],
      ["Envía y descarga", "Selecciona el archivo, espera la confirmación y descárgalo desde el otro dispositivo."]
    ],
    table: {
      headers: ["Modo", "Acceso", "Límite por archivo", "Retención"],
      rows: [
        ["Mi espacio", "PIN de 4 dígitos", "512 MB", "5 min, 15 min, 30 min, 1 h, 6 h, 1 día o indefinido"],
        ["Sala temporal", "Código o QR", "256 MB", "Hasta 10 min y cierre tras 5 min sin actividad"]
      ]
    },
    faq: [
      ["¿Necesito instalar una aplicación?", "No. Hopper funciona desde el navegador y también puede instalarse como PWA si prefieres usarlo como una aplicación."],
      ["¿Cuál es el tamaño máximo de un archivo?", "Mi espacio admite hasta 512 MB por archivo. Las salas temporales admiten hasta 256 MB por archivo y 512 MB en total por sala."],
      ["¿Los archivos quedan guardados para siempre?", "No por defecto. En Mi espacio eliges la expiración y puedes usar el modo indefinido. Las salas son temporales y se cierran automáticamente."],
      ["¿Puedo usar Hopper entre celular y computador?", "Sí. El flujo está pensado para mover contenido entre navegadores de distintos dispositivos, incluido móvil y escritorio."]
    ]
  },
  {
    path: "/compartir-texto",
    intent: "compartir texto entre dispositivos",
    title: "Compartir texto entre dispositivos rápido | Hopper",
    description: "Comparte texto, código y enlaces entre dispositivos con Hopper mediante un PIN privado o una sala temporal, con expiración automática.",
    eyebrow: "TEXTO ENTRE DISPOSITIVOS",
    h1: "Copia texto de un dispositivo a otro",
    intro: "Hopper sirve como una bandeja temporal para pegar texto, código o enlaces en un dispositivo y recuperarlos desde otro. El contenido puede vivir solo unos minutos o conservarse indefinidamente dentro de Mi espacio.",
    takeaways: [
      "Admite textos amplios de hasta 250.000 caracteres por elemento.",
      "Los enlaces HTTP y HTTPS se reconocen para abrirlos con menos pasos.",
      "Puedes compartir dentro de Mi espacio o mediante una sala temporal."
    ],
    steps: [
      ["Pega el contenido", "Escribe o pega texto, código o una dirección web en el compositor."],
      ["Define la expiración", "En Mi espacio elige cuánto tiempo debe permanecer disponible el elemento."],
      ["Recupéralo", "Abre Hopper en el otro dispositivo y copia el texto cuando aparezca sincronizado."]
    ],
    table: {
      headers: ["Necesidad", "Mi espacio", "Sala temporal"],
      rows: [
        ["Texto entre dispositivos propios", "Recomendado", "Disponible"],
        ["Compartir con otra persona", "Requiere compartir el PIN", "Código temporal independiente"],
        ["Retención configurable", "Sí", "No, la sala controla su vida útil"],
        ["Límite de texto", "250.000 caracteres", "250.000 caracteres"]
      ]
    },
    faq: [
      ["¿Puedo compartir código fuente como texto?", "Sí. Hopper trata el contenido como texto y permite copiarlo desde el otro dispositivo."],
      ["¿Qué ocurre con los enlaces?", "Los enlaces HTTP y HTTPS incluidos en un elemento de texto se muestran como enlaces utilizables en la interfaz."],
      ["¿Puedo dejar una nota sin expiración?", "Sí, dentro de Mi espacio puedes seleccionar Indefinido. En una sala el contenido sigue la vida temporal de la sala."],
      ["¿Necesito crear una cuenta?", "Hopper no usa un sistema de cuentas. Mi espacio se protege con PIN y las salas utilizan códigos temporales."]
    ]
  },
  {
    path: "/salas-temporales",
    intent: "crear salas temporales para compartir archivos",
    title: "Salas temporales para compartir archivos | Hopper",
    description: "Crea salas temporales en Hopper para compartir texto y archivos con código o QR, con cierre automático por inactividad y límites definidos.",
    eyebrow: "SALAS TEMPORALES",
    h1: "Comparte archivos y texto con un código temporal",
    intro: "Las salas de Hopper separan una transferencia puntual de tu espacio privado. Creas una sala, compartes su código o QR y los participantes pueden intercambiar contenido mientras la sala siga activa.",
    takeaways: [
      "Hasta 3 salas activas simultáneamente.",
      "Cada sala tiene una vida máxima de 10 minutos.",
      "La sala se cierra tras 5 minutos reales sin actividad."
    ],
    steps: [
      ["Crea una sala", "Hopper genera un código independiente y muestra un QR para abrirla desde otro dispositivo."],
      ["Comparte el acceso", "Envía el código, el QR o el enlace de la sala a la persona o dispositivo que lo necesite."],
      ["Usa el espacio temporal", "Transfiere texto y archivos hasta que se cierre la sala o decidas salir de ella."]
    ],
    table: {
      headers: ["Límite", "Valor"],
      rows: [
        ["Salas simultáneas", "3"],
        ["Vida máxima", "10 minutos"],
        ["Inactividad antes del cierre", "5 minutos"],
        ["Tamaño máximo por archivo", "256 MB"],
        ["Capacidad total por sala", "512 MB"],
        ["Elementos por sala", "25"]
      ]
    },
    faq: [
      ["¿Cuántas salas puedo tener abiertas?", "Hopper admite hasta tres salas activas al mismo tiempo."],
      ["¿Cuánto dura una sala?", "La vida máxima es de 10 minutos. Si no hay actividad durante 5 minutos, la sala puede cerrarse antes."],
      ["¿El código de una sala reemplaza el PIN?", "No. El código identifica y autoriza esa sala temporal; Mi espacio continúa protegido por su PIN independiente."],
      ["¿Qué pasa al cerrar una sala?", "Los tokens de esa sala dejan de ser válidos y su contenido temporal entra en el flujo de limpieza correspondiente."]
    ]
  },
  {
    path: "/seguridad",
    intent: "conocer la seguridad de una transferencia temporal",
    title: "Seguridad y privacidad de transferencias | Hopper",
    description: "Conoce cómo Hopper protege sesiones, salas, archivos y enlaces temporales mediante HTTPS, almacenamiento privado, tokens firmados y controles de acceso.",
    eyebrow: "SEGURIDAD",
    h1: "Cómo protege Hopper tus transferencias temporales",
    intro: "Hopper reduce la exposición del contenido con sesiones y salas de alcance limitado, almacenamiento privado y URLs firmadas de corta duración. El objetivo es proteger el flujo sin presentar como cifrado de extremo a extremo algo que la aplicación no implementa.",
    takeaways: [
      "Las conexiones de producción usan HTTPS para proteger el tráfico en tránsito.",
      "Backblaze B2 se utiliza como bucket privado y los accesos a archivos se firman temporalmente.",
      "Hopper no afirma tener cifrado de extremo a extremo: el Worker participa en el procesamiento del contenido."
    ],
    steps: [
      ["Acceso limitado", "Mi espacio utiliza una sesión firmada tras validar el PIN; las salas usan tokens independientes."],
      ["Almacenamiento privado", "Los archivos no dependen de un bucket público y se acceden mediante URLs firmadas temporales."],
      ["Expiración y limpieza", "Los elementos y salas tienen reglas de retención para limitar cuánto tiempo permanece disponible el contenido."]
    ],
    table: {
      headers: ["Control", "Qué protege", "Alcance"],
      rows: [
        ["HTTPS", "Tráfico entre navegador, Worker y servicios", "Cifrado en tránsito"],
        ["PIN y sesión firmada", "Mi espacio", "Autenticación y vigencia de sesión"],
        ["Token de sala", "Sala temporal", "Acceso separado por sala"],
        ["URLs firmadas", "Descarga y vista previa de archivos", "Acceso temporal al objeto privado"],
        ["CORS explícito", "Acceso desde navegadores", "Orígenes permitidos de Hopper"]
      ]
    },
    faq: [
      ["¿Hopper usa cifrado de extremo a extremo?", "No. Hopper usa HTTPS para cifrado en tránsito y controles de acceso, pero el Worker participa en el procesamiento; por eso no se presenta como una solución E2E."],
      ["¿El bucket de archivos es público?", "No. La configuración de Hopper utiliza un bucket privado y genera URLs firmadas temporales cuando se necesita acceder a un archivo."],
      ["¿Las salas comparten la sesión de Mi espacio?", "No. Las salas usan tokens con alcance propio y pueden revocarse al cerrarse."],
      ["¿Por qué expiran los enlaces de archivos?", "La expiración reduce el tiempo durante el cual una URL firmada puede utilizarse y evita convertirla en un enlace permanente al almacenamiento."]
    ]
  }
];

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function schemaFor(page) {
  const pageUrl = `${SITE_URL}${page.path}`;
  const faqEntities = page.faq.map(([name, answer]) => ({
    "@type": "Question",
    name,
    acceptedAnswer: { "@type": "Answer", text: answer }
  }));

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${pageUrl}#webpage`,
        url: pageUrl,
        name: page.title,
        description: page.description,
        inLanguage: "es",
        isPartOf: { "@id": `${SITE_URL}/#website` },
        about: { "@id": `${SITE_URL}/#app` }
      },
      {
        "@type": "FAQPage",
        "@id": `${pageUrl}#faq`,
        mainEntity: faqEntities
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Hopper", item: `${SITE_URL}/` },
          { "@type": "ListItem", position: 2, name: page.h1, item: pageUrl }
        ]
      }
    ]
  };
}

function renderStructuredData(page) {
  return `<script type="application/ld+json">${JSON.stringify(schemaFor(page)).replaceAll("<", "\\u003c")}</script>`;
}

function renderSteps(steps) {
  return steps.map(([title, copy], index) => `
          <article class="seo-step">
            <span class="seo-step-number" aria-hidden="true">${index + 1}</span>
            <h3>${escapeHtml(title)}</h3>
            <p>${escapeHtml(copy)}</p>
          </article>`).join("");
}

function renderTable(table) {
  const headers = table.headers.map((header) => `<th scope="col">${escapeHtml(header)}</th>`).join("");
  const rows = table.rows.map((row) => `<tr>${row.map((cell, index) => index === 0 ? `<th scope="row">${escapeHtml(cell)}</th>` : `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("");
  return `<div class="seo-table-wrap"><table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderFaq(faq) {
  return faq.map(([question, answer]) => `
          <details class="seo-faq-item">
            <summary>${escapeHtml(question)}</summary>
            <p>${escapeHtml(answer)}</p>
          </details>`).join("");
}

function renderClusterLinks(currentPath) {
  return SEO_PAGES.filter((page) => page.path !== currentPath).map((page) => `
          <a class="seo-cluster-link" href="${page.path}">
            <strong>${escapeHtml(page.h1)}</strong>
            <span>${escapeHtml(page.description)}</span>
          </a>`).join("");
}

function gscMeta(verification) {
  return verification ? `<meta name="google-site-verification" content="${escapeHtml(verification)}">` : "";
}

export function renderSeoPage(page, { ga4MeasurementId = "", gscVerification = "" } = {}) {
  const canonical = `${SITE_URL}${page.path}`;
  const imageUrl = `${SITE_URL}/assets/icons/hopper-512.png`;
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>${escapeHtml(page.title)}</title>
  <meta name="description" content="${escapeHtml(page.description)}">
  <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">
  ${gscMeta(gscVerification)}
  <link rel="canonical" href="${canonical}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${APP_NAME}">
  <meta property="og:locale" content="es_CO">
  <meta property="og:title" content="${escapeHtml(page.title)}">
  <meta property="og:description" content="${escapeHtml(page.description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${imageUrl}">
  <meta property="og:image:alt" content="Hopper, aplicación web para transferir texto y archivos entre dispositivos">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${escapeHtml(page.title)}">
  <meta name="twitter:description" content="${escapeHtml(page.description)}">
  <meta name="twitter:image" content="${imageUrl}">
  <meta name="theme-color" content="#202123">
  <link rel="icon" href="/assets/favicon.ico" sizes="any">
  <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/seo.css">
  ${renderStructuredData(page)}
  <script defer src="/seo-runtime.js" data-hopper-seo data-ga4="${escapeHtml(ga4MeasurementId)}"></script>
</head>
<body>
  <header class="seo-header">
    <a class="seo-brand" href="/" aria-label="Abrir Hopper">
      <img src="/assets/favicon.svg" alt="" width="30" height="30">
      <span>HOPPER</span>
    </a>
    <nav aria-label="Guías de Hopper">
      <a href="/transferir-archivos">Archivos</a>
      <a href="/compartir-texto">Texto</a>
      <a href="/salas-temporales">Salas</a>
      <a href="/seguridad">Seguridad</a>
    </nav>
  </header>

  <main class="seo-main">
    <section class="seo-hero" aria-labelledby="seo-title">
      <img class="seo-hero-icon" src="/assets/hopper-transferencia-archivos.svg" alt="Icono de Hopper para transferencia temporal de archivos y texto" width="88" height="88">
      <p class="seo-eyebrow">${escapeHtml(page.eyebrow)}</p>
      <h1 id="seo-title">${escapeHtml(page.h1)}</h1>
      <p class="seo-intro">${escapeHtml(page.intro)}</p>
      <div class="seo-actions">
        <a class="seo-primary" href="/" data-cta>Abrir Hopper</a>
        <button class="seo-secondary" type="button" data-share>Compartir esta página</button>
      </div>
    </section>

    <section class="seo-card seo-tldr" aria-labelledby="takeaways-title">
      <p class="seo-eyebrow">EN BREVE</p>
      <h2 id="takeaways-title">Puntos clave</h2>
      <ul>${page.takeaways.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </section>

    <section class="seo-section" aria-labelledby="steps-title">
      <p class="seo-eyebrow">CÓMO FUNCIONA</p>
      <h2 id="steps-title">Tres pasos para usar Hopper</h2>
      <div class="seo-steps">${renderSteps(page.steps)}</div>
    </section>

    <section class="seo-section" aria-labelledby="details-title">
      <p class="seo-eyebrow">DETALLES</p>
      <h2 id="details-title">Qué ofrece este flujo</h2>
      ${renderTable(page.table)}
    </section>

    <section class="seo-section" aria-labelledby="faq-title">
      <p class="seo-eyebrow">FAQ</p>
      <h2 id="faq-title">Preguntas frecuentes</h2>
      <div class="seo-faq">${renderFaq(page.faq)}</div>
    </section>

    <section class="seo-section" aria-labelledby="cluster-title">
      <p class="seo-eyebrow">MÁS SOBRE HOPPER</p>
      <h2 id="cluster-title">Guías relacionadas</h2>
      <div class="seo-cluster">${renderClusterLinks(page.path)}</div>
    </section>
  </main>

  <footer class="seo-footer">
    <p><a href="${REPOSITORY_URL}" target="_blank" rel="noopener noreferrer">Hopper en GitHub</a> · ${escapeHtml(AUTHOR.name)}</p>
    <p>Aplicación web de transferencia temporal de texto y archivos.</p>
  </footer>

  <a class="seo-mobile-cta" href="/" data-cta>Abrir Hopper</a>
</body>
</html>`;
}

export function renderSitemap() {
  const urls = ["/", ...SEO_PAGES.map((page) => page.path)];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((path, index) => `  <url>\n    <loc>${SITE_URL}${path}</loc>\n    <changefreq>${index === 0 ? "weekly" : "monthly"}</changefreq>\n    <priority>${index === 0 ? "1.0" : "0.8"}</priority>\n  </url>`).join("\n")}\n</urlset>\n`;
}

export function renderRobots() {
  return `User-agent: *\nAllow: /\nDisallow: /space\nDisallow: /admin\nDisallow: /room\nDisallow: /recover\nDisallow: /share\nDisallow: /404\nDisallow: /page/\n\nSitemap: ${SITE_URL}/sitemap.xml\n`;
}

export function renderLlms() {
  return `# Hopper\n\n> Hopper es una PWA para transferir temporalmente texto y archivos entre dispositivos mediante un espacio privado con PIN o salas temporales.\n\n## Aplicación\n\n- Producción: ${SITE_URL}/\n- Repositorio: ${REPOSITORY_URL}\n- Autor: ${AUTHOR.name}\n\n## Capacidades\n\n- Transferencia de texto, código, enlaces y archivos.\n- Mi espacio protegido por PIN de cuatro dígitos.\n- Retención personal de 5, 15 o 30 minutos, 1 hora, 6 horas, 1 día o indefinida.\n- Hasta 3 salas temporales simultáneas.\n- Salas con vida máxima de 10 minutos y cierre tras 5 minutos sin actividad.\n- Hasta 512 MB por archivo en Mi espacio.\n- Hasta 256 MB por archivo y 512 MB totales por sala.\n- PWA y Web Share Target.\n\n## Seguridad\n\nHopper usa HTTPS en producción, sesiones y tokens firmados, CORS explícito, Backblaze B2 privado y URLs firmadas temporales. Hopper no se presenta como cifrado de extremo a extremo: el Worker participa en el procesamiento del contenido.\n\n## Guías públicas\n\n${SEO_PAGES.map((page) => `- [${page.h1}](${SITE_URL}${page.path}): ${page.description}`).join("\n")}\n\n## Rutas privadas o no indexables\n\n- /space\n- /admin\n- /room/*\n- /recover\n- /share\n\nNo se deben inferir secretos, credenciales, contenido transferido ni datos de usuarios a partir de esta documentación.\n`;
}

export const SEO_SITE = { SITE_URL, APP_NAME, REPOSITORY_URL, AUTHOR };
