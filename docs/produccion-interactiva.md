# Producción interactiva y bitácora privada

## Activación

En una instalación con hojas y rebobinado ya activos, ejecutar **`supabase/production-sessions.sql` completo**. Conserva existencias, consumos, hojas, enlaces y avances. Después recargar la captura compartida y las páginas de prensistas.

Si todavía no se activaron las hojas, `supabase/press-sheets.sql` contiene las migraciones acumuladas. No volver a ejecutar todo `setup.sql` en una cuenta existente. Las migraciones antiguas de cuentas u hojas pueden reemplazar funciones; en ese caso aplicar de nuevo `production-sessions.sql` al final. La migración es repetible, sin borrar relojes ni paros.

## Captura y planeación

Las nuevas órdenes requieren metraje total, metros por bobina, tiempo esperado por bobina y por producción (minutos), acabado (incluido «Sin acabado»), suaje y la decisión explícita de si lleva pleca. Si lleva pleca, su código es obligatorio. Las medidas opcionales se capturan en **milímetros**. Los tipos de tinta y sus selecciones existentes se conservan.

El formato del prensista carga automáticamente esos datos. El metraje se divide por la capacidad capturada, conservando el sobrante: 1,700.123456 m con bobinas de 800 m produce 800 + 800 + 100.123456 m. Los registros anteriores conservan su planeación conocida; no se inventan tiempos esperados ni medidas faltantes. Las hojas que ya tenían avance no se vuelven a dividir.

## Trabajo del prensista

El enlace general solo muestra órdenes pendientes: excluye las canceladas, las cerradas por consumos y las que ya terminaron todas sus bobinas. El perfil conserva el historial. El rebobinado pendiente puede continuar aunque se hayan confirmado los consumos. Si una producción aún abierta se cancela o se cierra por consumos, su reloj general y sus paros se cierran en ese momento; la bitácora conserva el motivo y no inventa metros de bobinas pendientes.

1. **Iniciar producción** registra el inicio general en servidor. El reloj general no se muestra al prensista.
2. **Iniciar bobina** inicia su reloj visible. Al finalizar registra **metros corridos** y, si son inferiores a los programados, una justificación obligatoria (también si produjo cero metros).
3. **Finalizar bobina** guarda inicio, fin, metros, justificación y tiempo neto. La siguiente bobina comienza con su propio reloj en cero. Completar la primera habilita rebobinado.
4. Al terminar todas las bobinas se registra el fin de producción. La orden desaparece de la lista del prensista y queda archivada.

Los relojes se calculan con fechas del servidor y siguen existiendo al cerrar el navegador. Los metros pendientes de finalizar se respaldan en ese navegador; se registran en la base al finalizar la bobina. Las observaciones se guardan con su botón. El PDF público solo incluye planeación, bobinas, metraje, tiempo por bobina y observaciones; no contiene el historial privado de paros.

## Paros e incidencias

**Registrar paro** permite seleccionar baño, comida u otro motivo; «Otro» requiere detalle. **Reanudar producción** cierra ese paro. Se excluye su duración del tiempo neto general y del reloj de la bobina en curso.

Una incidencia con **la misma orden, la misma máquina, impacto «Paro» e inicio registrado** pausa automáticamente la producción activa y conserva la referencia de su folio. Se reanuda al finalizar la incidencia con su flujo habitual de fotos. Una incidencia de otra orden/máquina o con otro impacto no detiene esta producción. Si una clasificación se corrige y deja de corresponder, se cierra el intervalo vinculado, conservando el registro.

Un paro manual y una incidencia pueden coincidir: el tiempo neto une los intervalos y no descuenta dos veces el mismo segundo. Cerrar un paro manual no cierra una incidencia activa. La página consulta los cambios cada 15 segundos y al realizar una acción; puede usarse **Actualizar**. Las fechas registradas se calculan en servidor aunque la pantalla tarde en refrescarse.

## Bitácora restringida

El apartado **Bitácora privada de producción** está disponible para el administrador. Para autorizar a otra cuenta, abrir **Cuentas y seguridad**, marcar **Bitácora privada de producción y paros** y guardar permisos. No se concede a los usuarios existentes por defecto, ni se incluye dentro del permiso general de producción.

La bitácora permite filtrar día y nombre capturado, consultar inicio/fin general, tiempos brutos y netos, metros y tiempos por bobina, justificaciones, paros y folios de incidencia. Incluye un PDF privado con el logo y diseño configurados. No se muestra el historial de baño/comida en el enlace del prensista ni en los enlaces generales. Las funciones auxiliares y las tablas están revocadas para acceso directo.

Las referencias proporcionadas son aproximadamente **3 visitas al baño de 10 minutos** y **45 minutos de comida por día**. Se muestran como contexto; no generan sanciones, descuentos ni límites automáticos. Los resúmenes diarios respetan la zona horaria configurada y recortan los intervalos que cruzan medianoche. El conteo de visitas corresponde al día de inicio del paro. Las categorías pueden coincidir en tiempo, mientras que el neto descuenta su unión. El nombre del prensista procede de la captura; el enlace compartido no verifica su identidad.

Estas operaciones no descuentan tinta ni cambian los consumos: ese flujo continúa en Órdenes de producción.
