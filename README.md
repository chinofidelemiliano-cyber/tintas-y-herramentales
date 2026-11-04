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

`data/seed.json` conserva 88 filas extraídas del PDF proporcionado: 324,741 gramos netos y $97,813.18 MXN de valoración. Se carga una sola vez al crear la base de datos. La carga inicial es el saldo de apertura del piloto; las fechas históricas de entrada de los lotes no permiten reconstruir movimientos mensuales anteriores. Los días restantes se recalculan a la fecha actual usando la fecha de entrada más los días de vida útil del PDF.

Se conservan dos saldos negativos del documento original, pendientes de revisión: Rojo 200, lote AW0717L (−3,374 g), y Azul 291, lote 1462551 (−646 g). La extracción de códigos y fechas debe revisarse contra el archivo de origen antes de uso operativo.

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

Los PDF usan el nombre elegido, el idioma de encabezados y numeración y el formato de fecha; los nombres de productos y textos capturados se conservan. La moneda de operación sigue siendo MXN y no se aplica conversión monetaria. Las cantidades siguen controlándose en gramos, con garrafones estimados de 4 kg. No requiere una migración de Supabase.
