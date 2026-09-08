# Despliegue de Hopper

Hopper separa el frontend estático del backend de seguridad. El navegador solo habla con el Cloudflare Worker; Firestore permanece cerrado al cliente y los archivos se suben directamente a Firebase Storage mediante URLs firmadas de corta duración.

## Requisitos

- Node.js con `npx` disponible.
- Una cuenta de Cloudflare con Workers y D1.
- Un proyecto Firebase con Firestore y Storage habilitados.
- Una cuenta de servicio JSON del mismo proyecto Firebase.
- Una API key de Resend y un correo de recuperación.
- La URL desde la que se publicará el frontend.

## Configuración inicial guiada

Desde PowerShell, situado en la raíz del proyecto:

```powershell
.\hopper-admin.ps1
```

Selecciona **1 — Configuración inicial guiada**.

El administrador realiza, en orden:

1. Selección o creación de `hopper-security-db` en D1.
2. Registro del nombre del Worker, URL pública, proyecto Firebase, bucket de Storage y límite de tamaño por archivo.
3. Aplicación de `cloudflare/schema.sql` en D1.
4. Despliegue del Worker y programación de la limpieza cada minuto.
5. Generación y carga de `SESSION_SECRET`.
6. Carga del JSON de cuenta de servicio de Firebase como secret del Worker.
7. Configuración de Resend y del correo de recuperación.
8. Creación del PIN de cuatro dígitos sin guardarlo en el repositorio.
9. Configuración de CORS en el bucket para el origen público y el entorno local.
10. Despliegue de las reglas cerradas de Firestore y Storage.
11. Escritura de la URL real del Worker en `js/config.js`.
12. Comprobación del estado de D1 y del endpoint `/health`.

Los archivos `.hopper-admin.json` y `.hopper-wrangler.json` están excluidos de Git. El primero conserva únicamente datos operativos no secretos; el segundo solo existe durante el despliegue.

## Cuenta de servicio de Firebase

En Firebase Console, abre la configuración del proyecto y genera una clave privada desde la sección de cuentas de servicio. Conserva ese JSON fuera del repositorio. El administrador verifica que `project_id` coincida con el proyecto configurado antes de enviarlo a Cloudflare como secret.

Firestore y Storage usan reglas `deny all`. El Worker accede con la cuenta de servicio y emite URLs firmadas únicamente después de validar una sesión de Hopper.

## Frontend

No existe proceso de compilación. Publica la raíz del repositorio como sitio estático.

Para probar localmente:

```powershell
npx --yes http-server . -p 5500 -c-1
```

El Worker permite `http://localhost` y `http://127.0.0.1` durante desarrollo. Storage queda configurado para los puertos `5500` utilizados por la guía.

Si cambia la URL pública, ejecuta el administrador y selecciona **15 — Cambiar URL pública**. Esa acción vuelve a desplegar el Worker, actualiza `PUBLIC_APP_URL`, ajusta el origen permitido y vuelve a configurar CORS de Storage.

## Recuperación

Después de cinco PIN incorrectos, Hopper bloquea el acceso global, invalida las sesiones activas, genera un token de recuperación de un solo uso y envía un correo mediante Resend. El token vence a los 15 minutos y viaja en el fragmento `#token=` de `recover.html`, por lo que no se envía como parte de la URL HTTP al hosting estático.

El menú administrativo permite reenviar la configuración de correo, cambiar el PIN, bloquear o desbloquear manualmente la aplicación, administrar IPs/redes bloqueadas y revisar los últimos eventos de seguridad.

## Expiración y limpieza

Cada elemento tiene su propio `expiresAt`. El frontend lo oculta al llegar a cero y bloquea las acciones de interfaz; el Worker vuelve a comprobar la expiración antes de emitir URLs de descarga o vista previa y antes de extender el tiempo. Las URLs firmadas de archivos tampoco pueden durar más que el tiempo restante del elemento.

Un Cron Trigger ejecuta la limpieza cada minuto. Los archivos se eliminan primero de Storage y después se elimina su documento de Firestore. Las subidas iniciadas que no se completan también vencen y son retiradas automáticamente.

## Verificación final

Ejecuta:

```powershell
npm test
```

Después aplica la matriz de producción de [`TESTING.md`](TESTING.md) desde dos dispositivos distintos antes de considerar terminado el despliegue.
