# APP ALAM V2.9 · Índice de vídeo y revisión de jugadas

## Propósito y límites

APP ALAM funciona como un **índice inteligente entre eventos deportivos y vídeos externos de YouTube**. No aloja, descarga, reproduce, recorta ni procesa vídeo. Tampoco utiliza YouTube API, API keys, OAuth, tokens, cookies ni consulta metadata del proveedor.

La relación es siempre `matchId + eventId → segmento compatible → posición aproximada → enlace externo`. El vídeo permanece en YouTube y sus permisos, privacidad y disponibilidad dependen de ese proveedor.

## Segmentos por partido

`MatchSession.videoSegments` contiene cero o más segmentos opcionales. Cada `MatchVideoSegment` tiene:

- identidad estable, `provider: YOUTUBE` y `videoId`;
- nombre humano editable (`label`), sin efecto deportivo ni analítico;
- cobertura mediante `periods`: P1, P2 o ambas partes;
- margen `leadSeconds`, 6 segundos por defecto;
- cero o más anchors `{ id, eventId, videoSecond }`;
- horas de creación y actualización de la metadata.

Los nombres predeterminados son `1ª parte`, `2ª parte` y `Partido completo`. Pueden editarse, por ejemplo, a `P2 cámara grada`.

El modelo permite:

- URL A para P1 y URL B para P2;
- un único segmento continuo para P1+P2;
- el mismo `videoId` en dos segmentos lógicos, con anchors independientes;
- varios segmentos con el mismo vídeo para representar cortes reales.

No existen campos rígidos `videoP1`/`videoP2`, ni URLs o timestamps duplicados en cada evento. Cambiar el `videoId` invalida los anchors del segmento previa confirmación. Eliminar un segmento elimina solo metadata de vídeo: no modifica partido, eventos, replay ni analytics.

## YouTube y tiempos introducidos

Se aceptan un ID de vídeo válido y URLs `youtube.com/watch`, `youtu.be`, `shorts`, `embed` y `live`. Un parámetro `t=` se ignora al obtener la identidad; la posición temporal procede exclusivamente de anchors.

Los tiempos de anchor admiten `m:ss` y `h:mm:ss`, incluidos `0:11`, `08:47`, `20:39` y `1:02:15`. Se rechazan componentes de segundos/minutos inválidos.

## Fiabilidad temporal

`createdAt` es la hora real original de captura y no es un segundo del reloj deportivo. Editar o revisar un evento LIVE no lo modifica. El minuto deportivo continúa siendo únicamente `period + minute + order` y nunca se inventan segundos deportivos.

`isVideoTimeResolvable` solo considera utilizable un evento con procedencia `LIVE` y `createdAt` válido. Una creación posterior `MANUAL_REVIEW`, una importación o un evento sin procedencia fiable muestran `SIN POSICIÓN DE VÍDEO`; no se genera un enlace falso. Una edición posterior de un evento nacido LIVE conserva su procedencia y sigue siendo resoluble.

Con una anchor, el cálculo central es:

```text
posición estimada = segundo anchor + (createdAt evento - createdAt evento anchor) / 1000
apertura = max(0, posición estimada - leadSeconds)
```

Con varias anchors se usa la mediana de los offsets, una solución simple y auditable. Si los offsets son coherentes se informa de sincronía coherente; si su dispersión supera el umbral se marca `REVISAR SINCRONIZACIÓN`. APP ALAM no corrige anchors automáticamente ni promete precisión frame-perfect.

El margen de 6 segundos compensa de forma aproximada el retraso humano de captura. En una prueba real, eventos separados más de 12 minutos presentaron una desviación aproximada de 1 segundo entre reloj de captura y eje temporal del vídeo; otras predicciones quedaron aproximadamente a 0–3 segundos. Este resultado es evidencia de uso, no una garantía.

## Configuración por partido

La entrada principal es `/partidos`: cada partido dispone de su acción `VÍDEO`. La pantalla `/partidos/[matchId]/video` muestra primero todos sus segmentos y mantiene visible `+ AÑADIR VÍDEO`; no existe una nube global de partidos.

Cada segmento presenta proveedor, cobertura, nombre, lead, número de anchors y estado. Puede editarse, eliminarse, probarse y añadir/corregir anchors. Un vídeo sin anchor se conserva como `SINCRONIZACIÓN PENDIENTE` y no ofrece un enlace de jugada.

El selector de anchors prioriza visualmente goles como recomendados, sin impedir elegir otras acciones LIVE reconocibles. La hora de captura se muestra separada del periodo/minuto para ayudar a identificar la acción.

## Eventos y revisión

`resolveEventVideoPosition` es el único resolver. Devuelve un estado estructurado: resuelto, sin vídeo, pendiente de sincronización o sin posición fiable. La URL profunda se calcula solo para el evento visible o consultado y abre YouTube unos segundos antes.

`VER EVENTO` conserva siempre la trazabilidad exacta por `matchId + eventId`. `VER EN YOUTUBE` es una acción adicional en Revisión, cronología y trazas del Dashboard; no sustituye la identidad del evento ni se añade a KPIs agregados.

`/dashboard/jugadas` reutiliza el mismo scope y motor de filtros del Dashboard. Permite revisar, entre otras intersecciones:

- goles CDA por jugador;
- paradas ante amenaza rival por portero funcional y fase;
- pérdidas por jugador;
- competición, rival, sede, periodo, contexto Clave/Oro, P-J, estado del marcador, fase y outcome.

El listado muestra partido, fecha, periodo, minuto, acción y estado de vídeo. Los filtros rápidos de tipo/persona se aplican encima del scope compartido, no forman un segundo motor analítico.

## Compartir por WhatsApp

`COPIAR PARA WHATSAPP` genera texto plano con contexto y URLs profundas completas. No utiliza la API de WhatsApp. Si Clipboard API falla, ofrece un textarea seleccionable. Una acción sin enlace se declara como `SIN VÍDEO` y se resume; nunca se inventa una URL.

## Persistencia, offline e históricos

Los segmentos son metadata opcional y versionada del partido. Recorren `LocalRepository → outbox → RemoteRepository/Firestore` como actualización de `MATCH`. Anchors y segmento no son eventos deportivos. No se almacenan blobs, vídeo ni URLs derivadas.

Partidos anteriores sin `videoSegments` cargan como una lista vacía. Si hoy se añade un vídeo y una anchor a un partido histórico, los enlaces de sus eventos LIVE aparecen automáticamente sin mutarlos. La configuración puede realizarse offline y sincronizarse mediante el outbox; abrir YouTube requiere internet y el vídeo no se cachea.

## Limitaciones conocidas

- La captura humana puede producirse antes o después de la acción.
- El lead de 6 segundos es un margen configurable, no una corrección exacta.
- Los eventos sin timestamp/procedencia fiable no tienen posición estimada.
- Los cortes o discontinuidades reales requieren otro segmento lógico.
- No se inspecciona la duración ni la continuidad del vídeo mediante API.
- La privacidad, permisos y disponibilidad dependen de YouTube.
- V2.9 no incluye player propio, descarga, upload, generación de clips ni almacenamiento audiovisual.

## Siguiente etapa

Tras la prueba real de V2.9, el siguiente bloque recomendado es Release Candidate / Producción: autenticación final, roles, reglas productivas, hosting, backups y endurecimiento operativo. No forma parte de esta iteración.
