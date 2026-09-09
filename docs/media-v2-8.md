# APP ALAM V2.8 · Media y accesibilidad de reinicios

## Alcance

V2.8 modifica únicamente dos áreas: mejora táctil moderada de **Córner/Banda** en Directo y gestión real de fotografías del jugador maestro mediante un proveedor de media. No cambia la semántica deportiva de los reinicios ni rediseña Plantilla, Directo o Dashboard.

## Córner y banda

- Córner pasa de 56×56 px (64×64 desde `sm`) a 64×64 px (72×72 desde `sm`).
- Banda pasa de 44 px de alto y 26% de ancho a 48 px/27% (56 px desde `sm`).
- Se refuerzan contraste, borde, fondo, trazo y label sin crear una barra permanente.
- Los controles continúan superpuestos de forma absoluta: la superficie y las coordenadas normalizadas de la pista no cambian.
- Evento, orientación, linkage y replay son los existentes.

## Modelo de fotografía

La fotografía sigue perteneciendo a `MasterPlayer`; no pertenece a memberships, temporadas ni partidos. `playerId` no cambia al subir, sustituir o retirar una foto.

`managedPhoto` contiene:

- provider (`FIREBASE_STORAGE`);
- path estable del objeto;
- URL resuelta/cacheada;
- versión;
- MIME final;
- dimensiones, tamaño y fecha de actualización.

`photoUrl` se conserva sin migración como fallback legacy. La resolución central usa `managedPhoto.url`, después `photoUrl` y, finalmente, el fallback visual de dorsal/iniciales. Quitar una foto gestionada no borra la URL legacy.

## Storage y ciclo de vida

La UI depende del servicio de fotos y de `PlayerPhotoStorageAdapter`; no llama directamente a Firebase Storage. El adaptador DEV importa únicamente las APIs modulares necesarias y verifica de forma dura `projectId === "cdalameda-dev"`.

Path versionado:

`clubs/{clubId}/players/{playerId}/{timestamp-id}.webp`

El nombre original no identifica el objeto. Cada sustitución sube una ruta nueva, actualiza después la metadata del Player mediante `LocalTeamRepository + outbox`, y solo entonces intenta eliminar el objeto anterior. Si falla esa limpieza puede quedar un orphan temporal, preferible a romper la referencia vigente. Si falla la subida o la persistencia, la foto anterior continúa activa; una nueva subida cuya metadata no pueda guardarse se elimina best-effort.

El path versionado y el cache-control `immutable` evitan mostrar una versión anterior por caché.

## Procesamiento y privacidad

- Entrada: JPEG, PNG o WebP.
- Máximo de entrada: 12 MB.
- Lado máximo: 1280 px.
- Salida: WebP, calidad inicial 0,84 y segundo intento 0,68.
- Máximo de salida: 2 MB.
- `createImageBitmap(..., imageOrientation: "from-image")` respeta la orientación disponible.
- El re-encode mediante canvas elimina la metadata EXIF/GPS innecesaria.
- Firestore recibe únicamente la referencia; nunca blobs, base64 ni data URLs.

No se añade un outbox binario: subir o quitar físicamente una foto requiere conexión. Plantilla, Directo y la captura deportiva conservan su funcionamiento offline-first. La UI informa del requisito, permite reintentar y no modifica el Player antes del upload válido.

## Seguridad DEV y activación pendiente

La configuración local apunta a `cdalameda-dev` y al bucket `cdalameda-dev.firebasestorage.app`, pero la comprobación pública realizada durante V2.8 devolvió `404 Not Found`; por tanto el bucket todavía debe aprovisionarse desde Firebase Console antes de validar una subida real.

`storage.rules` queda deliberadamente limitada a:

- bucket exacto `cdalameda-dev.firebasestorage.app`;
- `clubs/cd-alameda/players/{playerId}/{version}`;
- usuario Firebase autenticado;
- el mismo `ownerUid` anónimo que creó el objeto;
- WebP de 1 byte a 2 MB;
- coherencia entre path y metadata de jugador;
- denegación total para cualquier otra ruta.

Tras activar Storage, desplegar exclusivamente en DEV desde `C:\AlamedAPP`:

```powershell
npx firebase-tools deploy --only storage --project cdalameda-dev
```

Anonymous Auth y estas reglas son solo una protección DEV. Antes de producción deberán sustituirse por Auth real, autorización por club/usuario/rol y una decisión explícita sobre lectura, propiedad y ciclo de vida multiusuario.

## Compatibilidad

El nuevo campo es opcional, por lo que no exige reset ni cambio de schema local. Los Player legacy siguen cargando. La metadata gestionada viaja en el mismo documento `PLAYER`, con el mismo `playerId`, por el outbox y RemoteRepository actuales. Los snapshots históricos no se reescriben; las nuevas convocatorias heredan la foto resuelta del Player master.

## Roadmap

Pendiente para V1:

- V2.9: índice YouTube, segmentos/anchors por `eventId`, ayuda de `createdAt`, enlaces de jugada y copia para WhatsApp. El vídeo no se almacenará en APP ALAM.
- Release Candidate: Auth real, roles, reglas productivas, Firebase/hosting definitivo, pruebas multiusuario, hardening de sync y operación/backups.

Post V1 y no bloqueante: plantilla tipo cromo, foto grande en banquillo, silueta real de portero, zona de pérdida, radar y nuevas visualizaciones.
