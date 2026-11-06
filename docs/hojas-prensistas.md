# Hojas para prensistas

Al finalizar la preparación se crea una hoja por orden y se abre su página independiente. Si el navegador bloquea la ventana, se puede abrir desde **Órdenes para prensistas**. Esta sección reúne las hojas del perfil por mes de creación y permite copiar el enlace para el prensista.

Los datos conocidos de la orden se conservan como referencia: folio, NP, producto, máquina, metraje programado, herramentales y tintas preparadas. Los campos restantes quedan disponibles para completar material, bobinas, tiempos de prensa, rebobinado, empaque, resultados y firmas. Las órdenes preparadas anteriormente pueden generar su hoja desde el detalle; no se crean hojas históricas en bloque.

El prensista puede guardar los campos capturados, imprimir o descargar el PDF. La hoja normal ocupa una página A4; los textos extensos se conservan completos en un anexo del PDF. Guardar estos datos no descuenta inventario ni confirma consumos: estos se siguen registrando en el flujo de producción existente. Una orden cancelada deja su hoja en consulta.

Cada enlace contiene una clave exclusiva para consultar y completar esa hoja, sin abrir el inventario. Debe compartirse únicamente con quienes necesiten trabajar en ella. Los cambios simultáneos se detectan mediante la versión guardada para evitar sobrescrituras.

## Activación posterior en Supabase

Para un proyecto existente, la migración preparada es `supabase/press-sheets.sql`. Debe aplicarse después de las migraciones actuales de cuentas, permisos, reloj de preparación y recuperación de incidencias. No es necesario volver a ejecutar todo `supabase/setup.sql`; este último incluye la migración para instalaciones nuevas.

La migración crea una tabla privada por propietario y funciones para generar, listar y completar hojas. La generación al finalizar preparación se ejecuta en la misma transacción y no duplica hojas de una orden. El servidor local utiliza SQLite y crea su tabla automáticamente.

Esta entrega prepara los archivos del borrador. No ejecuta SQL en el proyecto remoto ni publica el sitio.
