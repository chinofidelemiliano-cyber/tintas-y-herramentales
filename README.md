# Prisma · Tintas y herramentales

Piloto web para el inventario flexográfico de planta. Interfaz en español, cantidades de tinta en gramos, herramentales en piezas y costos en MXN.

## Ejecutar

Requiere Node.js 24 o posterior. No necesita dependencias externas ni instalación de paquetes.

```sh
cd /workspace/tintas-y-herramentales
npm start
```

El servidor escucha en el puerto 3000 (`PORT` permite cambiarlo). `npm run dev` reinicia el servidor al editar archivos. Los datos se guardan en `data/inventory.sqlite`; `DB_PATH` permite elegir otra base. Conserva ese archivo para conservar tu inventario. Los procesos deben iniciarse de nuevo al restaurar el entorno.

## Funcionalidad del piloto

- Inventario por producto y lote: búsquedas, filtros, estado de caducidad, detalle, exportación PDF y cantidades negativas históricas señaladas.
- Ingresos a lotes existentes, lotes nuevos o productos nuevos; alta automática en el catálogo y actualización de existencias en una transacción.
- Egresos con motivo, fecha y validación de existencia disponible.
- Catálogo de tintas y herramentales. Los herramentales inician vacíos porque el PDF contiene únicamente tintas y auxiliares.
- Captura manual de órdenes por mes y año, con varios lotes y gramos consumidos. Confirmar descuenta existencias; cancelar las devuelve una sola vez. Un folio puede tener registros en distintas fechas o NP; se rechazan duplicados de orden, fecha y NP. La lista inicia en el mes actual de Ciudad de México.
- Resumen mensual y exportación PDF. El cierre definitivo se confirma después de terminar el mes, guarda una instantánea por lote y bloquea movimientos de períodos cerrados. No se permite fechar movimientos antes de la carga inicial ni en el futuro.

## Bitácora de producción por pesaje

El formato sigue el PDF de órdenes compartido por el usuario: orden, NP por renglón, fecha, prensista, tinta, lote, ingreso, egreso, gramos totales, metros, notas y producto. En esta hoja, **ingreso es el peso inicial y egreso el peso final o devuelto**; el consumo se calcula como inicial menos final (3,278 − 3,186 = 92 g). No se registran dos movimientos de inventario: al confirmar solo se descuenta la diferencia del lote.

Los registros con peso final faltante pueden guardarse pendientes, sin modificar existencias; se completan y confirman después. Confirmar una segunda vez se rechaza. El peso final no puede superar al inicial; los ajustes o devoluciones se registran por separado. Cancelar un confirmado devuelve solo el consumo descontado, una única vez. Antes de cerrar un mes deben completarse o cancelarse sus registros pendientes.

Se conservan las órdenes y consumos anteriores, aunque no tuvieran pesos o NP. La migración no inventa pesos ni repite descuentos. Los registros del PDF de referencia no se importaron como movimientos históricos, para evitar descontar otra vez datos que pueden estar reflejados en el inventario inicial. La exportación de producción utiliza las mismas columnas de la bitácora.

## Datos iniciales

`data/seed.json` conserva 88 filas extraídas del PDF proporcionado: 342,813 gramos netos y $101,316.83 MXN de valoración. Se carga una sola vez al crear la base de datos. La carga inicial es el saldo de apertura del piloto; las fechas históricas de entrada de los lotes no permiten reconstruir movimientos mensuales anteriores. Los días restantes se recalculan a la fecha actual usando la fecha de entrada más los días de vida útil del PDF.

El PDF correcto `invee.pdf` reemplaza los saldos anteriores: actualiza 6 lotes y elimina los saldos negativos iniciales. El usuario autorizó usar las existencias actuales exactas del documento, registrando ajustes y conservando el historial.

Las tintas vencidas se identifican en las órdenes. Este piloto permite seleccionarlas; la planta debe decidir su política de autorización. Los ingresos al mismo lote conservan el costo original; usa otro lote para costos diferentes. No hay carga automática de archivos de órdenes ni edición de órdenes confirmadas: cancela y registra nuevamente el trabajo.

## Catálogo y garrafones

