<div align="center">

# Hopper

<br>

<img src="assets/favicon.png" alt="Icono de Hopper" width="120" align="center">

<br>
<br>

<!-- HOPPER_APP_URL_START -->
<p>
  <a href="https://hopper-transfer.pages.dev/">
    <img src="https://img.shields.io/badge/VER%20APLICACI%C3%93N%20WEB-202123?style=for-the-badge" alt="Ver aplicación web">
  </a>
</p>
<!-- HOPPER_APP_URL_END -->

<strong>Transferencia temporal de texto, archivos y audio entre dispositivos.</strong>

</div>

## Qué es Hopper

Hopper es una PWA con frontend estático en React + TypeScript + Vite y un único backend serverless en Cloudflare Workers. Permite mover contenido temporalmente entre dispositivos mediante un espacio privado protegido por PIN o salas públicas de corta duración.

La aplicación de producción está publicada en **Cloudflare Pages**: `https://hopper-transfer.pages.dev/`.

## Funcionalidades

- Transferencia temporal de texto, código, imágenes, documentos, ZIPs, audio y otros archivos.
- Espacio privado protegido por PIN de cuatro dígitos y recuperación por correo.
- Hasta dos salas públicas simultáneas, con expiración automática por inactividad.
- Subidas directas a Backblaze B2 con cola, progreso, cancelación y reintentos seguros.
- Previsualización de imágenes y reproducción de audio mediante URLs firmadas temporales.
- Instalación como PWA y recepción de contenido mediante Web Share Target.
- Panel de administración para uso, salud, límites, salas, seguridad y mantenimiento.

## Arquitectura

```text
Navegador
  │
  ▼
Cloudflare Pages
React + TypeScript + Vite
  │
  ▼
Cloudflare Worker
TypeScript + Hono + Zod
  │
  ├── Cloudflare D1
  ├── Backblaze B2
  └── Resend
```

El frontend usa React Router, TanStack Query, Zod y `vite-plugin-pwa`. El Worker mantiene toda la autorización y la lógica sensible del lado servidor.

Las rutas públicas actuales son `/`, `/space`, `/admin`, `/room/XX-0000`, `/recover` y `/share`. La aplicación ya no depende de páginas `.html`, hashes de sala ni del frontend anterior de GitHub Pages.

## Estilos

El diseño visual se mantiene congelado. Los estilos globales siguen usando las mismas clases y reglas, pero `src/styles/styles.css` ahora actúa como punto de entrada y divide el CSS por responsabilidad dentro de `src/styles/`. El orden de carga conserva la cascada original para evitar cambios visuales.

## Calidad y despliegue

La rama de producción es `master`. GitHub Actions ejecuta lint, typecheck, pruebas unitarias, regresión backend, integración, build y E2E. Los despliegues de frontend y Worker son independientes.

Comandos principales:

```powershell
npm ci
npm run lint
npm run typecheck
npm run test
npm run test:integration
npm run build
npm run test:e2e
```

Administración y verificación de producción:

```powershell
.\hopper-admin.ps1 -Action validate
.\hopper-admin.ps1 -Action pages
.\hopper-admin.ps1 -Action deploy
.\hopper-admin.ps1 -Action cors
.\hopper-admin.ps1 -Action verify
```


## Autor y licencia

[Renzo Fernando Mosquera Daza](https://github.com/RenzoFernando)

© 2026 — Renzo Fernando Mosquera Daza

Licencia MIT.
