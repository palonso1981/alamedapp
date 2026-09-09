# APP ALAM V2.8 · Media y accesibilidad de reinicios

## Alcance

V2.8 modifica únicamente dos áreas: mejora táctil moderada de **Córner/Banda** en Directo y gestión real de fotografías del jugador maestro. No cambia la semántica deportiva, ni rediseña Plantilla, Directo o Dashboard.

## Córner y banda

- Córner pasa de 56×56 px (64×64 desde `sm`) a 64×64 px (72×72 desde `sm`).
- Banda pasa de 44 px de alto y 26% de ancho a 48 px/27% (56 px desde `sm`).
- Se refuerzan contraste, borde, fondo, trazo y label sin crear una barra permanente.
- Los controles siguen superpuestos de forma absoluta: la superficie y las coordenadas normalizadas no cambian.
- Evento, orientación, linkage y replay son los existentes.

## Proveedor y configuración

Firebase Storage queda descartado para V1 porque exige activar facturación Blaze. Firestore, Anonymous Auth, repositorios, outbox y sync continúan en Firebase sin cambios.

El binario optimizado se almacena en Cloudinary Free mediante upload unsigned. Configuración local no versionada:

```dotenv
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=xc7h48kz
NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET=alamedapp_players_dev
```

Endpoint: `POST https://api.cloudinary.com/v1_1/{cloudName}/image/upload`. El formulario contiene únicamente `file` y `upload_preset`. El preset fija el asset folder `alamedapp/players-dev`, impide definir `public_id` y hace que Cloudinary genere una identidad impredecible.

No existe API Secret, API key privada, firma ni `public_id` aportado por el navegador. Antes de producción puede sustituirse el preset unsigned por un endpoint firmado con el secreto exclusivamente en servidor.

## Modelo de fotografía

La fotografía pertenece a `MasterPlayer`; no a memberships, temporadas ni partidos. `playerId` nunca cambia.

Los uploads nuevos usan `managedPhoto.provider = CLOUDINARY` con `publicId`, `secureUrl`, versión opcional, MIME final, dimensiones, bytes y hora real de subida.

El modelo continúa admitiendo `FIREBASE_STORAGE` únicamente para leer metadata V2.8 ya existente. No la migra ni la elimina. `photoUrl` se conserva como fallback legacy. Un único resolver aplica: managed Cloudinary/Firebase → `photoUrl` → dorsal/iniciales.

## Procesamiento y privacidad

- Entrada: JPEG, PNG o WebP; máximo 12 MB.
- Lado máximo: 1280 px.
- Salida: WebP, calidad 0,84 y segundo intento 0,68; máximo 2 MB.
- `createImageBitmap(..., imageOrientation: "from-image")` respeta la orientación disponible.
- El re-encode mediante canvas elimina EXIF/GPS innecesario.
- Solo se sube el WebP procesado; nunca el original.

## Ciclo de vida y fallos

La UI depende del servicio de fotos y de `PlayerPhotoStorageAdapter`; no conoce HTTP de Cloudinary.

Flujo de alta/reemplazo: validar → procesar → subir → validar respuesta → actualizar el Player mediante repositorio/outbox. La referencia anterior permanece vigente hasta que el upload y la persistencia nueva terminan.

El upload unsigned no permite destruir assets con seguridad sin firma/API Secret. Por eso APP ALAM no intenta borrar desde el navegador:

- reemplazar activa B y puede dejar A como orphan;
- quitar elimina solo la referencia gestionada y recupera `photoUrl` legacy si existe;
- un fallo de upload conserva A;
- un fallo al persistir puede dejar el nuevo asset huérfano, pero nunca el Player roto.

La limpieza de orphans queda para una herramienta administrativa o backend firmado futuro. Exponer un API Secret en `NEXT_PUBLIC_*` o en código cliente está prohibido.

## Local-first y compatibilidad

Cloudinary almacena el binario; Firestore almacena únicamente metadata dentro del mismo documento `PLAYER`. `LocalTeamRepository → outbox → RemoteRepository` sigue siendo la ruta de persistencia. No existen blobs, base64 ni data URLs en Firestore, ni outbox binario.

Subir una foto requiere conexión y puede reintentarse. Plantilla, Directo y captura deportiva siguen offline-first. Jugadores legacy, memberships, snapshots históricos, Dashboard, Directo y comparadores continúan usando la imagen resuelta sin cambios de layout.

La cuenta Cloudinary DEV podrá transferirse al club o sustituirse por otra implementación gracias al adapter. El preset unsigned debe rotarse o endurecerse si se expone públicamente y, antes de producción, deben revisarse cuota, formatos/tamaño del preset y protección frente a abuso.

## Roadmap

Pendiente para V1:

- V2.9: índice YouTube, segmentos/anchors por `eventId`, ayuda de `createdAt`, enlaces de jugada y copia para WhatsApp. APP ALAM no almacenará vídeo.
- Release Candidate: Auth real, roles, reglas productivas, hosting definitivo, pruebas multiusuario, hardening de sync, media y operación/backups.

Post V1 y no bloqueante: plantilla tipo cromo, foto grande en banquillo, silueta real de portero, zona de pérdida, radar y nuevas visualizaciones.
