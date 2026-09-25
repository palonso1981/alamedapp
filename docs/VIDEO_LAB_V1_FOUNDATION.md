# Video Lab V1 · base evolutiva

## Objetivo y alcance

Video Lab relaciona la cronología deportiva con uno o varios vídeos de YouTube sin convertir el vídeo en fuente de verdad deportiva. Las verificaciones, los eventos creados desde vídeo y los clips tácticos usan la persistencia offline-first del agregado `MATCH`; no migran eventos históricos ni requieren una colección Firestore nueva.

## Dos tiempos distintos

- `period + minute + order` conserva el tiempo deportivo y el orden de replay.
- `observedAt` conserva, en eventos `LIVE` nuevos, el instante real de la primera interacción significativa del operador. `createdAt` continúa siendo el instante de creación/guardado y no cambia al editar.
- Los eventos `LIVE` antiguos, sin `observedAt`, siguen funcionando con `createdAt`.
- La resolución audiovisual usa `observedAt ?? createdAt`. Los eventos nacidos en revisión no reciben una hora inventada.

`observedAt` no participa en marcador, minutos, orden, replay ni estadísticas. No se realiza migración remota.

## Segmentos físicos y segmentos de sincronización

Un `MatchVideoSegment` representa una fuente física (un `videoId`). Video Lab deriva un segmento de sincronización por periodo cubierto:

- dos URL diferentes para P1/P2 producen dos segmentos independientes;
- una URL compartida produce igualmente calibraciones independientes para P1 y P2.

El primer anchor válido de cada segmento es el origen operativo. Un segundo anchor calcula dispersión/deriva y prepara una interpolación futura, pero no sustituye el primero mediante una mediana oculta. El margen de apertura se mantiene en `leadSeconds = 6`.

## Estado temporal de una jugada

- `AUTO`: posición estimada desde anchor y `observedAt ?? createdAt`.
- `VERIFIED`: el usuario confirma la estimación o usa **ACCIÓN AQUÍ** con el segundo real del reproductor. La confirmación se persiste en `MatchSession.videoEventOverrides`, como metadata audiovisual del `MATCH`, y sincroniza mediante la outbox existente.
- Fuente temporal: `observedAt`, `createdAt` o `manual`. `CORRECTA` conserva la fuente automática; **ACCIÓN AQUÍ** guarda `manual`.

Cada verificación conserva `matchId + eventId + segmentId + syncSegmentId`, segundo, estado, fuente y timestamps técnicos. Actualizar una verificación sustituye la entrada activa del evento sin duplicarla. El `MatchEvent`, `observedAt`, `createdAt`, el reloj deportivo y el replay permanecen intactos. Los overrides legacy sin estos campos opcionales continúan siendo legibles.

ADMIN y EDITOR pueden verificar. VIEWER ve la cronología y las posiciones, pero los controles de confirmación están deshabilitados; el repositorio y las Rules de `MATCH` mantienen además la denegación de escritura. No fue necesaria una colección ni una regla nueva.

## Cronología, eventos VIDEO y clips

La cronología interactiva muestra eventos relevantes. Las sustituciones y cambios de estado son hitos de orientación, pero se excluyen de clips, revisión y futuros reels. Córner y banda pertenecen a la familia temporal preparatoria: su pulsación suele ocurrir antes de la ejecución y no se les aplica un offset numérico definitivo en esta fase.

El seguimiento automático resalta el hito actual y atenúa los anteriores. Interactuar manualmente pausa el seguimiento; **SEGUIR VÍDEO** lo reanuda. Pulsar una fila busca su ventana de apertura.

### Evento deportivo desde vídeo

`+ EVENTO` crea un `MatchEvent` real con `provenance = VIDEO`. Se coloca después del hito elegido, usando su periodo/minuto y el siguiente `order` libre; por tanto no reescribe ni renumera eventos existentes. Replay deriva la alineación posterior al hito y presenta esos jugadores primero. El segundo actual del reproductor se guarda simultáneamente como override `VERIFIED/manual` del nuevo evento.

Los tipos expuestos son los eventos canónicos compatibles con el motor actual: amenaza, pérdida, falta, tarjeta y reinicio. No se inventa todavía un tipo `recuperación` que el modelo deportivo no posee.

### Clip táctico

`+ CLIP` crea un `MatchVideoAnalysisClip` separado de `MatchEvent`: `clubId`, `matchId`, segmento/video, segundo de referencia, inicio/fin, categoría libre opcional, etiquetas libres, jugadores CDA opcionales, comentario y timestamps. La propuesta inicial es referencia −3 s / +6 s y ambos extremos se pueden ajustar o tomar de la posición actual del reproductor. Los clips no cambian marcador, replay ni estadísticas y quedan preparados para una futura biblioteca global.

Las categorías visibles son sugerencias ampliables, no un enum persistido cerrado. Las etiquetas usadas se ordenan por frecuencia y recencia para su reutilización.

Eventos, overrides y clips se guardan en una sola mutación local del partido y viajan por la outbox existente. Un segundo navegador los recibe con la hidratación normal del `MATCH`. La resolución de conflictos limitada a vídeo incluye las tres piezas (`videoSegments`, `videoEventOverrides`, `videoAnalysisClips`) para no perder clips.

## Ruta de prototipo

`/partido/{matchId}/video-lab`

Incluye reproductor principal, cronología, saltos `-5/-1/+1/+5`, velocidades `0.75×–2×`, **ACCIÓN AQUÍ**, **CORRECTA**, **SIGUIENTE**, `+ EVENTO`, `+ CLIP` y seguimiento automático. En escritorio/tablet usa dos columnas; en móvil se apila verticalmente sin scroll horizontal global. La lista de partidos muestra `VIDEO LAB` solo cuando existe un segmento YouTube configurado.

## Limitaciones deliberadas

- YouTube continúa siendo la fuente audiovisual; no se descargan ni generan clips.
- No se implementa interpolación por deriva.
- No existe aún biblioteca/reel global, export MP4, IA ni jugador rival estructurado.
- La recuperación de balón no se ofrece hasta que exista como evento canónico del dominio.
- No cambia la UX de captura del Directo.
