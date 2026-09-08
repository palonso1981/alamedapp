# APP ALAM V2.6 · Gestión y edición segura de partidos

## Identidad e integridad

- `matchId` es la identidad estable del partido y nunca cambia al editar metadata.
- Los eventos conservan `eventId`, `createdAt`, posición deportiva y coordenadas. La edición de partido no reescribe cronología ni ejecuta replay.
- Marcador y resultado continúan derivados exclusivamente de Event Sourcing.
- `teamId` no es editable: mover un partido entre equipos rompería el contexto histórico de convocatoria, alineaciones y jugadores.
- `seasonId` solo puede corregirse a otra temporada existente del mismo club y del mismo equipo. La convocatoria y los eventos son snapshots del partido y no se regeneran.
- Partidos eliminados mediante tombstone no admiten edición, evitando que una operación retrasada los reactive.

## Metadata editable

Desde **Partidos → Editar** se puede corregir el mismo documento `MATCH`:

- temporada compatible;
- tipo y nombre de competición;
- jornada numérica opcional;
- rival;
- local/visitante;
- fecha y hora;
- categoría rival opcional.

No se editan equipo, marcador, resultado, duración, jugadores ni eventos. `Sin clasificar` reutiliza la ausencia de `competitionType`; no existe un campo de competición paralelo.

## Offline, revisiones y conflictos

El formulario usa `LocalMatchRepository`: guarda primero localmente, actualiza el índice reconstruible de Partidos y encola un único UPSERT de entidad `MATCH`. No genera operaciones `EVENT`. La sincronización conserva `operationId`, `baseRevision`, idempotencia y detección de conflictos existentes; no aplica last-write-wins.

Cambiar competición, rival o sede actualiza los filtros, búsquedas y labels desde la copia local. Los scopes y la trazabilidad siguen identificando el partido por `matchId`, y cada evento por `matchId + eventId`.

## Categorías

En el modelo actual cada `Season` contiene `teamId`; no es una temporada global compartida. Por ello `Season.category` representa correctamente el contexto **equipo + temporada** (por ejemplo, Juvenil DH en 2026/27) sin repetirlo por partido.

`MatchPreparation.opponentCategory` es texto opcional del enfrentamiento. Los históricos sin este campo permanecen vacíos: no se infiere ni migra ninguna categoría. Los antiguos campos `TeamProfile.category` y `MatchPreparation.category` se conservan solo por compatibilidad y no se convierten silenciosamente.

Los campos nuevos son opcionales y compatibles con el envelope local actual, por lo que no requieren incremento de schema ni reset. Las reglas DEV ya aceptan el payload tipado de Season/Match y no necesitan ampliación.

## P-J V2.5

Un intervalo P-J abierto se cierra en el límite deportivo canónico de un periodo finalizado (20′), no en el último evento observado. En un partido en curso llega únicamente al minuto deportivo actual. P1 y P2 se calculan de forma independiente y nunca se usan timestamps de captura.

## Limitaciones deliberadas

- Jornada continúa siendo número entero opcional; rounds de texto requieren una decisión de modelo posterior.
- No hay cambio de equipo ni edición directa de score/resultado/duración.
- La resolución visual avanzada de conflictos no cambia en V2.6.
- No se incorpora catálogo de rivales ni taxonomía cerrada de categorías.

## Backlog, no implementado

- Acción contextual **PÉRDIDA**, filtro de estado del marcador y posible vínculo derivado pérdida → transición rival.
- **Índice inteligente de vídeo externo**: AlamedAPP no almacenará vídeo. Un partido podrá referenciar 1..N segmentos (YouTube u otro proveedor), con cobertura y anchors `eventId + videoSecond`; `createdAt` ayudará a estimar posiciones y un `leadSeconds` cercano a 6 s permitirá abrir antes de la acción. Los enlaces se resolverán al vuelo, sin guardar una URL distinta por evento. La prueba Chelva mostró estimaciones con aproximadamente 1–3 s de diferencia usando anchors separados. No hay código de vídeo en V2.6.
