# Perfiles de prensistas y rebobinado

## Activación

Ejecutar **`supabase/operator-profiles.sql` completo** después de `production-sessions.sql`. Después recargar la captura, el panel y los enlaces compartidos. El archivo acumulado `press-sheets.sql` también incluye esta actualización para instalaciones que todavía no tenían hojas; no volver a ejecutar todo `setup.sql` en una instalación existente.

Se conservan las órdenes, existencias, bobinas, relojes, paros y enlaces. Repetir la migración no reinicia contraseñas, responsables ni sesiones existentes. Las contraseñas se entregaron por separado: el navegador y los documentos no contienen sus valores. La base utiliza verificadores bcrypt y el servidor local usa scrypt.

## Perfiles

| Área | Perfil | Usuario |
| --- | --- | --- |
| Producción | Julio Rocha | JRU |
| Producción | Manuel Carrillo | MCR |
| Rebobinado | Aurora Arroyo | AA |
| Rebobinado | Lorena Leticia | LL |

Son accesos de personal para las páginas compartidas. No crean cuentas de acceso al inventario ni conceden permisos de administración o de bitácora privada.

## Captura y órdenes anteriores

La captura pide elegir **Prensista** y **Rebobinado** mediante listas. El servidor valida ambos perfiles; no acepta nombres libres ni un usuario del área equivocada. Cada prensista ve únicamente sus órdenes pendientes y cada rebobinadora ve únicamente las asignadas a ella.

Las órdenes anteriores con nombres conocidos («Julio», «Julio Rocha», «JRU», «Manuel», «Manuel Carrillo», «MCR», ignorando mayúsculas y espacios repetidos) se relacionan con su perfil. No se infiere una persona a partir de nombres diferentes. El panel del propietario conserva todas las hojas y permite **Guardar asignación** para corregir las pendientes. No se cambia el prensista después de iniciar producción ni la rebobinadora después de tomar la orden.

Las órdenes antiguas sin rebobinadora aparecen disponibles para Aurora y Lorena cuando producción entrega su primera bobina. La primera que pulsa **Iniciar rebobinado · tomar orden** queda como responsable; la orden deja de aparecer en el otro perfil. Las nuevas órdenes ya tienen responsable desde captura, y el mismo botón registra cuándo esa persona comenzó a atenderlas.

## Inicio de sesión y registro

Se conservan los enlaces generales de prensistas y rebobinado que ya se compartieron. Cada área presenta sus dos perfiles y solicita usuario y contraseña. Una sesión dura hasta 12 horas y se mantiene al abrir una orden o volver a la lista, dentro de la misma pestaña. **Cerrar sesión** revoca ese acceso; otra sesión del mismo usuario no se cierra automáticamente. Expirar o cerrar sesión no detiene los relojes de producción: los paros se siguen registrando con sus botones.

Los controles se validan también en servidor. Conocer el enlace directo de otra orden no permite verla, imprimirla ni modificarla. Un token de producción no abre rebobinado; las sesiones se vinculan al espacio de trabajo del enlace. Diez intentos fallidos bloquean temporalmente el usuario durante la ventana de diez minutos. Solo se guardan resúmenes criptográficos de los tokens de sesión.

El inicio de producción y la finalización de las bobinas registran el perfil verificado. Las firmas se completan con el nombre de quien está conectado; los metros, tiempos y justificaciones anteriores se conservan. La bitácora privada agrupa los registros que tienen perfil verificado y conserva el nombre capturado en los demás.

El propietario que ya inició sesión en el panel puede revisar las hojas como **Administración**, sin entrar con las credenciales de un trabajador. Puede pulsar **Entrar como personal** para probar uno de los perfiles. Este acceso administrativo no cambia su sesión principal ni suplanta automáticamente a un empleado.

## Verificación

Las pruebas cubren acceso de los cuatro perfiles, filtro de órdenes, rechazo de enlaces ajenos y de escrituras cruzadas, separación de áreas, toma exclusiva de rebobinado, caducidad, cierre de sesión, limitación de intentos, asignación desde captura y conservación de los responsables después de comenzar el trabajo. Las funciones anteriores sin sesión y las funciones auxiliares tampoco conceden acceso anónimo en Supabase.
