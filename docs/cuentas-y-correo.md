# Cuentas, correo y sesiones

Los cambios del sitio necesitan activar también la migración de Supabase. No basta con publicar los archivos en Cloudflare.

## 1. Activar permisos y administración

En Supabase → SQL Editor, ejecuta completo `supabase/accounts-and-sessions.sql`. Es una actualización del proyecto existente: conserva el inventario, el historial y los miembros anteriores. Para una instalación nueva, `supabase/setup.sql` ya incluye esta actualización.

La cuenta verificada **chinofidelemiliano@gmail.com** se convierte en administradora únicamente si ya era miembro autorizado antes de ejecutar la actualización. Si no lo era: crea y verifica esa cuenta, y después ejecuta completo `supabase/authorize-owner.sql` desde SQL Editor. Este paso explícito evita otorgar administración a una persona que solamente escriba ese correo en el registro.

Al entrar con la cuenta administradora aparecerá **Cuentas y seguridad**. Marca los apartados permitidos y pulsa **Autorizar acceso**. También puedes actualizar permisos o retirarlos. Una cuenta nueva permanece sin datos aunque ya haya verificado su correo. Los permisos se comprueban en Supabase además de limitar el menú. Los miembros anteriores conservan acceso a los apartados habituales; solo la cuenta administradora puede aprobar usuarios o gestionar el enlace de captura compartida.

Los permisos son por apartado. Algunos incluyen información relacionada necesaria: preparación e incidencias necesitan las órdenes; consumos y cortes necesitan los lotes. El formulario público sigue utilizando su enlace privado compartido y no exige registrar usuarios.

## 2. Enviar códigos desde tu Gmail

En Supabase → Authentication → Sign In / Providers → Email, habilita el registro por correo y **Confirm email**. No desactives la confirmación.

En Authentication → Email → SMTP Settings, configura **Custom SMTP**:

| Campo | Valor |
| --- | --- |
| Sender email | chinofidelemiliano@gmail.com |
| Sender name | Inventario |
| Host | smtp.gmail.com |
| Port | 465 |
| Username | chinofidelemiliano@gmail.com |
| Password | Contraseña de aplicación de Google |

En tu cuenta de Google activa la verificación en dos pasos y genera una contraseña de aplicación para Supabase. Esa contraseña se introduce únicamente en el panel de Supabase. No uses tu contraseña normal ni la compartas por chat o en el repositorio. Algunas cuentas tienen restricciones que impiden crear contraseñas de aplicación; en ese caso hay que habilitarlas en Google o utilizar un proveedor SMTP compatible.

En Authentication → Email Templates → Confirm signup, incluye el código `{{ .Token }}` en el mensaje, por ejemplo:

> Tu código de verificación es: {{ .Token }}
> Escríbelo en la pantalla Crear cuenta. Después, el administrador debe autorizar tus permisos.

Puedes configurar una expiración de 10 minutos en las opciones de Email OTP. El sitio permite códigos de 6 a 8 dígitos y limita el botón de reenvío durante 60 segundos; Supabase aplica además sus propios límites. El envío real depende de que guardes y pruebes esta configuración SMTP. El sitio no contiene credenciales de correo.

Prueba con una cuenta nueva: Crear cuenta → recibir código → Verificar código → Pendiente de autorización. Desde tu cuenta administradora, concede solo los apartados necesarios y comprueba el acceso. Revisa correo no deseado si no llega el mensaje.

## 3. Dispositivos y sesiones

**Cuentas y seguridad → Inicios de sesión por dispositivo** muestra los últimos 200 registros: correo, navegador, sistema, dirección del sitio, inicio, última actividad y cierre, en horario de Ciudad de México. Los registros comienzan con esta actualización; no es posible reconstruir dispositivos anteriores. El navegador informa el tipo de equipo: no es una identificación física garantizada. No se guardan contraseñas, tokens ni direcciones IP.

**Cerrar acceso de esta sesión** bloquea sus siguientes consultas protegidas y desactiva las notificaciones del dispositivo correspondiente. La pantalla abierta detecta el cambio en su próxima revisión (normalmente hasta un minuto cuando está visible). La cuenta puede iniciar una sesión nueva si conserva permisos. Para bloquearla por completo, retira su acceso. Los datos ya vistos o descargados no pueden eliminarse de otro equipo.

## 4. Mantenimiento

Aplica esta migración después de las migraciones anteriores, ya que protege las funciones existentes con comprobaciones de acceso. No publiques funciones internas con permisos de ejecución para usuarios. Después de futuras actualizaciones SQL, comprueba que las funciones públicas siguen aplicando los permisos de cuenta.

El modo oscuro usa negros, blancos y grises e incluye las pantallas de acceso, registro y espera. El logo y las muestras de tinta conservan sus colores. La apariencia de acceso se recuerda en el navegador; los ajustes personales completos continúan guardados por perfil.
