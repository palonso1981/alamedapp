# Video Sync V2 · calibración y autoauditoría

## Principio temporal

Video Sync V2 mantiene separadas la cronología deportiva y la audiovisual. Los eventos, su minuto, orden, replay y estadísticas no se modifican. La estimación `AUTO` usa el instante de captura fiable (`observedAt`, con compatibilidad para `createdAt` LIVE legacy) y una calibración del periodo:

`segundoVídeo = segundoCalibración + (instanteEvento - instanteCalibración)`

Un tiempo muerto, lesión o mopa no necesita tratamiento especial si el vídeo continúa grabando: el tiempo real transcurre simultáneamente en ambos ejes. `leadSeconds` solo adelanta la apertura del reproductor; nunca altera el segundo estimado ni la calibración.

## Segmentos y periodos

Cada combinación `segmentId + periodo` forma un `syncSegmentId`. P1 y P2 se calibran de forma independiente incluso cuando comparten el mismo vídeo físico. Dos vídeos separados mantienen igualmente calibraciones independientes.

La metadata nueva vive en el agregado `MATCH`:

- `videoCalibrations`: calibración inicial y recalibraciones explícitas.
- `videoSyncChecks`: controles confirmados de la autoauditoría.
- `videoEventOverrides`: posiciones individuales `VERIFIED`, ya existentes.

No hay colección Firestore nueva, cambio de Rules ni migración masiva. Los anchors legacy siguen funcionando: la primera referencia fiable del periodo actúa como calibración inicial; las referencias posteriores diagnostican dispersión, pero no se reinterpretan como recalibraciones.

## Calibración y recalibración

La calibración inicial fija un offset constante para las jugadas `AUTO` del periodo. **RECALIBRAR DESDE AQUÍ** crea un nuevo offset desde ese evento en adelante:

- las jugadas anteriores conservan su posición;
- las jugadas posteriores `AUTO` usan el nuevo tramo;
- los overrides `VERIFIED` nunca se desplazan;
- no existe interpolación entre puntos.

Cambiar la fuente de vídeo, sus periodos o sus anchors invalida los controles afectados. Una recalibración invalida también la comprobación del periodo, que debe repetirse.

## Autoauditoría

Video Lab propone, por cada periodo:

1. una primera jugada LIVE fiable para calibrar;
2. un control próximo a la mitad del tiempo real capturado;
3. un control próximo al tramo final.

La selección se distribuye por `observedAt`, no por número de eventos. Excluye tombstones, pendientes de revisión y jugadas marcadas como anteriores. Cuando la calibración y los dos controles están confirmados muestra `SINCRONIZACIÓN COMPROBADA`.

Confirmar **CORRECTA** persiste la posición actual como `VERIFIED`. **ACCIÓN AQUÍ** guarda el segundo real del reproductor como override individual `VERIFIED/manual`; nunca recalibra por sí sola.

## Jugada anterior

El control `⏱ JUGADA ANTERIOR` de Directo añade `videoTiming = RETROSPECTIVE` al evento que se está capturando. Es una señal exclusivamente audiovisual:

- el evento conserva su `observedAt`, identidad y efecto deportivo;
- sigue computando en replay y estadísticas;
- no se usa como referencia ni recibe estimación `AUTO`;
- Video Lab lo identifica como `VÍDEO PENDIENTE` hasta que el usuario aplica **ACCIÓN AQUÍ**.

## Resolución canónica

Video Lab, Biblioteca, Dashboard y `VER JUGADA` consumen el mismo resolver. La prioridad es:

1. override individual `VERIFIED`;
2. recalibración explícita aplicable por orden canónico;
3. calibración inicial explícita;
4. primera referencia legacy fiable;
5. sin posición automática.

La persistencia local, outbox, hidratación remota y resolución de conflictos transportan conjuntamente segmentos, overrides, calibraciones y controles. Un segundo navegador reconstruye el mismo estado sin modificar el evento deportivo.

## Limitaciones deliberadas

- YouTube continúa siendo la fuente de reproducción; no se usa su API remota.
- No se interpola deriva entre controles.
- Un evento retrospectivo necesita corrección manual para obtener vídeo.
- `SINCRONIZACIÓN COMPROBADA` certifica los puntos recomendados, no analiza visualmente el contenido del vídeo.
