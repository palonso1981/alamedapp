# Vídeo V2.9.2 · apertura determinista

AlamedAPP separa la posición real de una acción de la posición desde la que se abre el reproductor. Un anchor o un override guarda `videoSecond`; `VER JUGADA` deriva `openSecond = max(0, videoSecond resuelto - leadSeconds)`.

Para V1, las aperturas precisas navegan directamente a la página normal de YouTube mediante `watch?v={videoId}&t={second}s`. AlamedAPP genera siempre el segundo correcto, aunque YouTube puede aplicar después su propio comportamiento de reproducción o historial de sesión. No se mantiene un reproductor interno paralelo.

Las acciones quedan diferenciadas:

- `VER JUGADA`: abre en YouTube el `openSecond` calculado.
- `PROBAR` durante un ajuste manual: prueba el mismo resultado que tendrá `VER JUGADA`, incluido el margen.
- `PROBAR` junto a un anchor: abre exactamente el `videoSecond` escrito para ese anchor, sin margen.
- `VER EN YOUTUBE` desde una jugada: usa `watch?v={videoId}&t={openSecond}s`; comparte la misma semántica de `VER JUGADA`.
- `ABRIR EN YOUTUBE` desde un segmento base: usa `watch?v={videoId}`, sin anchor, override ni margen.

Si una jugada no tiene resolución temporal válida, no se genera una URL precisa ni se inventa un segundo. La resolución siempre conserva la identidad completa del `videoId` y utiliza únicamente el segmento compatible elegido por cobertura o por override.

No se modifican eventos deportivos, anchors, overrides, `leadSeconds`, sincronización ni estructura Firestore.