`public/catalog.json` contiene los 75 productos del catálogo PDF posterior: código, nombre, tipo, proveedor, caducidad, máximo, punto de recompra y costo por kilo. Máximos y puntos de recompra se convierten de kilogramos a gramos para el control interno. Al iniciar el servidor, una migración idempotente importa el catálogo, crea 10 productos sin existencias y actualiza las fichas de los 65 códigos existentes. No agrega lotes ni modifica cantidades, costos históricos o fechas de entrada. La vista estática utiliza el mismo catálogo.

Los códigos se normalizan a mayúsculas. `UIAPP50EP021ID`, extraído originalmente unido a parte del nombre, se corrige a `APP50EP021ID` conforme al nuevo catálogo, conservando su lote y su saldo.

El inventario se muestra por **proveedor → código → lotes → garrafones de 4 kg**. Cada lote positivo se reparte visualmente en cantidades de 4,000 g y un último sobrante (7,041 g → 4,000 + 3,041 g). Es una **distribución estimada, pendiente de verificación física**, aprobada por el usuario: no son identificadores persistentes de envases ni cantidades medidas individualmente. Al cambiar el saldo del lote, se recalcula el reparto. Los consumos siguen registrándose por lote. Los lotes vacíos no generan garrafones y los negativos conservan una alerta sin crear envases ficticios.

El inventario muestra los 88 lotes actuales sin paginación ni límite por página. Cada proveedor tiene una lista desplegable que conserva los grupos por código y los lotes por separado. Los controles «Expandir todo» y «Contraer todo» cambian la apertura de las listas. Los filtros siguen limitando los resultados cuando el usuario los aplica.

Las exportaciones de inventario, ingresos y egresos, catálogo, órdenes y cortes se descargan directamente como PDF A4 horizontal, con encabezados repetidos y número de página. Incluyen todos los registros que cumplen los filtros activos, aunque las listas estén contraídas o la tabla de otra sección tenga paginación. Los reportes conservan la indicación de vista previa cuando no hay API y marcan el reparto de garrafones como estimado. La generación se hace en el navegador sin dependencias ni servicios externos. El PDF del corte mensual añade dos apartados con el detalle de ingresos y egresos del mes seleccionado: fecha, tinta, código, lote, cantidad, unidad, valor y motivo u orden de producción. Usa los mismos lotes y filtros del resumen, incluye devoluciones y consumos de producción y excluye la carga inicial de los movimientos del mes. Cada apartado muestra sus totales y avisa si no hubo movimientos.

Los datos de catálogo sugieren la caducidad y el costo al registrar un nuevo lote. El costo histórico de un lote existente se conserva. El catálogo muestra productos sin stock; no se inventan existencias a partir de máximos o puntos de recompra.

## Validación

```sh
npm test
```

Las pruebas usan una base temporal y comprueban importación, altas, salidas, transacciones de órdenes, devolución por cancelación, protección contra registros duplicados, existencia insuficiente, fechas inválidas y cierre mensual. No alteran la base del piloto.

## Alcance

El servidor local es un piloto de un espacio compartido sin inicio de sesión. La versión hospedada ya incluye el conector de Supabase y acceso con cuentas autorizadas, pero requiere ejecutar la configuración SQL y crear usuarios en el panel. Sigue siendo necesario revisar los datos y configurar respaldos antes de uso operativo. Consulta `supabase/README.md` para activar la conexión.

En las tareas del entorno en la nube, usa este checkout existente: cada tarea ya está aislada; no crees un worktree salvo solicitud explícita del usuario.

## Publicación de la interfaz en Netlify

`netlify.toml` indica que la carpeta pública es `public`, donde está `index.html`. En una importación desde GitHub, deja el directorio base en la raíz del repositorio, no configures un comando de compilación y usa `public` como directorio de publicación. Los archivos nuevos del piloto deben estar en la rama que Netlify despliega; guardarlos en el entorno local no los sube a GitHub.

Para una carga manual, publica la carpeta `public` con `index.html` directamente dentro. Esto publica únicamente los archivos de la interfaz. El servidor `server.mjs` y la base SQLite no se ejecutan con este despliegue estático. En el sitio hospedado, `cloud-client.js` usa Supabase Auth y funciones PostgreSQL para la persistencia; actívalas con los pasos de `supabase/README.md`. La navegación utiliza fragmentos (`#inventario`, `#ordenes`), por lo que no requiere redirecciones de rutas.

