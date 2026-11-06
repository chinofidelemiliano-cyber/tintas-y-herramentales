# Historial por responsable y control de rebobinado

## Activación

Para una base que ya tiene los cuatro perfiles del personal, ejecutar **completo** `supabase/work-history-rewind.sql` en el SQL Editor de Supabase. Conserva órdenes, sesiones, asignaciones y existencias; se puede repetir. Para instalaciones que aún no tienen hojas para prensistas, `supabase/press-sheets.sql` incluye las migraciones acumuladas, incluida esta. No volver a ejecutar `setup.sql` sobre una base de trabajo solo para activar esta función.

Publicar los archivos del sitio y ejecutar SQL son pasos distintos. El repositorio no dispone de credenciales administrativas para aplicar la migración remotamente.

## Consulta e impresión

En el perfil principal aparece **Historial por responsable**. Comparte el permiso privado de **Tiempos de producción** (`production_audit`); no se publica en los enlaces del personal.

Seleccionar área (preparación, prensistas o rebobinado), responsable y día, semana o mes. La semana va de lunes a domingo. Las fechas se interpretan con la zona horaria configurada en el perfil. El historial se conserva al cambiar de mes; los filtros no eliminan registros.

- **PDF con todas las órdenes** crea un documento conjunto; cada orden comienza en una página nueva.
- **Imprimir juntas** abre ese documento en el visor del navegador para imprimirlo.
- **PDF separados (ZIP)** descarga un PDF por registro, con archivos de nombre único.
- Cada renglón permite descargar o imprimir únicamente esa orden.

El logo configurado en el perfil se coloca como encabezado de cada orden y se repite en las páginas adicionales. Los encabezados de producción y rebobinado mantienen sus campos propios. Los tiempos privados aparecen en los documentos del historial privado, no en el enlace público del personal.

Los registros anteriores sin cronómetro completo se identifican como históricos; no se inventan tiempos ni autores. Las preparaciones manuales nuevas guardan su responsable al crearse. Las anteriores sin autor permanecen separadas como “sin responsable verificado”.

## Captura y metas

La captura solicita **millares solicitados** y calcula las piezas correspondientes. Conserva metraje, metros por bobina, acabado, suaje/pleca, tiempos esperados y asignaciones. En **Órdenes para prensistas**, administración puede completar/corregir la meta de millares de una orden anterior antes de cerrar rebobinado. No se deduce una cantidad de etiquetas a partir de metros.

## Rebobinado

La primera bobina finalizada por prensa habilita la orden para la persona asignada. **Iniciar rebobinado / tomar orden** inicia el reloj de toda la producción. Este tiempo se registra para consulta privada. Cada rollo tiene botones **Iniciar rollo** y **Terminar rollo**, con reloj neto visible; los paros se excluyen de ambos tiempos. No se pregunta el metraje por rollo.

Las bobinas recibidas se marcan procesadas. La orden continúa disponible aunque todas estén procesadas, hasta que se cierre registrando los **millares reales de toda la orden**. Si son menores a los solicitados, la justificación es obligatoria. Deben estar terminadas y procesadas todas las bobinas; una producción positiva requiere al menos un rollo registrado. Al finalizar queda archivada y sale de las órdenes pendientes del responsable.

Los paros disponibles son baño, comida, otro y **En espera de otra bobina**. Esta última espera se conserva por separado y **no suma tiempo muerto**. Los intervalos coincidentes no se cuentan dos veces. En producción se agregan **Falta de material** y **Falta de insumos**. El registro privado permite consultar los motivos y tiempos por responsable.

## Incidencias y evidencia física

**Reportar incidencia · micrófono** intenta iniciar dictado en español desde el botón pulsado. Requiere HTTPS y permiso del navegador. Si el dispositivo no admite reconocimiento de voz o se niega el permiso, permite escribir el defecto; siempre se revisa/edita el texto antes de guardar. Se guarda la transcripción, no una grabación de audio; el proveedor de reconocimiento del navegador puede procesar la voz según sus propias condiciones.

Guardar la incidencia registra orden, máquina, responsable que la reporta y hora; pausa rebobinado y descarga un PDF con el defecto y espacios de antes/después para imprimir y pegar muestras físicas. **PDF para muestras** permite descargarlo otra vez. La corrección se registra desde la propia orden o el registro principal de incidencias. Cerrar la incidencia libera su paro; si hay otro paro abierto, este sigue vigente. Una incidencia propia de rebobinado no pausa por error la prensa que aún trabaja esa orden.

El administrador puede clasificar causa, impacto y responsable en el registro principal. La persona que reporta no se establece automáticamente como causante del defecto.

## Verificación

Las pruebas locales cubren cronómetros independientes, exclusión de paros, espera sin tiempo muerto, cierre por millares y justificación, separación de perfiles, historial privado, documentos conjuntos y ZIP. La migración se comprueba con un PostgreSQL embebido, incluyendo permisos e idempotencia. La interfaz se verifica en Chromium; el dictado de prueba es simulado y no acredita permisos ni disponibilidad del micrófono de un teléfono real.

## Captura completa y permisos del propietario

Actualización posterior: `supabase/capture-order-details.sql` exige para nuevas capturas millares, medidas de etiqueta en mm, fecha solicitada, prioridad inicial, categoría, scrap objetivo, material, empaque, etiquetas por rollo, diámetros y material del centro, posiciones/vueltas de salida, rollos por caja y tiempo esperado de rebobinado. Una fila por bobina asignada registra identificación, lote, ancho y metros disponibles, suficientes para su metraje programado. Los totales de piezas y cajas se calculan con esos datos. Los campos de texto que no correspondan admiten “No aplica”. Los identificadores de bobinas son captura manual; no descuentan inventario de materia prima.

La planeación pasa a las hojas y sus PDF como datos de solo lectura. Los operadores registran resultados, metros reales, millares finales, observaciones y firmas. Las órdenes anteriores conservan sus datos; no se inventan medidas o bobinas faltantes.

La prioridad visible se calcula al consultar o exportar, con la zona horaria configurada: Alta a tres días de la fecha solicitada, Urgente a un día (incluye el día solicitado) y Vencida al día siguiente. No reduce la prioridad inicial elegida. No requiere tareas programadas y no cambia el consecutivo de captura.

Desde **Órdenes para prensistas** se filtra por Julio, Manuel, Aurora o Lorena. La cuenta administradora puede consultar hojas de todos los perfiles. Los operadores conservan su restricción de área y asignación; no se divulgan contraseñas ni se simulan sus sesiones.

`supabase/owner-full-access.sql` concede permisos completos y administración únicamente a la cuenta existente y verificada `chinofidelemiliano@gmail.com`, ejecutado por el propietario del proyecto desde SQL Editor. No crea cuentas, no verifica correos por su cuenta ni ofrece una RPC para autoasignarse permisos. Después de ejecutarlo, cerrar sesión y volver a entrar.

Para evitar errores por copiar fragmentos o escapes Markdown, **Configuración → Activación de órdenes y acceso del propietario** enlaza `/activar-produccion.html`. Permite descargar `/activar-produccion.sql`, que reúne historial/rebobinado, captura completa y concesión de acceso del propietario. Generar el archivo con `node scripts/build-order-activation.mjs` cuando se modifique alguna de esas migraciones. Seleccionar todo el archivo descargado y ejecutarlo en una consulta nueva; `detail:=` es una instrucción interna de una función, no una consulta SQL independiente. No usar `setup.sql` para actualizar una base en producción.
