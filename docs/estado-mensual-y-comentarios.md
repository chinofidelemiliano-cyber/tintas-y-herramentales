# Estado mensual y comentarios de órdenes

En Supabase → SQL Editor, ejecuta completo `supabase/order-status-and-comments.sql`, después de activar cuentas y permisos. Incluye la actualización del formulario de tintas y la validación del metraje. Conserva órdenes, existencias y comentarios anteriores. Las instalaciones nuevas ya lo incluyen en setup.sql.

En **Configuración → Configuración de órdenes de producción → Enlace de consulta mensual**, pulsa **Crear enlace de consulta**. Copia y comparte la dirección completa. Es un enlace privado de solo lectura, separado del enlace de captura: no permite enviar órdenes, editar, comentar ni consultar existencias, costos o recetas. Quien tenga el enlace puede consultar los datos de programación incluidos en él. Renovarlo invalida el enlace de consulta anterior; desactivarlo bloquea la consulta. El enlace de captura se conserva.

La consulta permite elegir el mes de programación (o la fecha del registro si la orden antigua no tiene fecha programada). Muestra En espera, En preparación, Preparada, Cerrada o Cancelada. Supabase conserva automáticamente un registro mensual al crear o actualizar órdenes; las anteriores se incorporan al ejecutar la migración. El historial mensual refleja el último estado de cada orden, incluso si terminó en otro mes; no es un corte congelado. Se actualiza en la página cada 30 segundos y permite imprimir o guardar como PDF.

Las órdenes nuevas requieren un metraje programado mayor que cero, también validado por el servidor. Las antiguas sin metraje se conservan y muestran No registrado.

En el detalle de una orden y al capturar sus consumos aparece **Comentarios de la orden → Guardar solo comentario**. Guarda texto, autor y fecha sin exigir pesos ni metros reales, cambiar el estado, cerrar la orden o descontar inventario. Los comentarios son privados: no se publican en el enlace de consulta. Confirmar un consumo sigue requiriendo sus pesos para calcular la salida real. Los comentarios se permiten a cuentas con acceso a producción o preparación, y quedan disponibles en órdenes abiertas y cerradas.

## Acceso con usuario y contraseña

El enlace de consulta ahora requiere las credenciales compartidas indicadas por el administrador. En proyectos ya instalados, ejecuta `supabase/order-status-login.sql` completo; el archivo combinado de estado y comentarios también incluye esta protección al final. El enlace existente no cambia. La contraseña se almacena mediante un hash y se comprueba en el servidor; no está incluida en los archivos del navegador. Cada acceso genera una sesión de consulta de una hora, vinculada al enlace y guardada solo en esa pestaña. Cerrar sesión la revoca. Renovar o desactivar el enlace bloquea también las sesiones anteriores. Tras 10 intentos fallidos hay una espera de 10 minutos. Estos datos de acceso son exclusivos de la consulta compartida, no crean usuarios ni conceden acceso al inventario.

La protección debe aplicarse después de cualquier migración anterior que vuelva a crear las funciones de consulta, para mantener cerrada la ruta sin sesión.