En localhost, cuando el alojamiento estático no dispone de `/api/state`, la interfaz carga `public/preview-data.json` con las 88 filas del PDF y muestra un aviso de vista previa. Permite explorar pantallas y exportar datos; toda escritura se rechaza con una explicación. No utiliza almacenamiento local ni simula guardar órdenes. La carga inicial de esta vista se fecha al día de consulta y no representa historia real. Con el servidor Node activo se usa la base SQLite y se mantienen las operaciones normales.

## Conexión a Supabase

`public/cloud-config.json` configura la URL y la clave publishable facilitadas por el usuario. No contiene claves secretas ni service_role. En el sitio hospedado se requiere iniciar sesión; `supabase/setup.sql` crea una base protegida, importa el inventario y ofrece las operaciones transaccionales del piloto. `supabase/authorize-user.sql` autoriza explícitamente a cada usuario creado en Authentication. Preparar estos archivos no los ejecuta en la cuenta de Supabase. Consulta `supabase/README.md` para la activación y las verificaciones.

Validación PostgreSQL opcional, sin instalar dependencias en el proyecto:

```sh
npm install --prefix /tmp/prisma-pg-validation @electric-sql/pglite --no-save --package-lock=false
PRISMA_PGLITE_MODULE=/tmp/prisma-pg-validation/node_modules/@electric-sql/pglite/dist/index.js node scripts/validate-supabase.mjs
```

Este script usa una base PostgreSQL temporal: comprueba importación, miembros autorizados, permisos de tablas, pesajes, descuentos, cancelación única, pendientes, cierres e importación idempotente. No se conecta al proyecto real.

## Tiempos de preparación

La sección «Tiempos de preparación» registra fecha, orden, NP, inicio, fin, duración en minutos, fecha y hora solicitadas, insumos/herramental, producto y observaciones. Calcula los minutos automáticamente; si cruza medianoche debe indicarse explícitamente «Termina al día siguiente». Permite editar y exportar todos los resultados del mes y filtros a PDF. No afecta las existencias ni genera movimientos.

SQLite crea la tabla al arrancar. Para una base Supabase ya instalada, ejecuta **supabase/preparation-times.sql** en SQL Editor; la instalación inicial actualizada **supabase/setup.sql** ya incluye esta sección. Ambos archivos conservan las existencias. La actualización verifica que la instalación base exista antes de continuar.

## Configuración de página

La sección «Configuración» permite cambiar el nombre mostrado del sitio, idioma de interfaz (español o inglés), tema claro/oscuro/automático, color principal, formato de fechas, densidad y apertura inicial de las listas de inventario. Los ajustes se conservan en localStorage **solo en ese navegador**; no cambian el inventario ni los ajustes de otros usuarios. Incluye restablecimiento de valores y selector de idioma en el acceso. El formato de fechas solo modifica la presentación, no las fechas almacenadas ni los períodos de cierre.

Los PDF usan el logo elegido, el idioma de encabezados y numeración y el formato de fecha; los nombres de productos y textos capturados se conservan. La moneda de operación sigue siendo MXN y no se aplica conversión monetaria. Las cantidades siguen controlándose en gramos, con garrafones estimados de 4 kg. No requiere una migración de Supabase.

## Incidencias y reporte individual

La sección «Incidencias» sigue el registro proporcionado: folio, fecha, ODP/NP, máquina, incidencia, responsable, acción realizada, impacto y estatus. Las máquinas son Mark Andy, Comco 1, Comco 2 y Maquina China; responsables: Diseño, Producción, Preprensa, Proveedor, Mantenimiento o Compartida. El formulario consulta las órdenes y NP ya registrados, sin inventar referencias.

La primera incidencia nueva recibe **INC-0011** y continúa en orden. El servidor asigna el folio dentro de la transacción; las ediciones lo conservan y el identificador de solicitud evita duplicados por reintento. No se importaron como registros los folios anteriores de la imagen. Las incidencias no cambian existencias ni generan consumos. Para cerrar se requiere una acción realizada.

