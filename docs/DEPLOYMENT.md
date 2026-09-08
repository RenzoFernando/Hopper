# Despliegue de Hopper

Hopper separa el frontend estático del backend. El navegador usa el Cloudflare Worker para autenticarse y gestionar la bandeja; D1 almacena seguridad, textos y metadatos, mientras los archivos binarios viajan directamente entre el navegador y un bucket privado de Backblaze B2 mediante URLs prefirmadas de corta duración.

## Requisitos

- Node.js con `npx` disponible.
- Una cuenta de Cloudflare con Workers y D1 disponibles en el plan Free.
- Una cuenta de Backblaze B2 sin método de pago.
- Un bucket privado de Backblaze B2 dedicado a Hopper.
- Un Application Key de Backblaze B2 con acceso **Read and Write** limitado al bucket de Hopper.
- La Master Application Key de Backblaze disponible únicamente para configurar CORS.
- Una API key de Resend Free y un correo de recuperación.
- La URL pública desde la que se servirá el frontend.

## Política de costo

Hopper está diseñado para funcionar sin activar facturación.

- No añadas tarjeta ni método de pago a Backblaze para esta instancia.
- No cambies Cloudflare Workers o D1 a un plan de pago.
- Utiliza el plan Free de Resend.
- Si cualquiera de las plataformas exige una compra o método de pago para continuar, detén el proceso antes de aceptarlo.

Una cuenta Backblaze B2 sin método de pago aplica límites de uso. Cuando se alcanza un límite, las operaciones pueden ser rechazadas; Hopper debe fallar de forma visible en lugar de asumir que una transferencia terminó correctamente.

## Backblaze B2

### Cuenta y bucket

1. Crea o utiliza una cuenta de Backblaze B2 sin añadir método de pago.
2. Crea un bucket dedicado exclusivamente a Hopper.
3. Mantén el bucket como **Private**.
4. No habilites **Object Lock**. Hopper necesita eliminar definitivamente los archivos temporales.
5. Copia el **S3 Endpoint** que muestra Backblaze para el bucket. Tiene una forma similar a:

```text
https://s3.us-west-004.backblazeb2.com
```

Los buckets de B2 conservan versiones por defecto. Hopper no se limita a borrar el nombre del objeto: el Worker enumera las versiones asociadas a la clave temporal y elimina cada `versionId`, evitando que versiones antiguas sigan consumiendo almacenamiento.

### Application Key operativo

En **Application Keys**, crea una clave específica para Hopper:

- acceso únicamente al bucket de Hopper;
- tipo de acceso **Read and Write**;
- prefijo de nombre `drop/`, de modo que la credencial no pueda operar fuera del espacio temporal de Hopper.

Guarda el **Key ID** y el **Application Key** cuando se muestren. El Application Key se muestra una sola vez.

Esta credencial es la que se almacena como secrets del Worker. No uses la Master Application Key para las operaciones normales de Hopper.

### CORS

Las cargas y descargas se realizan directamente desde el navegador hacia B2, por lo que el bucket necesita CORS.

`hopper-admin.ps1` configura una regla limitada a:

- la URL pública de Hopper;
- `http://localhost:5500`;
- `http://127.0.0.1:5500`;
- operaciones S3 `PUT`, `GET` y `HEAD`;
- encabezado `Content-Type`.

Para cambiar CORS y las reglas de ciclo de vida de un bucket, Backblaze requiere permisos administrativos sobre el bucket. El administrador solicita la **Master Application Key** únicamente durante esa operación, la mantiene en memoria y no la guarda en archivos ni en Cloudflare.

En el mismo paso se instala una regla de seguridad para el prefijo `drop/`: los objetos que sobrevivan a la limpieza normal se ocultan después de un día y se eliminan después de otro día. Esta regla es una red de seguridad; la expiración normal de Hopper continúa siendo de minutos u horas.

## Configuración inicial guiada

Desde PowerShell, situado en la raíz del proyecto:

```powershell
.\hopper-admin.ps1
```

Selecciona **1 — Configuración inicial guiada**.

El administrador realiza, en orden:

