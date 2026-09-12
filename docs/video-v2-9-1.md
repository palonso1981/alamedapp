# APP ALAM V2.9.1 · ajuste por evento y listados de vídeo

## Override manual

`MatchSession.videoEventOverrides` es metadata opcional del partido. Cada entrada identifica `eventId + segmentId` y guarda el `videoSecond` real de la acción, además de sus timestamps técnicos de creación/actualización. No guarda URL, `openSecond`, lead ni una copia del `createdAt` deportivo.

El resolver central aplica esta precedencia:

1. override manual válido del evento para un segmento que cubre su periodo;
2. estimación automática mediante segmento y anchors;
3. sin posición.

El segundo introducido es el instante real de la acción. La URL se deriva al abrir o copiar restando el `leadSeconds` del segmento y limitando el resultado a cero. Así, `00:17` con lead 6 abre en `00:11`. El override no se convierte en anchor, no modifica el evento y no desplaza otras jugadas. `VOLVER A AUTOMÁTICO` elimina solo esa entrada y recupera exactamente la estimación por anchors.

Un evento sin `createdAt`/provenance fiable puede resolverse mediante override. Si existen varios segmentos compatibles, la persona elige el segmento lógico; P1 no puede asociarse accidentalmente a uno exclusivo de P2. Cambiar el vídeo físico de un segmento o eliminarlo retira sus overrides para no conservar posiciones referidas a otro vídeo.

## Revisión de jugadas

`/dashboard/jugadas` continúa reutilizando el scope y los filtros deportivos del Dashboard. El universo revisable excluye eventos técnicos de alineación, sustitución y estado, e incluye amenazas, pérdidas, reinicios, faltas y tarjetas. El filtro humano distingue remates/amenazas, goles, paradas, pérdidas, faltas, tarjetas y los eventos canónicos independientes:

- córner CDA / rival;
- banda cercana CDA / rival.

Por tanto, un `restart_recorded` aparece aunque no exista una amenaza posterior con fase de córner o banda; ambos conceptos no se duplican.

Cada fila permite seleccionar una o varias jugadas, seleccionar todas las visibles, copiar la selección o copiar todas las filtradas. El texto para WhatsApp se deriva en runtime con contexto y enlaces completos. Las jugadas no resolubles se declaran como `SIN VÍDEO`; no se inventan URLs ni se persisten playlists/listados.

Dashboard mantiene una acción discreta hacia Revisión y traslada el `analysisScope` mediante los mismos parámetros URL. La selección de filas es efímera.

## Persistencia, acceso y límites

Los overrides viajan como metadata `MATCH` por `LocalRepository → outbox → RemoteRepository`, son compatibles con partidos antiguos y no generan operaciones `EVENT`. La edición puede hacerse offline; abrir YouTube requiere conexión.

ADMIN y EDITOR pueden crear/eliminar overrides. VIEWER puede filtrar, seleccionar, copiar y abrir enlaces, pero no ve la acción de ajuste. El modelo usa las escrituras MATCH ya autorizadas, así que V2.9.1 no cambia `firestore.rules`.

El fixture local de Dashboard muestra el editor a ADMIN/EDITOR únicamente para validación visual, en modo explícitamente solo lectura: permite comprobar timestamp, lead, `PROBAR` y `VOLVER A AUTOMÁTICO`, pero no persiste, no crea outbox y no interviene en producción ni en Firebase.

Fuera de alcance: vídeo almacenado, clips, playlists persistidas, API/OAuth de YouTube, reproductor propio, thumbnails, IA y modificación automática de anchors.
