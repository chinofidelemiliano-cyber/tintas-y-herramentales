# Activar avisos de órdenes nuevas

El sitio ya incluye **Administrar dispositivos**. Para recibir avisos también con la página cerrada, activa el servicio de envío una sola vez en Supabase.

## 1. Ejecutar la actualización de la base

Abre **Supabase → SQL Editor → New query**. Copia y ejecuta **todo** [device-notifications.sql](../supabase/device-notifications.sql).

No modifica existencias ni tiempos. Crea registros privados de equipos y avisos pendientes. La carga de una orden no depende de que llegue la notificación.

## 2. Crear la función de envío

1. En **Supabase → Edge Functions → Deploy a new function → Via Editor**, crea una función llamada exactamente **`push-notifications`**.
2. Abre [index.ts](../supabase/functions/push-notifications/index.ts), copia **todo** su contenido y reemplaza el contenido del archivo `index.ts` del editor. Pulsa **Deploy**.
3. En la configuración de esa función desactiva **Verify JWT / Verify JWT with legacy secret**. La función verifica por su cuenta la sesión y la membresía para configurar dispositivos, y una clave privada para los envíos automáticos.

Es un único archivo. No necesitas crear ni compartir claves: las de Web Push se generan en la primera activación y quedan privadas en la base. La función usa las variables internas que Supabase ya proporciona. **No pegues contraseñas ni claves service_role en el sitio o en esta conversación.**

## 3. Activar cada equipo

1. Abre tu dirección definitiva de Cloudflare con HTTPS e inicia sesión.
2. Entra a **Administrar dispositivos** y escribe un nombre reconocible.
3. Marca **Notificarme cuando llegue una orden de producción** y acepta el permiso del navegador.
4. Pulsa **Probar aviso** y comprueba que aparezca la notificación del sistema.

«Prueba solicitada» solo confirma que la solicitud se guardó. «Último envío al navegador» significa que el servicio push aceptó el envío; la recepción real se comprueba viendo el aviso.

### En iPhone / iPad

Requiere iOS/iPadOS 16.4 o posterior. Abre el sitio en Safari → **Compartir → Agregar a pantalla de inicio**. Abre ese icono, inicia sesión y activa los avisos desde ahí. Si están bloqueados, revisa los permisos y los modos de concentración del sistema.

## Administración

Puedes cambiar nombres, probar avisos o desactivar/eliminar dispositivos de tu perfil. Para volver a activar otro equipo abre el sitio desde ese equipo. Cerrar sesión desactiva los avisos de ese navegador. Cambiar de dominio requiere registrar el nuevo origen; puedes eliminar los registros de la dirección anterior.

Las órdenes anteriores a la activación no se reenvían. Pulsar un aviso abre **Tiempos de preparación**. El servicio reintenta errores temporales hasta cinco veces y desactiva suscripciones vencidas. No cachea formularios ni guarda tus tokens de inicio de sesión en el service worker.

## Si no llega una prueba

- Comprueba el permiso del navegador y que el equipo aparezca habilitado.
- Verifica que el SQL se ejecutó completo, la función se llama `push-notifications` y **Verify JWT** esté desactivado.
- Revisa **Edge Functions → push-notifications → Logs**. En **Database → Cron** debe existir `inventory-push-retry`.
- El sistema operativo, la conexión y el ahorro de batería pueden retrasar o impedir un aviso. La orden permanece guardada aunque el aviso no llegue.

La implementación se probó con envíos simulados, un evento push controlado en navegador y validación SQL. La entrega a un dispositivo real debe comprobarse después de estos pasos.
