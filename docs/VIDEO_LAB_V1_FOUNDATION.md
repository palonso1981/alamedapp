# Video Lab V1 · base evolutiva

## Objetivo y alcance

Video Lab relaciona la cronología deportiva con uno o varios vídeos de YouTube sin convertir el vídeo en fuente de verdad deportiva. Esta primera base es un prototipo local: no migra eventos históricos, no cambia Firestore y no persiste todavía las verificaciones experimentales.

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
- `VERIFIED`: el usuario confirma la estimación o usa **ACCIÓN AQUÍ** con el segundo real del reproductor.
- Fuente temporal: `observedAt`, `createdAt` o `manual`.

Las verificaciones del prototipo viven en memoria. Persistirlas exigirá una decisión posterior de modelo y sync.

## Cronología y clips

La cronología interactiva muestra eventos relevantes. Las sustituciones y cambios de estado son hitos de orientación, pero se excluyen de clips, revisión y futuros reels. Córner y banda pertenecen a la familia temporal preparatoria: su pulsación suele ocurrir antes de la ejecución y no se les aplica un offset numérico definitivo en esta fase.

El seguimiento automático resalta el hito actual y atenúa los anteriores. Interactuar manualmente pausa el seguimiento; **SEGUIR VÍDEO** lo reanuda. Pulsar una fila busca su ventana de apertura.

## Inserción futura desde vídeo

Se preparan dos conceptos sin escribir aún cronología:

1. `SPORTS_EVENT`, con `provenance = VIDEO`, posición deportiva explícita y jugadores en pista derivados por replay en ese punto.
2. `TACTICAL_NOTE`, independiente y no estadística.

Así, añadir una acción vista en vídeo no altera silenciosamente un evento existente ni mezcla notas tácticas con estadísticas. La misma estructura permitirá filtros y consumo futuro de clips sin generar archivos de vídeo físicos.

## Ruta de prototipo

`/partido/{matchId}/video-lab`

Incluye reproductor principal, cronología, saltos `-5/-1/+1/+5`, velocidades `0.75×–2×`, **ACCIÓN AQUÍ**, **CORRECTA**, **SIGUIENTE** y seguimiento automático. En escritorio/tablet usa dos columnas; en móvil se apila verticalmente sin scroll horizontal global.

## Limitaciones deliberadas

- YouTube continúa siendo la fuente audiovisual; no se descargan ni generan clips.
- No se persisten todavía verificaciones Video Lab.
- No se implementa interpolación por deriva.
- No se insertan todavía eventos deportivos ni notas desde la ruta.
- No cambia la UX de captura del Directo.
