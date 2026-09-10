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

<strong>Transferencia temporal de texto, archivos y audio.</strong>

</div>

<br>

Hopper es una PWA para mover contenido temporalmente entre dispositivos. El frontend es una SPA estÃ¡tica en React + TypeScript desplegada en Cloudflare Pages y la API es un Ãºnico Cloudflare Worker TypeScript con Hono y Zod. La persistencia usa Cloudflare D1, los archivos temporales Backblaze B2 y la recuperaciÃ³n Resend.

## CaracterÃ­sticas

- Transferir texto, cÃ³digo, imÃ¡genes, documentos, ZIPs, audio y otros archivos.
- Proteger el espacio privado mediante un PIN de cuatro dÃ­gitos y recuperaciÃ³n por correo.
- Crear hasta dos salas pÃºblicas simultÃ¡neas sin usar el PIN.
- Mantener cada sala activa mientras exista actividad y cerrarla tras 5 minutos de inactividad.
- Expirar el contenido de las salas a los 5 minutos, sin controles de TTL para participantes.
- Subir hasta dos archivos simultÃ¡neamente con cola, progreso, cancelaciÃ³n y reintentos seguros.
- Previsualizar imÃ¡genes y reproducir audio bajo demanda mediante URLs firmadas temporales.
- Instalar Hopper como PWA y recibir contenido mediante Web Share Target.
- Consultar uso, salud, lÃ­mites, salas activas y mantenimiento desde AdministraciÃ³n.
- Abrir o cerrar cualquier sala activa desde AdministraciÃ³n.

## Arquitectura

- React + TypeScript + Vite + React Router + TanStack Query + Zod.
- Cloudflare Pages Direct Upload para el frontend estÃ¡tico.
- Un Ãºnico Cloudflare Worker con TypeScript + Hono + Zod.
- Cloudflare D1 para persistencia.
- Backblaze B2 para archivos temporales y subida directa con URLs firmadas.
- Resend para recuperaciÃ³n.
- GitHub Actions para CI/CD independiente de frontend y Worker.
- Vitest, Testing Library y Playwright para pruebas.

Las rutas pÃºblicas actuales son `/`, `/space`, `/admin`, `/room/XX-0000`, `/recover` y `/share`. Los enlaces histÃ³ricos se conservan mediante un redirect de compatibilidad publicado en GitHub Pages.

## Autor y licencia

[Renzo Fernando Mosquera Daza](https://github.com/RenzoFernando)

Â© 2026 â€” Renzo Fernando Mosquera Daza

Licencia MIT.
