# RC1 · control de acceso por código

## Decisión de producto

APP ALAM utiliza credenciales compartibles, no cuentas personales. Un acceso tiene identidad estable (`accessId`), nombre humano (`label`), rol y alcance. El nombre puede cambiar y dos accesos pueden compartir nombre, rol o alcance. La identidad técnica del dispositivo sigue siendo Firebase Anonymous Auth y no se muestra al usuario.

Roles V1: `ADMIN`, `EDITOR` y `VIEWER` (VISOR en pantalla). ADMIN tiene todo el club; EDITOR gestiona deporte dentro de `CLUB` o de uno o varios `teamIds`; VISOR consulta dentro del mismo modelo de alcance y no puede mutar. No hay permisos granulares.

## Código y secreto

El código tiene doce símbolos no ambiguos, agrupados `XXXX-XXXX-XXXX`, y 60 bits de entropía. Se genera con CSPRNG, se normaliza en mayúsculas y tolera guiones o espacios. Se muestra solo al crear o regenerar y no aparece en el listado normal.

Firestore usa SHA-256 del código normalizado como ID de consulta exacta. Esto evita guardar/mostrar accidentalmente el texto original, pero **el hash es un bearer equivalente**: quien lo obtenga podría utilizarlo como secreto. La defensa real es la alta entropía, impedir `list`, las reglas, la revocación y la separación entre mapping, perfil y sesión. No se afirma que el hash proteja ante lectura completa de la base.

Modelo remoto:

- `accessCodes/{codeHash}`: mapping exacto al perfil, nunca enumerable.
- `clubs/{clubId}/accesses/{accessId}`: label, rol, scope, estado y versión de credencial.
- `clubs/{clubId}/accessSessions/{anonymousUid}`: sesión técnica activa y versión validada.
- `clubs/{clubId}/accessUsage/{accessId}/days/{day_deviceInstallId}`: señal mínima de uso.

Regenerar conserva `accessId`, label, rol y scope, incrementa `credentialVersion`, desactiva el mapping anterior y crea uno nuevo. Desactivar o cambiar permisos se aplica en el siguiente chequeo online. El código anterior y las sesiones de versión anterior dejan de ser válidos.

## Sesión, offline y outbox

El grant validado se recuerda localmente por dispositivo junto con un `deviceInstallId` aleatorio. Sin conexión puede restaurarse una autorización previamente válida; una revocación remota no puede conocerse offline. Al reconectar, las reglas vuelven a validar sesión, perfil, versión y mapping. Si fue revocado, la sincronización falla de forma conservadora: la outbox y la captura local se preservan para revisión ADMIN; no se descarta ni reasigna información.

No se permite cambiar de acceso mientras exista cualquier operación de partido o plantilla en la outbox, incluidas operaciones con error o conflicto. El usuario debe conectar y sincronizar antes. Cambiar acceso solo elimina el grant de acceso, no los datos deportivos. Los catálogos y repositorios filtran la caché por el scope actual sin borrar entradas ocultas.

## Límites de datos y trazabilidad

El mismo código puede utilizarse en varios dispositivos. La actividad y las mutaciones solo pueden atribuirse a una credencial y, técnicamente, a una instalación; nunca se afirma que identifiquen a una persona. No se recopilan email, IP, geolocalización, nombre real ni fingerprint.

La métrica registra como máximo una señal por credencial, instalación y día desde ese navegador. ADMIN ve último uso, dispositivos aproximados y días activos en 30 días. No son usuarios únicos ni pageviews.

Los maestros de jugadores/staff son entidades compartidas por club. Un EDITOR con scope TEAMS solo puede actualizar un maestro cuando aporta un equipo/temporada permitido y ya existe la membership correspondiente; la creación permite crear el maestro antes de sincronizar su membership. La UI solo expone personas vinculadas a equipos autorizados.

## Bootstrap del primer ADMIN

No existe “primer usuario = admin”. En DEV, desde `C:\AlamedAPP`:

```powershell
npm run access:bootstrap -- cd-alameda "Administrador inicial"
```

El comando genera localmente un `accessId`, un código y dos payloads. No usa credenciales Firebase ni escribe en la nube. En la consola del proyecto **cdalameda-dev**, un administrador del proyecto crea exactamente los dos documentos indicados. El código se copia y se guarda fuera de Git. Para un futuro PROD se repetirá el procedimiento sobre el proyecto PROD explícito, después de revisar y desplegar reglas productivas; nunca se copiarán credenciales DEV.

## Reglas DEV y despliegue

Las reglas RC1 deben desplegarse únicamente tras revisar el diff y disponer del ADMIN bootstrap. Requieren `request.auth != null`, sesión/perfil/mapping activos, rol y scope; VISOR nunca escribe y no hay borrado físico. Los deep-links se protegen también en la aplicación y los repositorios locales constituyen un segundo firewall.

Comando previsto, exclusivamente para DEV:

```powershell
firebase deploy --only firestore:rules --project cdalameda-dev
```

Estas reglas no se consideran producción. Antes de PROD deben revisarse entorno, backups, observabilidad, recuperación, auditoría y gestión de usuarios real.

## Coste y límites RC1

RC1 funciona en Spark: Firestore, Anonymous Auth y Cloudinary existente. No usa Blaze, Cloud Functions ni Firebase Storage. No existe zona pública, recuperación de contraseñas, login Google/email ni identidad personal. La revocación inmediata sin conexión es imposible. RC2 deberá abordar identidad multiusuario real, conflictos/sync, separación DEV/PROD, backup y hosting.
