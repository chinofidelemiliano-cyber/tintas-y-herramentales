# Producción y rebobinado por bobinas

**Órdenes para prensistas** tiene dos bloques: producción y rebobinado/empaque. El perfil conserva las hojas, los campos capturados y las fechas de finalización de cada bobina. Se puede filtrar por mes de la orden o buscar su folio, NP o producto.

Al finalizar preparación se genera una sola hoja por orden. Al abrir el apartado con la cuenta administradora también se recuperan las órdenes ya preparadas y los registros confirmados anteriores que no tenían hoja. Los formatos existentes conservan sus claves, campos y avances; no se vuelven a crear. Las órdenes pendientes de preparación y las canceladas no se importan. No se inventan avances de producción para registros históricos.

## Enlaces generales

El perfil ofrece **Copiar enlace general de prensistas** y **Copiar enlace general de rebobinado**. Se comparten una sola vez con cada área. No requieren registrar usuarios y muestran únicamente las hojas del perfil propietario. Producción recibe automáticamente las nuevas hojas; rebobinado recibe la orden al terminar su primera bobina. Las listas se actualizan cada 15 segundos y permiten abrir el detalle de la etapa y volver a la lista. Quien reciba un enlace general puede abrir y completar las hojas de esa etapa: compartirlo únicamente con el área correspondiente.

## Producción

El enlace del prensista muestra los datos de la orden, materiales, herramentales, colores y tiempos de prensa. El metraje se divide automáticamente en bobinas de hasta 1,500 m, conservando el sobrante exacto: 3,000 m son dos bobinas; 3,200.123456 m son 1,500 + 1,500 + 200.123456 m. Si un registro histórico no tiene metraje disponible, se indica que no se estimaron bobinas.

El prensista pulsa **Finalizar bobina** para registrar su fecha y hora. Las bobinas de producción se terminan en secuencia. Las asignaciones manuales de bobinas que ya estuvieran capturadas en la versión anterior se conservan.

## Rebobinado

En cuanto se termina la primera bobina, la orden aparece en el segundo bloque. Desde ahí se abre o copia su enlace independiente de rebobinado. La pantalla permite capturar etiquetas por rollo, centros, diámetros, vueltas, tiempos, etiquetas terminadas, empaque y resultados. Cada bobina debe haber terminado producción antes de finalizar su rebobinado. No hay que esperar a que se impriman las demás.

Los enlaces permiten guardar únicamente campos de su etapa. Los datos de producción y rebobinado se guardan juntos en el perfil sin sobrescribirse entre sí. La pantalla receptora y los dos bloques revisan los avances cada 15 segundos mientras están visibles; también existe **Actualizar**. Los cambios manuales pendientes no se reemplazan con una actualización automática. Los conflictos de edición se detectan por versión.

Cada etapa ofrece su propio PDF e impresión. El PDF de producción no incluye campos de rebobinado y el de rebobinado contiene el avance de sus bobinas. Los textos largos se conservan en anexos. Las horas respetan la configuración guardada.

Guardar las hojas o terminar bobinas **no descuenta inventario ni confirma consumos**. Eso sigue realizándose en el flujo de consumos existente. Las órdenes canceladas quedan de solo consulta.

Cada enlace contiene una clave exclusiva para esa hoja y etapa, sin abrir el inventario. Compártelo únicamente con las personas que trabajarán en ella.

## Activación en Supabase

- Si todavía no se activaron las hojas de prensista, ejecutar **`supabase/press-sheets.sql`** completo. Ya incluye el flujo de producción y rebobinado.
- Si ya estaban activadas las hojas anteriores, basta con **`supabase/production-rewinding.sql`**.
- No es necesario volver a ejecutar todo `supabase/setup.sql`; contiene ambas migraciones para instalaciones nuevas.

Después, recargar el sitio y abrir **Órdenes para prensistas** con la cuenta administradora para recuperar las órdenes anteriores. Las migraciones se pueden repetir sin regenerar claves ni perder campos o avances.

El servidor local crea las columnas automáticamente y recupera los registros al abrir el apartado. La validación local no ejecuta SQL en la cuenta remota: esa activación requiere acceso administrativo a Supabase.

## Actualización: producción interactiva

La capacidad por bobina ahora se indica en la captura (1,500 m queda como referencia para registros anteriores). Las órdenes finalizadas se ocultan del enlace de prensistas; se incorporan relojes por bobina, metros reales, justificaciones y paros relacionados con incidencias. Activación y acceso a la bitácora privada: [producción interactiva](produccion-interactiva.md), con `supabase/production-sessions.sql` como última migración.