Los registros manuales anteriores conservan su funcionamiento. En el flujo con cronómetro, guardar la foto final descarga automáticamente un PDF individual, que también puede descargarse desde la fila de la incidencia. La primera hoja es un formato A4 vertical para registro comparativo: datos generales, espacios en blanco para pegar muestras físicas ANTES/DESPUÉS, color observado, resultado de prueba, observaciones y firmas de Preprensa, Calidad y Encargado de producción. Las hojas siguientes conservan la descripción, las acciones y los demás datos completos, sin recortar textos largos. Las incidencias con cronómetro incluyen las fotografías reales en los espacios ANTES/DESPUÉS. Las firmas permanecen como espacios para validación manual; no son firmas digitales. El registro completo del mes también se exporta a PDF respetando los filtros.

Para una base Supabase existente, ejecuta **supabase/incidents.sql** completo en SQL Editor; no borra registros ni reinicia folios. La instalación inicial setup.sql actualizada ya lo incluye. La función de guardado valida membresía, orden/NP y opciones, y serializa escrituras para asignar folios sin duplicados.

## Inventario correcto y captura automática con fotos

`data/inventory-corrected.json`, `data/seed.json` y la vista previa utilizan el PDF correcto `invee.pdf`: 88 lotes, 342,813 g y $101,316.83 MXN. La actualización inicial de una base existente lleva los lotes incluidos al saldo exacto del documento, conserva sus movimientos y añade ajustes de entrada/salida por las diferencias. No borra lotes adicionales. Se aplica una sola vez con la marca `inventory_pdf_corrected_v1`; repetir el script no sobrescribe movimientos posteriores. La carga de nuevas bases usa ya los valores correctos.

En una incidencia nueva, seleccionar una orden únicamente prepara la captura. El botón «Iniciar incidencia» crea y guarda el cronómetro y el folio en el servidor; seleccionar o cambiar la orden antes de pulsarlo no inicia el tiempo ni crea registros. La foto del defecto se convierte a JPEG, se reduce y guarda al seleccionarla. El reloj sobrevive al cierre de la ventana y a las recargas. Seleccionar la foto final guarda el cierre con hora del servidor y genera el PDF con ambas fotografías y la duración. La medición termina al guardar la foto final, incluyendo su captura y envío. Las clasificaciones no disponibles en la orden no se inventan: quedan pendientes y pueden completarse después.

Las fotos se almacenan en las tablas protegidas de la incidencia; no se suben a un bucket público ni se guardan en el repositorio. Las respuestas de estado contienen indicadores de presencia, sin las imágenes completas. Las fotos se recuperan con una función autenticada al reanudar o descargar un reporte. Solo se aceptan JPEG de hasta 450,000 caracteres en data URL; el navegador reduce imágenes a un máximo de 1,200 píxeles y elimina metadatos mediante conversión en canvas. Las incidencias manuales previas siguen disponibles y no requieren fotos retroactivamente.

Para actualizar Supabase en un solo paso, ejecuta **supabase/update-inventory-and-incidents.sql** completo. Requiere la instalación base. Actualiza los saldos una vez y añade el cronómetro, las fotos privadas y sus funciones de acceso. `supabase/incidents-timer.sql` actualiza solo el flujo de incidencias; `supabase/update-inventory.sql` actualiza solo el inventario.

## Logo en los PDF

En **Configuración → Logo de reportes** se puede seleccionar un archivo PNG o JPG y guardar la configuración. El navegador prepara una copia JPEG para impresión y guarda el logo en las preferencias locales. Se conserva al recargar y se incluye centrado, sin deformar su proporción, arriba de cada página de todas las exportaciones tabulares y reportes individuales de incidencias. El formato de incidencias reserva espacio para el logo, las fotos y las firmas sin superponerlos. Se puede quitar o reemplazar desde la misma sección.

El logo se configura por navegador, como el nombre y el idioma: no se sincroniza con otras cuentas o dispositivos. No necesita SQL ni cambios de Supabase. Si una imagen solo está visible en el chat y no se dispone de su archivo, puede guardarse desde el dispositivo y cargarse directamente en esta sección. No se recrea ni se sustituye el logo por una imagen generada.

## Personalización del diseño de PDF

En **Configuración → Diseño de PDF** se ajustan el ancho máximo del logo en milímetros, alineación, separación, márgenes, fuente estándar (Helvetica, Times o Courier), tamaños de texto y título, colores de títulos/texto/encabezado/bordes/filas, espaciado y filas alternadas. El logo siempre conserva su proporción y se limita al espacio disponible. Un logo grande reduce el área de las fotos en el formato vertical de incidencias.

