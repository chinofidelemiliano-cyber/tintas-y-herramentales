# Hora y zona horaria

En **Configuración → Hora y zona horaria**, elige:

- **Ubicación actual del dispositivo:** utiliza la zona horaria configurada en el teléfono o computadora. No solicita permisos de GPS. Si viajas, la visualización de tu perfil sigue la zona del dispositivo.
- **Zona horaria personalizada:** selecciona la zona deseada, por ejemplo America/Mexico_City, America/Tijuana, Europe/Madrid o UTC.
- **Formato de hora:** 12 o 24 horas.

La vista previa muestra el horario antes de guardar. Pulsa **Guardar configuración**. La elección se guarda en tu perfil para otros dispositivos. En automático cada dispositivo usa su propia zona; en personalizada todos usan la zona guardada.

El reloj de la página, horas reales de órdenes e incidencias, comentarios, inicios de sesión, dispositivos y PDF utilizan la configuración. Los cronómetros conservan su duración real. Las fechas de calendario registradas y los horarios programados capturados manualmente conservan su significado; no se reescribe el historial al cambiar de zona. El formato de 12/24 horas se aplica al mostrar esos horarios. Las horas reales se mantienen almacenadas en UTC.

Cuando guarda un administrador, su zona resuelta en ese momento y el formato se publican también para las páginas compartidas de captura y consulta, incluida su impresión. Las preferencias de otros usuarios permanecen personales y no cambian la hora compartida. Si el administrador cambia de ubicación en modo automático, debe guardar nuevamente para publicar esa nueva zona al equipo.

## Activación en Supabase

Ejecuta completo `supabase/time-settings.sql` después de las migraciones actuales de perfil, cuentas, tintas y consulta con contraseña. Conserva las órdenes, comentarios, contraseñas e inventario. La instalación nueva ya lo incluye al final de setup.sql. Si ya habías guardado una zona válida en tu perfil administrador, se toma al activar; después puedes cambiarla desde Configuración.

La actualización aplica la zona al día de operación en el servidor y publica únicamente zona y formato en las páginas compartidas. Mantiene sus enlaces y la contraseña de consulta. Aplica esta migración al final si vuelves a ejecutar migraciones anteriores que recrean esas funciones.
