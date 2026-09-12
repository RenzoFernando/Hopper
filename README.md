<div align="center">

# Hopper

<br>

<img src="assets/favicon.png" alt="Icono de Hopper" width="120" align="center">

<!-- HOPPER_APP_URL_START -->
<p>
  <a href="https://hopper-transfer.pages.dev/">
    <img src="https://img.shields.io/badge/VER%20APLICACI%C3%93N%20WEB-202123?style=for-the-badge" alt="Ver aplicación web">
  </a>
</p>
<!-- HOPPER_APP_URL_END -->

<strong>Transferencia temporal de texto y archivos entre dispositivos.</strong>

</div>

<br>

Hopper es una PWA para mover contenido entre dispositivos desde un espacio privado protegido por PIN o mediante salas públicas temporales. Permite compartir texto y archivos, controlar cuánto tiempo permanece disponible cada elemento, recuperar el acceso por correo y recibir contenido desde aplicaciones compatibles con Web Share Target.

## Características

- Transferir texto, código, imágenes, documentos, ZIPs, audio y otros archivos.
- Proteger Mi espacio con un PIN de cuatro dígitos y recuperación por correo.
- Elegir expiración de 5, 15 o 30 minutos, 1 hora, 6 horas, 1 día o conservar contenido indefinidamente.
- Crear hasta tres salas públicas simultáneas con códigos de acceso independientes.
- Mantener cada sala hasta 10 minutos y cerrarla automáticamente tras 5 minutos sin actividad.
- Admitir archivos de hasta 512 MB en Mi espacio y 256 MB por archivo dentro de una sala.
- Subir archivos directamente a Backblaze B2 con cola, progreso, cancelación y reintentos seguros.
- Previsualizar imágenes y reproducir audio mediante URLs firmadas temporales.
- Instalar Hopper como PWA y recibir contenido mediante Web Share Target.
- Consultar uso, transferencias, fallos, salud, límites, salas y mantenimiento desde Administración.

## Tecnologías

- React + TypeScript
- Vite
- Cloudflare Pages
- Cloudflare Workers
- Cloudflare D1
- Backblaze B2
- Resend

## Autor y licencia

[Renzo Fernando Mosquera Daza](https://github.com/RenzoFernando)

© 2026 — Renzo Fernando Mosquera Daza

Licencia MIT.