El nombre del sitio no se imprime en ningún PDF. Por defecto las exportaciones muestran logo, título, datos y totales, sin subtítulos de marca, fecha de emisión o notas explicativas. Se pueden activar notas, fecha, título, totales y paginación individualmente. La opción «Solo logo, título y datos» restaura ese contenido mínimo. Los reportes individuales conservan sus campos, evidencia y firmas.

La vista previa responde a los controles antes de guardar; «Descargar PDF de prueba» genera un archivo real con el diseño en edición y datos identificados como ejemplos. «Restablecer diseño PDF» no elimina el logo ni modifica otras preferencias. Los ajustes se guardan por navegador, se aplican a todas las exportaciones y no requieren SQL.

## Inicio manual y reporte de incidencias en dos páginas

El cronómetro comienza únicamente con **Iniciar incidencia**, después de elegir la orden. Los cronómetros ya iniciados conservan su hora original al reanudarlos. Este cambio de interfaz no necesita SQL.

El PDF individual tiene dos páginas: evidencia/comparación/firmas y detalle completo. La segunda hoja utiliza una tabla compacta; para textos extensos adapta la distribución a dos columnas y reduce la letra si hace falta. No genera una tercera hoja ni descarta campos. Si un texto excepcional no cabe ni en el formato más compacto, informa el límite y solicita resumirlo en vez de truncarlo silenciosamente.

### Configuración de perfil sincronizada

Para una base existente, ejecutar **todo** `supabase/profile-preferences.sql` en SQL Editor (no modifica inventario ni usuarios). `setup.sql` ya lo incluye para instalaciones nuevas. Idioma, apariencia, nombre, fechas, logo y diseño PDF se guardan por `auth.uid()`; las tablas no tienen acceso directo y las funciones verifican membresía. Al entrar se recupera el perfil remoto. Si aún no existe, se importan los ajustes anteriores del navegador solo al primer perfil usado en ese dispositivo. La carga inicial no sobrescribe un perfil creado simultáneamente en otro dispositivo. Guardar/restablecer requiere confirmación del servidor y muestra el error si falla. La última configuración guardada prevalece; otros dispositivos la recuperan al iniciar sesión o recargar. Sin conexión de nube se mantiene el modo local anterior.

### Cronómetro de producción e importación desde Teams

Para bases existentes ejecutar completo `supabase/production-tracking-teams.sql`. Agrega fechas reales de inicio/fin, metadatos de orden y conexión limitada a un chat de Teams. Iniciar/finalizar es idempotente y no afecta stock. Cancelar detiene un cronómetro activo; conserva sus marcas. PDF de órdenes incluye una sección de seguimiento, también para órdenes sin tintas. Fechas reales se muestran en America/Mexico_City; la programación recibida se conserva separada.

La función Netlify `teams-orders` recibe POST `/api/teams-orders` desde Power Automate con encabezado `X-Integration-Key` y JSON `{conversation_id,message_id,html}`. Solo usa la configuración pública de Supabase y una RPC limitada a recepción. La clave aleatoria se genera al autorizar un chat; solo su hash queda guardado, nunca se añade a los archivos públicos. RPC no permite listar inventario. Tablas privadas con RLS, acceso únicamente por funciones; recepción sin cuenta exige clave vigente + chat exacto. Nuevos mensajes crean órdenes draft con cero renglones / movimientos. El mismo mensaje se procesa una vez, sin reescribir ediciones posteriores. No se requiere service_role. Instrucciones para el propietario del tenant en `public/teams-setup.html`; **el flujo de Microsoft requiere configuración externa, cuenta/licencias compatibles y no se activa al desplegar este repositorio**. Imágenes o adjuntos no se leen mediante OCR.

Desarrollo local soporta las mismas rutas de cronómetro y conexión con SQLite para pruebas; no es un servidor autenticado para publicar directamente. Netlify ejecuta la función de recepción; el frontend sigue usando Supabase autenticado.

### Página compartida de captura manual