1. Selección o creación de `hopper-db` en D1.
2. Registro del nombre del Worker y la URL pública de Hopper.
3. Registro del nombre del bucket de B2, su S3 Endpoint y el límite de tamaño por archivo.
4. Aplicación de `cloudflare/schema.sql` en D1.
5. Despliegue del Worker y programación de la limpieza cada minuto.
6. Generación y carga de `SESSION_SECRET`.
7. Carga del Key ID y Application Key operativos de B2 como secrets del Worker.
8. Prueba real de escritura, lectura y eliminación sobre B2.
9. Configuración de Resend y del correo de recuperación.
10. Creación del PIN de cuatro dígitos sin guardarlo en el repositorio.
11. Configuración de CORS y de la regla de ciclo de vida de seguridad en B2 usando temporalmente la Master Application Key.
12. Escritura de la URL real del Worker en `js/config.js`.
13. Comprobación del estado de D1 y del endpoint `/health`.

Los archivos `.hopper-admin.json` y `.hopper-wrangler.json` están excluidos de Git. El primero conserva únicamente datos operativos no secretos; el segundo existe solo durante el despliegue.

## Transferencia de archivos

El flujo de un archivo es:

```text
Navegador
    │
    │ solicita autorización
    ▼
Cloudflare Worker
    │
    │ URL prefirmada temporal
    ▼
Navegador ─────────────► Backblaze B2
```

El cuerpo binario no atraviesa el Worker. El Worker valida la sesión, crea el registro temporal en D1 y firma la operación S3. Después de la subida, el Worker comprueba el objeto mediante `HEAD` antes de marcarlo como disponible.

Para descargar o previsualizar, el Worker vuelve a comprobar que el elemento siga vigente y emite otra URL de corta duración.

## Frontend

No existe proceso de compilación. Publica la raíz del repositorio como sitio estático.

Para probar localmente:

```powershell
npx --yes http-server . -p 5500 -c-1
```

El Worker permite `http://localhost` y `http://127.0.0.1` durante desarrollo. La regla CORS de B2 configurada por el administrador incluye también esos orígenes.

Si cambia la URL pública, ejecuta el administrador y selecciona **15 — Cambiar URL pública**. Esa acción vuelve a desplegar el Worker y solicita de nuevo la Master Application Key para actualizar CORS.

## Recuperación

Después de cinco PIN incorrectos, Hopper bloquea el acceso global, invalida las sesiones activas, genera un token de recuperación de un solo uso y envía un correo mediante Resend.

El token vence a los 15 minutos y viaja en el fragmento `#token=` de `recover.html`, por lo que no se envía como parte de la URL HTTP al hosting estático.

El menú administrativo permite reenviar la configuración de correo, cambiar el PIN, bloquear o desbloquear manualmente la aplicación, administrar IPs o redes bloqueadas y revisar los últimos eventos de seguridad.

## Expiración y limpieza

Cada elemento tiene su propio `expiresAt`. El frontend lo oculta al llegar a cero y el Worker vuelve a comprobar la expiración antes de emitir una URL de archivo o extender el tiempo.

Un Cron Trigger ejecuta la limpieza cada minuto:

1. localiza elementos vencidos en D1;
2. para cada archivo, enumera todas las versiones de la clave exacta en B2;
3. elimina definitivamente cada versión mediante su `versionId`;
4. elimina el registro de D1 únicamente después de limpiar el almacenamiento.

Las subidas iniciadas que no se completan vencen y son retiradas por el mismo proceso.

La limpieza está deliberadamente acotada para el plan Free de Cloudflare Workers. Cada ejecución procesa como máximo cinco elementos vencidos. Para un archivo, Hopper enumera hasta nueve entradas y elimina como máximo ocho versiones por ciclo; si todavía quedan versiones, conserva el registro de D1 y continúa en el siguiente minuto. Así una ejecución patológica permanece por debajo del límite de subrequests externos del Worker y nunca marca como eliminado un archivo que aún tenga versiones pendientes.

Además, el bucket mantiene una regla de ciclo de vida para `drop/` como última defensa. Backblaze ejecuta esas reglas de forma asíncrona, por lo que no sustituyen la cuenta regresiva ni la limpieza del Worker.

## Verificación final

Ejecuta:

```powershell
npm test
```

Después aplica la matriz de producción de [`TESTING.md`](TESTING.md) desde dos dispositivos distintos antes de considerar terminado el despliegue.
