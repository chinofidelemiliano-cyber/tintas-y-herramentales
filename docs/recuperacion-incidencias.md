# Continuar incidencias sin perder el avance

Las fotos preparadas y los cambios se respaldan automáticamente en el navegador, separados por perfil. Los cambios de texto se sincronizan en línea después de una pausa breve; las fotos se intentan guardar inmediatamente. No necesitas completar «Elaborado por» para guardar el avance o la foto inicial: el nombre se pide al finalizar el reporte.

El estado bajo las fotos indica si el avance ya está en línea o sigue pendiente de sincronizar. Si falla la conexión o se rechaza un dato, el respaldo del dispositivo se conserva. Al volver a abrir la incidencia, se recuperan los datos pendientes y se intenta sincronizarlos. El respaldo pendiente solo se recupera en ese mismo navegador y perfil; los datos confirmados en línea se recuperan también desde otros dispositivos autorizados. No borres los datos del navegador mientras haya avances pendientes.

El botón de la barra fija **Continuar** abre la incidencia aunque estés en Inventario u otra sección o en otro mes. La barra y el título de la pestaña muestran el tiempo transcurrido. El inicio se conserva en el servidor; el tiempo se recalcula al volver a abrir la página o al reactivar el teléfono. Cerrar la página no finaliza la incidencia. La barra se muestra dentro del sitio; no es una ventana del sistema cuando el navegador está cerrado.

Si la foto final quedó pendiente, puedes continuar y pulsar Finalizar sin volver a tomarla. Solo al confirmar el cierre se detiene el tiempo y se descarga el PDF. La sincronización del avance no cierra la incidencia.

## Activación de la corrección de NP

Ejecuta completo `supabase/incident-recovery.sql` después de activar cuentas y permisos. En instalaciones nuevas ya está al final de setup.sql. Conserva fotos, folios e inicios existentes.

El NP se valida contra el encabezado de la orden y sus renglones de consumo. Una orden pendiente puede tener NP aunque todavía no tenga consumos; ese NP ahora es válido para iniciar y guardar la incidencia. Los NP de otras órdenes se siguen rechazando. Las fotos permanecen privadas y el guardado conserva los permisos del apartado de incidencias.