Para una base existente ejecutar completo `supabase/manual-order-portal.sql`. Es independiente de Teams y agrega también las columnas de seguimiento y el cronómetro si no se habían activado. En Órdenes → **Página de captura** se genera un enlace `/solicitar-orden.html#key=...` para compartir con el equipo. No requiere cuentas adicionales. El enlace permite capturar y ver solo la cola compartida (datos de programación), no consultar existencias ni iniciar/finalizar/cancelar órdenes. Generar otro enlace invalida el anterior; desactivarlo conserva órdenes y secuencias. Solo se guarda el hash de la clave. El fragmento no se envía en las solicitudes de la página y la página no usa recursos externos, con política de referencia no-referrer.

La cola asigna un consecutivo global al confirmar cada envío dentro de la misma transacción que crea la orden draft. Reintentos con UUID de captura no duplican; se rechaza un segundo registro de la misma orden/NP/fecha. Lectura en secuencia ascendente, paginación estable de 50 entradas y botón para cargar siguientes; finalizadas/canceladas se pueden incluir sin renumerar. Fecha/hora programada, prensista, máquina, colores/Pantone y cantidades se conservan. No se descuentan existencias ni se inicia tiempo automáticamente. La captura mantiene el prensista, máquina y fecha para agilizar el siguiente registro, y guarda borradores solo durante la sesión del navegador. Las listas se actualizan cada 30 segundos. El inventario conserva su acceso autenticado. `setup.sql` ya incluye la actualización para instalaciones nuevas.

### Colores, Pantone y flujo de preparación

Activar con **todo** `supabase/colors-preparation.sql` (incluye las dependencias de la página compartida; no requiere Teams). La página ofrece seis posiciones para Comco 1/2 y hasta doce configurables para otras máquinas. Las opciones proceden de todo el catálogo de tintas y muestran si existe algún lote con saldo positivo; no publica cantidades, costos ni lotes. La disponibilidad se actualiza cada 30 segundos. Se conservan capturas anteriores de texto libre. Las nuevas capturas guardan las posiciones y la selección Pantone crea una solicitud por posición, sin movimientos de inventario.

Tiempos de preparación contiene **Por preparar**, **Órdenes preparadas**, **Solicitudes de Pantone** y los registros manuales anteriores. Iniciar/finalizar conserva los timestamps persistentes de las órdenes; finalizar requiere atender sus Pantones pendientes. La orden permanece en el historial preparado al confirmar sus consumos. Producción muestra consumos pendientes de órdenes preparadas (y borradores históricos con renglones), más el archivo confirmado/cancelado. Confirmar consumo cierra el registro de producción; no elimina el historial de tiempos. El PDF de preparación incluye inicio, fin y duración reales; los registros manuales se conservan por separado.

Completar Pantone pide kilos obtenidos e ingredientes por lote, expresados en kg. Agrupa lotes repetidos, valida existencias y masa obtenida <= masa utilizada (permite merma), guarda receta/costos y crea egresos más ingreso de una tinta `MIX-PANTONE-{solicitud}`, lote independiente, en una transacción. Reintentar una solicitud ya preparada no repite movimientos. Su costo unitario deriva del costo de ingredientes / kg obtenidos; vida útil inicial 365 días. Las recetas quedan vinculadas a la solicitud y orden, pero sus movimientos no se consideran consumos de producción reembolsables: cancelar una orden no devuelve ingredientes ya transformados ni elimina la mezcla. No se ejecutan mezclas para órdenes canceladas.

### Cantidades en gramos y selección de herramentales

Ejecutar completo `supabase/grams-and-tools.sql` para actualizar una base existente. Recetas y cantidades de tinta se capturan/muestran en gramos; la API conserva compatibilidad con capturas anteriores en kilos. Los valores históricos ya estaban almacenados en gramos y no se reconvierten. Las nuevas recetas y diferencias de pesaje no se recortan a tres decimales. El formato muestra la representación decimal guardada, incluidas fracciones pequeñas; sumas/diferencias locales usan aritmética decimal para evitar artefactos binarios. Esto no reconstruye precisión que ya se hubiera perdido en registros anteriores. Los costos del catálogo conservan su base MXN/kg.

La captura agrega selectores independientes de Suaje y Pleca. Se alimentan de productos herramental clasificados por `tool_type` (`suaje` / `pleca`) o por su `kind` equivalente y guardan ID y descripción en la orden; no descuentan ni reservan piezas. Sin catálogo cargado, muestran que está pendiente y no inventan referencias. Los PDF de herramentales pendientes deben importarse/clasificarse para poblar las listas.

