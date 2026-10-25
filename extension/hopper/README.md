# Hopper — Extensión de envío rápido

Extensión Manifest V3 para navegadores Chromium (Chrome, Edge y Opera). Mantiene la estética de Hopper y permite enviar texto, preparar y publicar archivos pequeños, capturar el enlace de la pestaña actual y abrir la bandeja.

## Instalar sin publicar en una tienda

1. En Chrome abre `chrome://extensions`, en Edge `edge://extensions` o en Opera `opera://extensions`.
2. Activa el modo desarrollador y pulsa **Cargar descomprimida** / **Load unpacked**.
3. Selecciona la carpeta `extension/hopper` que copiaste a tu proyecto. No selecciones el ZIP ni la carpeta raíz de Hopper.
4. Fija el icono de Hopper en la barra de extensiones.
5. Inicia sesión normalmente en `https://hopper-transfer.pages.dev/` usando el PIN. Abre la extensión desde cualquier pestaña.

La extensión usa la sesión existente del sitio de Hopper. No guarda el PIN ni envía credenciales a otras páginas. Si la sesión caduca, basta con iniciar sesión otra vez en Hopper. Abre la aplicación en una pestaña en segundo plano si es necesario; **no necesita mostrarla al frente para enviar**.

## Limitaciones actuales

- El envío desde el popup admite archivos de hasta **32 MB cada uno**; para archivos más grandes sigue funcionando el límite normal de la aplicación web (512 MB). La ventana del popup debe permanecer abierta mientras transmite el archivo al puente. Si se cierra durante la lectura del archivo, retira el elemento incompleto y vuelve a adjuntarlo.
- La precarga utiliza Backblaze B2 desde el origen web autorizado de Hopper; los elementos permanecen privados hasta pulsar publicar. Las reservas no publicadas son temporales.
- Utiliza el sitio de producción actual como punto de conexión. Los cambios de aspecto que pruebes con Vite local no se reflejarán en la extensión hasta desplegar el nuevo frontend, pero puedes probar la extensión con tu sesión de producción actual.
- Solo solicita permisos para interactuar con Hopper, consultar la pestaña activa y pegar desde el portapapeles cuando lo solicites. No lee el contenido de las demás páginas.
- Para instalarla en otro equipo, repite **Cargar descomprimida** en ese navegador. No es necesario cambiar el Worker ni la base D1.
