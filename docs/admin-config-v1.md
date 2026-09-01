# Administración segura V1

## Jerarquía

AlamedAPP distingue desde esta versión:

`Club → Equipo → Temporada → Plantilla → Partido`

- El club V1 es fijo: `cd-alameda` / Club Deportivo Alameda.
- Un equipo es una unidad deportiva (`Senior A`, `Juvenil A`, etc.), no el club.
- Una temporada pertenece a un equipo y usa un `seasonId` estable.
- La plantilla de una temporada está formada por memberships; no por copias de personas.

## Identidades y memberships

`playerId` identifica a la persona dentro del club. No cambia al pasar de equipo o temporada. Nombre, fecha de nacimiento, pierna, foto y capacidad de portero pertenecen al maestro de club. Dorsal, posición principal y actividad deportiva se resuelven mediante `SeasonPlayer` para `teamId + seasonId`.

Staff sigue el mismo principio: identidad estable y rol/pertenencia por equipo-temporada. Esto permite agregar en el futuro estadísticas de una misma persona entre equipos y temporadas sin duplicarla.

Los registros anteriores que usaban `teamId = cd-alameda` continúan abriendo mediante un alias legacy explícito. La migración local V3 añade `club`, `clubId` y `teams` sin inventar un equipo real ni modificar partidos o memberships existentes.

## Jugador extra en Prepartido

Prepartido busca primero entre las identidades del club. Elegir una existente conserva su `playerId`, aunque su membership habitual pertenezca a otro equipo.

- **Solo este partido:** el jugador se añade a `extraPlayerIds`, a la convocatoria y al snapshot del partido. No crea membership en la plantilla habitual.
- **Añadir también a plantilla:** mantiene el mismo `playerId` y crea además la membership en el equipo y temporada del partido.

La sesión guarda snapshot suficiente para que el histórico no cambie si posteriormente se edita o archiva la ficha maestra.

## Archivar, reactivar y eliminar

- **Archivar** es reversible, oculta la entidad de listados normales y la excluye de nuevas selecciones operativas.
- **Reactivar** elimina la marca de archivo. No inventa memberships ni altera snapshots históricos.
- **Eliminar** es irreversible para la UI, exige confirmación fuerte y muestra antes el impacto conocido (temporadas, memberships, partidos y eventos).

V1 no realiza purgas físicas. Eliminar escribe un tombstone `deletedAt` mediante el mismo flujo UPSERT local-first. Esto conserva referencias históricas, mantiene idempotencia, evita resurrecciones tras reload/sync y respeta la prohibición de `delete` físico de Firestore. Una futura herramienta administrativa podrá diseñar una purga separada y auditada.

Los partidos archivados se ocultan del catálogo normal y deben excluirse por defecto de estadísticas futuras. Sus eventos, replay, revisión y procedencia se conservan. Un partido eliminado queda fuera de los listados incluso al mostrar archivados; sus datos remotos no se purgan.

## Offline-first y compatibilidad

Equipos deportivos, temporadas, identidades, memberships, archivo y tombstones viajan por outbox con ID estable, revisión optimista, compactación e idempotencia. `extraPlayerIds` y los snapshots forman parte de la metadata versionada del partido y sobreviven recarga y sincronización.

Partidos legacy sin `seasonId`, snapshots previos, `reviewStatus` y `provenance` no se modifican ni reciben valores inventados.

## Fotografías

`photoUrl` sigue siendo un mecanismo técnico provisional y se presenta como tal en la UI. La evolución prevista es **Subir foto / Elegir foto** mediante Firebase Storage o un adaptador equivalente; no se implementa Storage en esta fase.

## Firebase DEV

El nuevo documento de equipo deportivo se modela como `teams/cd-alameda/teams/{teamId}`. En DEV requiere una regla limitada a ese path, con `request.auth != null`, `entityType == TEAM_UNIT`, `payload.clubId == cd-alameda` y `allow delete: false`. Antes de producción, todas las reglas temporales de Anonymous Auth deberán sustituirse por autorización por club, usuario y rol.
