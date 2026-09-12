# RC1 · control de acceso por código

## Decisión de producto

APP ALAM utiliza credenciales compartibles, no cuentas personales. Un acceso tiene identidad estable (`accessId`), nombre humano (`label`), rol y alcance. El nombre puede cambiar y dos accesos pueden compartir nombre, rol o alcance. La identidad técnica del dispositivo sigue siendo Firebase Anonymous Auth y no se muestra al usuario.

Roles V1: `ADMIN`, `EDITOR` y `VIEWER` (VISOR en pantalla). ADMIN gestiona tanto el deporte como el club y sus accesos. EDITOR es el administrador deportivo de todo su club, pero no puede crear/modificar clubes ni gestionar accesos, códigos, roles o permisos. VISOR solo consulta: su alcance puede ser todo el club o uno o varios `teamIds`. No hay permisos granulares.

Los perfiles EDITOR antiguos que conserven `scope: TEAMS` no se reescriben destructivamente: aplicación, hidratación, repositorios y Rules interpretan su alcance deportivo efectivo como `CLUB`. El scope por equipos queda reservado a VIEWER.

## Código y secreto

Al crear un acceso se propone un código automático de dieciséis símbolos no ambiguos, agrupado en bloques de cuatro y generado con CSPRNG. El ADMIN puede conservarlo, editarlo o pedir otro. Un código personalizado debe contener entre 14 y 64 caracteres alfanuméricos después de normalizar, incluir letras y números, no ser una repetición trivial ni coincidir exactamente con el nombre del acceso. Se normaliza mediante una única función: trim, mayúsculas y eliminación de espacios/guiones para su identidad. Los códigos legacy válidos de doce símbolos continúan entrando sin migración.

El código solo se muestra después de que perfil y mapping hayan sido persistidos juntos correctamente. Puede copiarse en esa confirmación; después no existe “ver código” ni edición del código de un Access existente.

Firestore usa SHA-256 del código normalizado como ID de consulta exacta. Esto evita guardar/mostrar accidentalmente el texto original, pero **el hash es un bearer equivalente**: quien lo obtenga podría utilizarlo como secreto. La defensa real es la alta entropía, impedir `list`, las reglas, la revocación y la separación entre mapping, perfil y sesión. No se afirma que el hash proteja ante lectura completa de la base.

Modelo remoto:

- `accessCodes/{codeHash}`: mapping exacto al perfil, nunca enumerable.
- `clubs/{clubId}/accesses/{accessId}`: label, rol, scope, estado y versión de credencial.
- `clubs/{clubId}/accessSessions/{anonymousUid}`: sesión técnica activa y versión validada.
- `clubs/{clubId}/accessUsage/{accessId}/days/{day_deviceInstallId}`: señal mínima de uso.

V1 no ofrece regeneración ni reactivación de códigos. Para sustituir una credencial se desactiva o elimina funcionalmente el Access antiguo y se crea otro con un código nuevo. `DELETED` es un soft delete irreversible en RC1: oculta el perfil de la operativa, revoca su mapping y no concede permisos. No existe hard delete. Los campos estructurales de versión y hash se conservan para validar y revocar credenciales existentes.

## Sesión, offline y outbox

El grant validado se recuerda localmente por dispositivo junto con un `deviceInstallId` aleatorio. Sin conexión puede restaurarse una autorización previamente válida; una revocación remota no puede conocerse offline. Al reconectar, las reglas vuelven a validar sesión, perfil, versión y mapping. Si fue revocado, la sincronización falla de forma conservadora: la outbox y la captura local se preservan para revisión ADMIN; no se descarta ni reasigna información.

No se permite cambiar de acceso mientras exista trabajo que el coordinador todavía pueda enviar (`PENDING`, `SYNCING` o error reintentable). Conflictos y errores terminales se conservan íntegros, pero no se reenvían por sí solos bajo otra identidad y por eso no bloquean el cambio. Cambiar acceso solo elimina el grant de acceso, no los datos deportivos. Los catálogos y repositorios filtran la caché por el scope actual sin borrar entradas ocultas.

Tras validar una sesión online, el cliente consulta Firestore con filtros explícitos de `clubId` y, solo para VIEWER con scope `TEAMS`, de cada `teamId`. ADMIN y EDITOR reconstruyen todo el catálogo deportivo del club; VIEWER reconstruye únicamente su alcance. Se recuperan club, equipos, temporadas, memberships, personas legibles y partidos/eventos en el almacenamiento local. Este seed no crea outbox y nunca pisa un agregado local existente, protegiendo cambios offline. Firestore Rules no filtra resultados de una query: una consulta sin las restricciones compatibles debe ser rechazada.

## Límites de datos y trazabilidad

El mismo código puede utilizarse en varios dispositivos. La actividad y las mutaciones solo pueden atribuirse a una credencial y, técnicamente, a una instalación; nunca se afirma que identifiquen a una persona. No se recopilan email, IP, geolocalización, nombre real ni fingerprint.

La métrica registra como máximo una señal por credencial, instalación y día desde ese navegador. ADMIN ve último uso, dispositivos aproximados y días activos en 30 días. No son usuarios únicos ni pageviews.

Los maestros de jugadores/staff son entidades compartidas por club. ADMIN y EDITOR pueden mantener toda la configuración deportiva de su propio club —equipos, temporadas, plantilla, partidos, eventos y recursos deportivos—. Solo ADMIN puede mutar el documento institucional Club o administrar Access. VIEWER no escribe y la UI oculta cualquier dato cacheado fuera de su alcance.

## Bootstrap del primer ADMIN

No existe “primer usuario = admin”. En DEV, desde `C:\AlamedAPP`:

```powershell
npm run access:bootstrap -- cd-alameda "Administrador inicial"
```

El comando genera localmente un `accessId`, un código y dos payloads. No usa credenciales Firebase ni escribe en la nube. En la consola del proyecto **cdalameda-dev**, un administrador del proyecto crea exactamente los dos documentos indicados. El código se copia y se guarda fuera de Git. Para un futuro PROD se repetirá el procedimiento sobre el proyecto PROD explícito, después de revisar y desplegar reglas productivas; nunca se copiarán credenciales DEV.

## Reglas DEV y despliegue

Las reglas RC1 deben desplegarse únicamente tras revisar el diff y disponer del ADMIN bootstrap. Requieren `request.auth != null`, sesión/perfil/mapping activos, rol y scope; VISOR nunca escribe y no hay borrado físico. Los deep-links se protegen también en la aplicación y los repositorios locales constituyen un segundo firewall.

Las Rules impiden que el Access ADMIN de la sesión actual sea degradado, desactivado o eliminado por esa misma operación. No pueden contar de forma fiable todos los ADMIN activos del club con este modelo documental; la garantía de “último ADMIN” se mantiene en la aplicación y sus tests. Una garantía transaccional global futura requerirá un documento de control/índice administrado, no una afirmación ficticia en Rules.

Comando previsto, exclusivamente para DEV:

```powershell
npx firebase-tools deploy --only firestore:rules --project cdalameda-dev
```

Estas reglas no se consideran producción. Antes de PROD deben revisarse entorno, backups, observabilidad, recuperación, auditoría y gestión de usuarios real.

## Coste y límites RC1

RC1 funciona en Spark: Firestore, Anonymous Auth y Cloudinary existente. No usa Blaze, Cloud Functions ni Firebase Storage. No existe zona pública, recuperación de contraseñas, login Google/email ni identidad personal. La revocación inmediata sin conexión es imposible. RC2 deberá abordar identidad multiusuario real, conflictos/sync, separación DEV/PROD, backup y hosting.
