<div align="center">

# Hopper

<br>

<img src="assets/favicon.png" alt="Icono de Hopper" width="120" align="center">

<br>
<br>

<p>
  <a href="https://renzofernando.github.io/Hopper/">
    <img src="https://img.shields.io/badge/VER%20APLICACI%C3%93N%20WEB-202123?style=for-the-badge" alt="Ver aplicación web">
  </a>
</p>

<strong>Transferencia temporal de texto, archivos y audio.</strong>

</div>

<br>

<p>
  Hopper es una aplicación web instalable para mover contenido temporalmente entre dispositivos. Incluye un espacio privado protegido con PIN y hasta dos salas públicas temporales que cualquier persona puede crear o abrir mediante un código.
</p>

## Características

- Transferir texto, código, imágenes, documentos, ZIPs, audio y otros archivos.
- Proteger el espacio privado mediante un PIN de cuatro dígitos y recuperación por correo.
- Crear hasta dos salas públicas simultáneas sin usar el PIN.
- Mantener cada sala activa mientras exista actividad y cerrarla tras 5 minutos de inactividad.
- Expirar el contenido de las salas a los 5 minutos, sin controles de TTL para participantes.
- Subir hasta dos archivos simultáneamente con cola, progreso, cancelación y reintentos seguros.
- Previsualizar imágenes y reproducir audio bajo demanda mediante URLs firmadas temporales.
- Instalar Hopper como PWA y recibir contenido mediante Web Share Target en navegadores compatibles.
- Consultar uso, salud, límites, salas activas y mantenimiento desde Administración.
- Abrir o cerrar cualquier sala activa desde Administración.

## Tecnologías

- HTML5
- CSS3
- JavaScript ES Modules
- Progressive Web App
- Cloudflare Workers
- Cloudflare D1
- Backblaze B2
- Resend

## Pruebas

```bash
node --test tests/*.test.js
```

## Autor y licencia

[Renzo Fernando Mosquera Daza](https://github.com/RenzoFernando)

© 2026 — Renzo Fernando Mosquera Daza

Licencia MIT.
