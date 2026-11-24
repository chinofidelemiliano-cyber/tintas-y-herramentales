# Flujo de preparación en Supabase

La actualización amplía el cronómetro existente en la versión hospedada de Prisma. Iniciar y finalizar usa los datos de la misma orden. La finalización conserva la comprobación de Pantones y la generación de la hoja de prensista.

## Activación en Cloudflare Pages

El sitio actual se sirve desde `tintas-y-herramentales.pages.dev`. La interfaz se publica con `public` como carpeta de salida. El cronómetro y los datos usan el proyecto Supabase configurado en `public/cloud-config.json`.

Confirma en Cloudflare cuál es la rama de producción y si el proyecto publica desde Git o desde una carga directa. Tras aplicar el SQL y probar una vista previa, comprueba que `/preparation-workflow.js` responda con JavaScript. Cloudflare Pages puede devolver la página HTML principal con código 200 cuando el archivo solicitado falta.

1. Genera una copia de seguridad verificable de la base Supabase, con sus usuarios y datos de Prisma. Conserva la copia en almacenamiento privado y comprueba la restauración en un entorno de prueba.
2. En un entorno de prueba que tenga aplicadas las migraciones de cuentas, órdenes e historial por responsable, ejecuta completo `supabase/preparation-workflow.sql`.
3. Prueba el inicio, pausa, reanudación, lista, edición, finalización, corrección e indicadores con cuentas de preparador y administrador. Para activar en el sitio operativo, aplica el mismo SQL después del respaldo y despliega la interfaz correspondiente.

El SQL añade registros de cronómetro por orden, preferencias de recordatorios y auditoría. Las marcas originales de las órdenes y las hojas existentes se conservan. Una preparación abierta antes de la migración puede finalizar mediante su acción habitual. Los registros históricos sin responsable verificado quedan sin atribución en los indicadores detallados.

## Operación

- **Preparación de órdenes → Recordatorios** configura los avisos personales. La jornada usa la zona horaria activa del perfil. Los avisos aparecen en el indicador con el sitio abierto.
- **Ver orden** muestra la lista generada a partir de los datos existentes. La preparación en curso conserva el estado de sus elementos al recargar.
- **Editar planeación** permite al administrador ajustar máquina, fecha de entrega, prioridad, minutos estimados y observaciones mientras la orden esté pendiente o en preparación. El motivo y los valores anteriores quedan registrados. El responsable recibe un aviso en el cronómetro.
- **Corregir tiempos** permite al administrador ajustar una preparación finalizada. Los tiempos de la última corrección alimentan los indicadores detallados y el historial por responsable.
- **Indicadores** consulta las preparaciones con tiempos detallados del mes seleccionado y admite filtros de máquina y responsable. El preparador consulta sus propios relojes y el administrador puede consultar todos.

El piloto SQLite conserva su comportamiento anterior. La migración de Supabase se valida en PostgreSQL temporal con `scripts/validate-preparation-workflow.mjs`. Este script acepta la ruta a `@electric-sql/pglite/dist/index.js` en `PRISMA_PGLITE_MODULE`. La prueba sustituye el servicio de cron de Supabase y deja fuera la extensión que envía solicitudes de red.
