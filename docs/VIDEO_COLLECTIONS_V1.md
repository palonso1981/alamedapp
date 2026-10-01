# VIDEO · Colecciones y reels compartidos V1

## Modelo

Una colección es metadata audiovisual independiente (`VIDEO_COLLECTION`). No modifica `MatchEvent`, replay, estadísticas, `AUTO/VERIFIED`, anchors ni clips. Cada elemento conserva la referencia estable al evento/clip de origen y una instantánea del corte (`videoId`, segmento, inicio, final y referencia) en el orden elegido.

Los documentos viven en `clubs/{clubId}/videoCollections/{collectionId}`. `COLLECTION` aparece en la zona Colecciones; `SHARED_REEL` es un recurso persistente oculto de la lista normal. `CLUB` y `LINK_ONLY` controlan la visibilidad de producto, pero ningún enlace es público: APP ALAM exige siempre una sesión Access válida.

## Persistencia y conflicto

El cliente guarda primero colección y operación en almacenamiento local, conserva `operationId` durante compactación/reintento y sincroniza por revisión optimista. Un navegador limpio hidrata las colecciones remotas; una hidratación nunca pisa una colección con operación local pendiente. El borrado es lógico (`active=false`, `deletedAt`) y no hay hard delete.

Las Rules propuestas permiten lectura autenticada del club, escritura a ADMIN/EDITOR y nunca escritura a VIEWER. Validan club, identidad, schema, tipo, visibilidad y revisión. Deben desplegarse primero en DEV antes de validar persistencia multidispositivo; este bloque no autoriza deploy automático ni cambios en PROD.

## Reproducción y elementos no disponibles

La URL estable es `/video?collection={collectionId}` y reutiliza exactamente el reproductor/reel fullscreen existente. Si el origen sigue disponible, se reproduce la instantánea guardada del corte. Si un evento o clip fue retirado, la colección conserva su referencia, informa cuántos elementos no están disponibles y reproduce el resto sin romperse.

## Limitaciones V1

- No hay acceso público/anónimo fuera del sistema Access.
- No se duplican vídeos ni eventos; solo se guarda metadata de referencia/corte.
- Los reels `LINK_ONLY` no aparecen a usuarios de solo lectura en la lista normal. ADMIN/EDITOR pueden administrarlos mediante el enlace o el recurso interno.
- La colaboración simultánea conserva divergencias como conflicto; no existe merge visual de dos reordenaciones concurrentes.
