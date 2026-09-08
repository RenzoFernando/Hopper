# Despliegue de Hopper

Hopper separa el frontend estático del backend. El navegador usa el Cloudflare Worker para autenticarse y gestionar la bandeja; D1 almacena seguridad, textos y metadatos, mientras los archivos binarios viajan directamente entre el navegador y un bucket privado de R2 mediante URLs firmadas de corta duración.

## Requisitos

- Node.js con `npx` disponible.
- Una cuenta de Cloudflare con Workers, D1 y R2 disponibles.
- Un bucket privado de R2 para Hopper.
- Credenciales S3 de R2 con permiso **Object Read & Write** limitado al bucket de Hopper.
- Una API key de Resend y un correo de recuperación.
- La URL pública desde la que se servirá el frontend.

Hopper está planteado para funcionar dentro de niveles gratuitos. El administrador no activa planes de pago ni configura facturación. Si alguna plataforma exige habilitar cobros para continuar, detén la configuración antes de aceptarlos.

## R2 y credenciales S3

En Cloudflare, abre **Storage & databases → R2** y crea o selecciona el bucket de Hopper. El bucket debe permanecer privado.

Después abre la administración de API Tokens de R2 y crea credenciales con:

- permiso **Object Read & Write**;
- acceso únicamente al bucket de Hopper.

Conserva el **Access Key ID** y el **Secret Access Key**. El secreto se muestra una sola vez y nunca debe guardarse en el repositorio.

## Configuración inicial guiada

Desde PowerShell, situado en la raíz del proyecto:

```powershell
.\hopper-admin.ps1
```

Selecciona **1 — Configuración inicial guiada**.

El administrador realiza, en orden:

1. Selección o creación de la base `hopper-db` en D1.
2. Registro o creación del bucket privado de R2.
3. Registro del nombre del Worker, URL pública, Account ID de Cloudflare y límite de tamaño por archivo.
4. Aplicación de `cloudflare/schema.sql` en D1.
5. Despliegue del Worker con bindings para D1 y R2 y limpieza programada cada minuto.
6. Generación y carga de `SESSION_SECRET`.
7. Carga del Access Key ID y Secret Access Key de R2 como secrets del Worker.
8. Configuración de Resend y del correo de recuperación.
9. Creación del PIN de cuatro dígitos sin guardarlo en el repositorio.
10. Configuración de CORS del bucket para GitHub Pages y el entorno local.
11. Escritura de la URL real del Worker en `js/config.js`.
12. Comprobación de D1, R2 y del endpoint `/health`.

Los archivos `.hopper-admin.json`, `.hopper-wrangler.json` y `.hopper-r2-cors.json` están excluidos de Git. La configuración persistente guarda únicamente datos operativos no secretos; las credenciales se envían directamente a Cloudflare como secrets.

## Frontend

No existe proceso de compilación. Publica la raíz del repositorio como sitio estático.

Para probar localmente:

```powershell
npx --yes http-server . -p 5500 -c-1
```

El Worker permite `http://localhost` y `http://127.0.0.1` durante desarrollo. El administrador también incluye esos orígenes en CORS de R2.

Si cambia la URL pública, ejecuta el administrador y selecciona **15 — Cambiar URL pública**. Esa acción vuelve a desplegar el Worker, actualiza `PUBLIC_APP_URL`, ajusta el origen permitido y vuelve a configurar CORS de R2.

## Archivos

El Worker no recibe el cuerpo binario de los archivos. Después de validar la sesión crea una URL firmada para un objeto concreto de R2. El navegador sube directamente al bucket y luego confirma la operación con el Worker.

Para descargas y vistas previas ocurre lo mismo: el Worker valida que el elemento siga activo y emite una URL firmada que nunca dura más que el tiempo restante del elemento.

El bucket no necesita ser público.

## Recuperación

Después de cinco PIN incorrectos, Hopper bloquea el acceso global, invalida las sesiones activas, genera un token de recuperación de un solo uso y envía un correo mediante Resend. El token vence a los 15 minutos y viaja en el fragmento `#token=` de `recover.html`, por lo que no se envía como parte de la URL HTTP al hosting estático.

El menú administrativo permite reenviar la configuración de correo, cambiar el PIN, bloquear o desbloquear manualmente la aplicación, administrar IPs/redes bloqueadas y revisar los últimos eventos de seguridad.

## Expiración y limpieza

Cada elemento tiene su propio `expiresAt`. El frontend lo oculta al llegar a cero y bloquea las acciones de interfaz; el Worker vuelve a comprobar la expiración antes de emitir URLs de descarga o vista previa y antes de extender el tiempo.

Un Cron Trigger ejecuta la limpieza cada minuto. Los archivos expirados se eliminan primero de R2 y después se retiran sus metadatos de D1. Las subidas iniciadas que no se completan también vencen y se limpian automáticamente.

## Verificación final

Ejecuta:

```powershell
npm test
```

Después aplica la matriz de producción de [`TESTING.md`](TESTING.md) desde dos dispositivos distintos antes de considerar terminado el despliegue.
