# Activar la base de datos del piloto

Proyecto: `https://xkfyohpjlknifmkldfih.supabase.co`.

La URL y la clave publishable de `public/cloud-config.json` son públicas por diseño. La contraseña de usuario, las claves secret y service_role y la contraseña de PostgreSQL NO van en el repositorio ni en el chat. No se requieren claves privilegiadas en Netlify.

## Pasos en el panel de Supabase

1. Abre **SQL Editor → New query**. Pega el contenido completo de `setup.sql` y pulsa **Run**. Crea las tablas, los permisos y las funciones, e importa 75 productos y 88 lotes. El saldo inicial es 324,741 g netos. Repetirlo no reinicia las existencias ni duplica datos.
2. En **Authentication → Users → Add user → Create new user**, crea tu usuario con correo y contraseña propios. Usa la opción de confirmar el correo al crearlo si el panel la ofrece. No compartas la contraseña.
3. Abre otra consulta y pega `authorize-user.sql`. Cambia `CAMBIA_POR_TU_CORREO` por el correo exacto de tu usuario y pulsa **Run**. Este paso autoriza la cuenta a consultar y modificar el inventario.
4. Abre `https://inventariostt.netlify.app/` e inicia sesión con ese correo y contraseña. La barra superior debe indicar **Base de datos conectada**. Registrar un movimiento debe persistir al recargar y desde otra sesión autorizada.

Para otra persona, crea otro usuario y repite el paso 3 con su correo. Solo los miembros de `prisma_members` pueden utilizar las funciones del inventario. Todas las cuentas autorizadas comparten permisos de operación en esta primera versión. El formulario no ofrece registro público de usuarios.

## Qué queda preparado

- La versión hospedada usa Supabase Auth y las funciones transaccionales `prisma_state` y `prisma_action`.
- Las tablas tienen RLS habilitado y no dan acceso directo a los roles anon ni authenticated. Las funciones verifican la membresía del usuario y realizan los movimientos en una transacción PostgreSQL. Se serializan las escrituras para evitar que dos operadores descuenten el mismo saldo simultáneamente.
- Los registros pendientes no descuentan tinta; las confirmaciones, cancelaciones y cierres mantienen las validaciones del piloto local.
- El código no incluye service_role. Los tokens de sesión solo se guardan en sessionStorage de la pestaña y se renuevan con Supabase.
- El piloto local sigue usando SQLite en localhost. `?cloud=1` permite probar el conector de nube desde localhost; no modifica la configuración del servidor local.
- Los datos iniciales se importan desde los PDF proporcionados. Este archivo no copia automáticamente movimientos nuevos de una base SQLite local. Si se han capturado datos locales adicionales, deben migrarse antes de trabajar en ambos sistemas para evitar inventarios divergentes.

Preparar y publicar estos archivos no ejecuta SQL dentro de la cuenta de Supabase ni crea usuarios. No se debe dar la conexión por validada en producción hasta completar los pasos del panel y comprobar una operación real autenticada.

## Actualizar una base existente: tiempos de preparación

Si ya ejecutaste setup.sql antes de agregar esta sección, ejecuta ahora **preparation-times.sql**, completo, en SQL Editor. Añade la tabla protegida, la función de guardado y la lectura de preparaciones. No requiere volver a importar el inventario ni autorizar de nuevo a los usuarios existentes. La versión actual de setup.sql ya lo incluye para instalaciones nuevas.

## Actualizar: incidencias

Ejecuta **incidents.sql** completo en SQL Editor después de la instalación base. Añade el registro protegido de incidencias y su función de guardado. La numeración empieza en INC-0011 únicamente cuando no existen incidencias; repetir la actualización conserva la numeración, los registros y el resto del inventario. No requiere reautorizar usuarios. Los reportes PDF se generan en el navegador con los datos guardados.
