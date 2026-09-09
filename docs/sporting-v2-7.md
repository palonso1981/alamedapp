# APP ALAM V2.7 · Pérdidas y estado del marcador

## PÉRDIDA

`possession_lost` es un evento deportivo propio e independiente. Representa un balón que CDA entrega al rival mientras sigue vivo y existe continuidad inmediata: pase interceptado o entregado, robo, mal control o conducción perdida. No representa un remate fuera, un balón que sale, una falta, un gol, un balón muerto ni el final normal de una posesión.

La captura parte siempre de un jugador CDA que está en pista y termina al pulsar **PÉRDIDA**. El evento guarda la identidad estable `matchId + eventId`, `playerId`, `period + minute + order`, `createdAt`, `updatedAt`, procedencia y marca de revisión comunes. No guarda causa, zona, coordenadas, transición ni jugador rival. Portero funcional y portero-jugador pueden ser autores si están en pista.

El evento participa en la cronología, replay, historial, edición, soft delete/restauración, undo/redo, persistencia local, outbox y sincronización como los demás eventos. Editarlo conserva `eventId` y la hora original `createdAt`.

Dashboard deriva, sin agregados persistidos:

- pérdidas de equipo en total, por partido y por 40 minutos observados;
- pérdidas de jugador en total, por partido y por 40 minutos jugados;
- media de plantilla calculada primero por jugador, excluyendo valores `N/D`;
- comparación A/B con dirección semántica `LOWER_IS_BETTER`.

La métrica no modifica **Score ALAM** en V2.7.

### Disponibilidad histórica

El modelo previo no guardaba una capacidad/versionado que permita distinguir de forma fiable un partido con cero pérdidas reales de otro en el que la observación todavía no existía. Los partidos anteriores cargan y muestran cero eventos observados, pero ese cero no prueba que no hubiera pérdidas. No se inventa una migración ni una fecha por partido; incorporar una marca explícita de capacidades de captura queda pendiente para una evolución del modelo.

## Estado del marcador

`scoreState` es una dimensión analítica derivada, nunca persistida. Siempre usa la perspectiva CDA:

- `LEADING`: CDA gana;
- `DRAWING`: CDA empata;
- `TRAILING`: CDA pierde;
- `ALL`: sin filtro.

El motor reconstruye intervalos desde los goles ordenados por `period + minute + order`. El partido empieza 0-0, por tanto empatando. Cada evento se clasifica con el marcador inmediatamente anterior: el gol que empata cuando CDA pierde pertenece a **PERDIENDO**, y el gol rival que rompe un empate pertenece a **EMPATANDO**. El nuevo estado rige después de ese evento.

Cuando varios hechos comparten minuto se respeta `order`. Las duraciones continúan en minutos deportivos enteros: dos cambios de marcador dentro del mismo minuto no crean segundos ni fracciones ficticias. La hora real `createdAt` no interviene en esta clasificación.

El filtro avanzado muestra **TODOS / GANANDO / EMPATANDO / PERDIENDO**, se refleja en chips y etiquetas y se serializa de forma independiente como `aScoreState` y `rScoreState`. Una referencia personalizada puede elegir un estado distinto al análisis.

Se intersecta con periodo, competición, sede, rival, jugadores, porteros, mapas, Minutos Clave/Oro y P-J CDA/Rival. Eventos, minutos, tasas por 40, media de plantilla y comparadores se recalculan dentro del intervalo aplicable. Las métricas sin denominador válido mantienen `N/D`; no se fuerzan fórmulas nuevas.

Los intervalos derivados se reutilizan por sesión y periodo durante una construcción del Dashboard para evitar reconstruir el estado del marcador por cada métrica.

## Backlog deliberado

No se implementan en V2.7:

- relación automática pérdida → amenaza rival de transición; una futura inferencia deberá usar cronología y contexto, no una regla ingenua basada en `createdAt`;
- zona o causa de pérdida y recuperación de balón;
- índice de vídeo externo basado en segmentos y anchors `matchId + eventId`;
- formato cromo transversal;
- silueta real del portero;
- radar u otras visualizaciones nuevas.

