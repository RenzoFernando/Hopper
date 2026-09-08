# Matriz de validación de Hopper

Esta matriz cubre la validación funcional, de seguridad, expiración, concurrencia y fallos de infraestructura prevista para el producto.

| Escenario | Resultado esperado |
| --- | --- |
| PIN correcto | Se crea una sesión temporal y aparece la bandeja global. |
| PIN incorrecto | El intento queda registrado y se informa cuántos intentos quedan. |
| Cinco PIN incorrectos | Hopper se bloquea, invalida sesiones y dispara una recuperación por correo. |
| Intento mientras está bloqueado | No se concede acceso aunque el PIN sea correcto. |
| Enlace de recuperación válido | Permite establecer y confirmar un PIN nuevo. |
| Token expirado | El cambio de PIN se rechaza. |
| Token ya usado | El cambio de PIN se rechaza. |
| PIN nuevo | Desbloquea Hopper e invalida sesiones anteriores. |
| Texto | Aparece en otro dispositivo, puede copiarse completo y conserva saltos/espacios del contenido. |
| Código | Se transfiere sin transformar el contenido. |
| Imagen compatible | Se sube, aparece en la bandeja, puede previsualizarse y descargarse. |
| ZIP | Se sube y descarga conservando nombre y tamaño. |
| PDF/documento | Se sube y descarga sin pasar por el Worker como cuerpo binario. |
| Archivo grande | Muestra progreso de subida y respeta el límite configurado. |
| Archivo por encima del límite | Se rechaza antes de crear una subida. |
| Múltiples archivos | Se cargan con concurrencia limitada y cada uno obtiene su propio contador. |
| Expiración a 15 min | Desaparece de la interfaz al llegar a cero y luego se elimina del backend. |
| Reinicio a 30 min | `expiresAt` se recalcula desde el momento del cambio. |
| Reinicio a 1 h o 6 h | El contador comienza de nuevo con el nuevo intervalo. |
| Descarga después de expirar | El Worker la rechaza aunque exista una URL antigua de la aplicación. |
| Eliminación manual | Se retira de R2/D1 y deja de aparecer en otros dispositivos. |
| Dos dispositivos simultáneos | Los cambios aparecen mediante sincronización periódica sin salas ni cuentas. |
| Conexión lenta | La interfaz muestra progreso y conserva los archivos fallidos para reintento. |
| Corte después de subir pero antes de confirmar | La subida pendiente termina siendo limpiada automáticamente. |
| D1 no disponible | La interfaz muestra error y no inventa un estado de éxito. |
| R2 no disponible | La subida/descarga falla de forma visible y el elemento pendiente se limpia. |
| Worker no disponible | La interfaz informa que no puede conectar y conserva el contenido local del compositor. |
| Sesión vencida | Se limpia la sesión del navegador y vuelve a solicitar PIN. |
| Origen no autorizado | El Worker responde con rechazo CORS/403. |
| Rate limit | Solicitudes excesivas reciben 429 sin alterar el contador global de PIN de forma artificial. |
| IP bloqueada | Las solicitudes de esa IP o red se rechazan antes de autenticar. |
| Cierre de sesión | `sessionStorage` se limpia y la interfaz vuelve al PIN. |
| Recarga del navegador | La sesión se conserva solo dentro de la sesión de pestaña/navegador mientras siga vigente. |

## Pruebas automatizadas

`npm test` ejecuta pruebas con el runner nativo de Node sobre:

- formato del PIN;
- tokens de sesión firmados y expiración;
- comparación IPv4/CIDR;
- normalización de tiempos de expiración;
- saneamiento de nombres de archivo;
- detección de expiración y de imágenes previsualizables;
- codificación y firma canónica usada en URLs prefirmadas de R2.
