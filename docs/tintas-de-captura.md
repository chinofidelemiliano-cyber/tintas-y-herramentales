# Tintas de captura

En un proyecto existente, ejecuta completo `supabase/order-ink-options.sql` después de la migración de cuentas y permisos. En instalaciones nuevas está incluido al final de setup.sql. No cambia existencias ni genera movimientos al configurar opciones.

En tu perfil, abre **Configuración → Tintas para captura de órdenes**. Solo el administrador puede publicar opciones compartidas. Pulsa Agregar tinta personalizada, escribe el nombre y elige Base Agua o UV. Puedes relacionar una tinta del catálogo del mismo tipo, o dejar Color por preparar para generar una solicitud de preparación al capturar la orden. Guarda con **Guardar opciones de captura**; es una configuración compartida vinculada a la cuenta que la publica, separada del diseño privado de tus reportes.

En la página compartida, selecciona Tipo de tintas. Los desplegables muestran las tintas del catálogo de ese tipo y las opciones personalizadas publicadas. Cambiar Base Agua / UV limpia las posiciones para no mezclar tecnologías por accidente. Cada orden conserva su tipo en las especificaciones. Una opción relacionada conserva el producto y su disponibilidad real; una opción por preparar solicita el color mediante el flujo de Pantone existente, con el tipo incluido en su nombre. Al preparar se conservan los egresos de ingredientes y el ingreso de mezcla actuales.

Actualizar catálogos carga las últimas opciones; la página también las revisa periódicamente. Cambiar una opción no reescribe órdenes anteriores. El servidor comprueba el tipo y la relación con el catálogo; no basta con modificar un desplegable del navegador.
