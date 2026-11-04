# Prisma · Tintas y herramentales

Piloto web para el inventario flexográfico de Identilabel México. Interfaz en español, cantidades de tinta en gramos, herramentales en piezas y costos en MXN.

## Ejecutar

Requiere Node.js 24 o posterior. No necesita dependencias externas ni instalación de paquetes.

```sh
cd /workspace/tintas-y-herramentales
npm start
```

El servidor escucha en el puerto 3000 (`PORT` permite cambiarlo). `npm run dev` reinicia el servidor al editar archivos. Los datos se guardan en `data/inventory.sqlite`; `DB_PATH` permite elegir otra base. Conserva ese archivo para conservar tu inventario. Los procesos deben iniciarse de nuevo al restaurar el entorno.

## Funcionalidad del piloto

- Inventario por producto y lote: búsquedas, filtros, estado de caducidad, detalle, exportación CSV y cantidades negativas históricas señaladas.
- Ingresos a lotes existentes, lotes nuevos o productos nuevos; alta automática en el catálogo y actualización de existencias en una transacción.
- Egresos con motivo, fecha y validación de existencia disponible.
- Catálogo de tintas y herramentales. Los herramentales inician vacíos porque el PDF contiene únicamente tintas y auxiliares.
- Captura manual de órdenes por mes y año, con varios lotes y gramos consumidos. Confirmar descuenta existencias; cancelar las devuelve una sola vez. El folio es único. La lista inicia en el mes actual de Ciudad de México.
- Resumen mensual y exportación CSV. El cierre definitivo se confirma después de terminar el mes, guarda una instantánea por lote y bloquea movimientos de períodos cerrados. No se permite fechar movimientos antes de la carga inicial ni en el futuro.

## Datos iniciales

`data/seed.json` conserva 88 filas extraídas del PDF proporcionado: 324,741 gramos netos y $97,813.18 MXN de valoración. Se carga una sola vez al crear la base de datos. La carga inicial es el saldo de apertura del piloto; las fechas históricas de entrada de los lotes no permiten reconstruir movimientos mensuales anteriores. Los días restantes se recalculan a la fecha actual usando la fecha de entrada más los días de vida útil del PDF.

Se conservan dos saldos negativos del documento original, pendientes de revisión: Rojo 200, lote AW0717L (−3,374 g), y Azul 291, lote 1462551 (−646 g). La extracción de códigos y fechas debe revisarse contra el archivo de origen antes de uso operativo.

Las tintas vencidas se identifican en las órdenes. Este piloto permite seleccionarlas; la planta debe decidir su política de autorización. Los ingresos al mismo lote conservan el costo original; usa otro lote para costos diferentes. No hay carga automática de archivos de órdenes ni edición de órdenes confirmadas: cancela y registra una nueva con otro folio.

## Catálogo y garrafones

`public/catalog.json` contiene los 75 productos del catálogo PDF posterior: código, nombre, tipo, proveedor, caducidad, máximo, punto de recompra y costo por kilo. Máximos y puntos de recompra se convierten de kilogramos a gramos para el control interno. Al iniciar el servidor, una migración idempotente importa el catálogo, crea 10 productos sin existencias y actualiza las fichas de los 65 códigos existentes. No agrega lotes ni modifica cantidades, costos históricos o fechas de entrada. La vista estática utiliza el mismo catálogo.

Los códigos se normalizan a mayúsculas. `UIAPP50EP021ID`, extraído originalmente unido a parte del nombre, se corrige a `APP50EP021ID` conforme al nuevo catálogo, conservando su lote y su saldo.

El inventario se muestra por **código → lotes → garrafones de 4 kg**. Cada lote positivo se reparte visualmente en cantidades de 4,000 g y un último sobrante (7,041 g → 4,000 + 3,041 g). Es una **distribución estimada, pendiente de verificación física**, aprobada por el usuario: no son identificadores persistentes de envases ni cantidades medidas individualmente. Al cambiar el saldo del lote, se recalcula el reparto. Los consumos siguen registrándose por lote. Los lotes vacíos no generan garrafones y los negativos conservan una alerta sin crear envases ficticios.

Los datos de catálogo sugieren la caducidad y el costo al registrar un nuevo lote. El costo histórico de un lote existente se conserva. El catálogo muestra productos sin stock; no se inventan existencias a partir de máximos o puntos de recompra.

## Validación

```sh
npm test
```

Las pruebas usan una base temporal y comprueban importación, altas, salidas, transacciones de órdenes, devolución por cancelación, protección contra folios duplicados, existencia insuficiente, fechas inválidas y cierre mensual. No alteran la base del piloto.

## Alcance

Aplicación piloto de un espacio de trabajo compartido, sin autenticación ni roles reales. No publicarla para uso operativo antes de incorporar usuarios, permisos, respaldos y revisión de datos. No se ha desplegado a un dominio público.

En las tareas del entorno en la nube, usa este checkout existente: cada tarea ya está aislada; no crees un worktree salvo solicitud explícita del usuario.

## Publicación de la interfaz en Netlify

`netlify.toml` indica que la carpeta pública es `public`, donde está `index.html`. En una importación desde GitHub, deja el directorio base en la raíz del repositorio, no configures un comando de compilación y usa `public` como directorio de publicación. Los archivos nuevos del piloto deben estar en la rama que Netlify despliega; guardarlos en el entorno local no los sube a GitHub.

Para una carga manual, publica la carpeta `public` con `index.html` directamente dentro. Esto publica únicamente los archivos de la interfaz. El servidor `server.mjs` y la base SQLite no se ejecutan con este despliegue estático: todavía se requiere adaptar la API y la persistencia antes de usar el inventario desde Netlify. La navegación utiliza fragmentos (`#inventario`, `#ordenes`), por lo que no requiere redirecciones de rutas.

Cuando el alojamiento estático no dispone de `/api/state`, la interfaz carga `public/preview-data.json` con las 88 filas del PDF y muestra un aviso de vista previa. Permite explorar pantallas y exportar datos; toda escritura se rechaza con una explicación. No utiliza almacenamiento local ni simula guardar órdenes. La carga inicial de esta vista se fecha al día de consulta y no representa historia real. Con el servidor Node activo se usa la base SQLite y se mantienen las operaciones normales.