### Inventario de herramentales del PDF

Carga de 154 IDs / piezas: **112 SJ (suajes), 35 PD (plecas), 7 CMC (cuchillas)**. Activar ejecutando completo `supabase/import-tooling-inventory.sql` (incluye dependencias, no requiere volver a ejecutar setup). Se conservan las fichas técnicas originales en `tooling_details`. Un marcador evita duplicados y protege ajustes posteriores; no se modifican saldos de tinta ni lotes existentes. Los selectores y la validación del servidor usan estrictamente prefijos SJ / PD. Los CMC solo se muestran en inventario general. Trece costos MXN faltantes/erróneos se marcan como no registrados, sin convertir precios USD ni estimar valores. Ver `docs/tooling-import.md`.

### Dispositivos y notificaciones push de órdenes

La sección **Administrar dispositivos** registra hasta 20 equipos por perfil, permiso de navegador por dispositivo, nombre, origen, prueba, desactivación y eliminación. Funciona con Cloudflare Pages sin servidor propio. No guarda tokens de sesión en el service worker ni cachea formularios. La casilla solo queda activa tras permiso + suscripción + confirmación de guardado. Al cambiar cuenta/cerrar sesión se detiene la entrega local y al cerrar sesión se revoca la suscripción. En iPhone/iPad requiere iOS/iPadOS 16.4+ e instalación en pantalla de inicio.

**Activación externa requerida:** ejecutar completo `supabase/device-notifications.sql`; crear/desplegar la Edge Function `push-notifications` con el contenido completo de `supabase/functions/push-notifications/index.ts` y desactivar **Verify JWT** para esa función (también definido en `supabase/config.toml`). La propia función autentica las operaciones de perfil mediante Supabase Auth + membresía y el webhook con una clave privada generada. Las claves VAPID se generan una sola vez y quedan en tabla privada, nunca en el repositorio/navegador. Se usan únicamente las variables integradas SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY del runtime; no hay secretos nuevos que pegar en archivos públicos. La página `/notificaciones-ayuda.html` explica los pasos del panel.

SQL crea cola persistente y trigger de inserción de órdenes (también capturas anónimas autorizadas del formulario), un evento por orden/dispositivo, sin notificar el historial anterior ni reintentos de alta que no insertan otra fila. pg_net despierta el despachador después del commit y pg_cron reintenta cada minuto. El fallo de red no bloquea la orden. Claim con lease/SKIP LOCKED evita doble procesamiento concurrente; máximo cinco intentos, backoff, rechazo de ACK antiguo y desactivación de endpoints 404/410. Los endpoints se limitan a proveedores Web Push conocidos. La firma VAPID/cifrado aes128gcm usa web-push 3.6.7 y el envío HTTPS usa fetch con redirecciones desactivadas. El service worker deduplica eventos por dispositivo y abre únicamente una ruta de su propio origen. La lista de dispositivos nunca publica endpoints, claves de suscripción, claves privadas ni equipos de otros perfiles.

El núcleo probado está en `_shared/push-core.mjs`; `npm run build:push` genera el index.ts de un solo archivo para facilitar el despliegue por el editor de Supabase. Cometer ambos archivos al editarlo. No se envían notificaciones reales en las pruebas automáticas: usan proveedores simulados y verifican cifrado/firmas aparte. La aceptación por el proveedor no prueba que el sistema operativo haya mostrado/leído el aviso; comprobarlo con **Probar aviso** en un dispositivo real tras activar el servicio. Cualquier cambio de dominio requiere registrar el dispositivo en la dirección nueva. El desarrollo SQLite local muestra la pantalla pero no registra equipos: el envío real requiere sesión y la configuración de Supabase indicada.

## Cuentas y seguridad

Inicio de sesión para cuentas creadas por el administrador, autorización de permisos y registro de inicios de sesión. Para activar el acceso en Supabase y el envío desde Gmail sigue [cuentas y correo](docs/cuentas-y-correo.md). La actualización para proyectos existentes es `supabase/accounts-and-sessions.sql`; el SMTP se configura únicamente en Supabase.
