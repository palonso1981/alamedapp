# Vídeo V2.9.2 · apertura determinista

AlamedAPP separa la posición real de una acción de la posición desde la que se abre el reproductor. Un anchor o un override guarda `videoSecond`; `VER JUGADA` deriva `openSecond = max(0, videoSecond resuelto - leadSeconds)`.

Las aperturas precisas navegan a la ruta interna `/video/player?videoId={videoId}&start={openSecond}`. Esa página de AlamedAPP aloja un `iframe` oficial con `youtube.com/embed/{videoId}?start={openSecond}&autoplay=1`; nunca se navega directamente al documento `/embed`. El iframe declara `strict-origin-when-cross-origin`, por lo que la petición conserva el origen HTTPS de AlamedAPP como referencia sin revelar la ruta completa. Esto aísla el salto del progreso recordado por la sesión normal de youtube.com. YouTube puede ajustar el inicio al fotograma clave más cercano, por lo que no existe garantía de precisión de fotograma.

Las acciones quedan diferenciadas:

- `VER JUGADA`: abre el `openSecond` calculado en el reproductor aislado.
- `PROBAR` durante un ajuste manual: prueba el mismo resultado que tendrá `VER JUGADA`, incluido el margen.
- `PROBAR` junto a un anchor: abre exactamente el `videoSecond` escrito para ese anchor, sin margen.
- `VER EN YOUTUBE` desde el reproductor de una jugada: usa `watch?v={videoId}&t={openSecond}s`; comparte el mismo `openSecond` del player interno, aunque el comportamiento posterior queda sujeto a YouTube.
- `ABRIR EN YOUTUBE` desde un segmento base: usa `watch?v={videoId}`, sin anchor, override ni margen.

Si una jugada no tiene resolución temporal válida, no se genera una URL precisa ni se inventa un segundo. La resolución siempre conserva la identidad completa del `videoId` y utiliza únicamente el segmento compatible elegido por cobertura o por override.

La ruta interna exige un ID de YouTube exacto de 11 caracteres y un segundo entero no negativo. Ante parámetros ausentes o inválidos muestra un error y no crea un tiempo alternativo. Los enlaces copiados para compartir convierten la ruta interna en una URL absoluta de la instalación actual.

No se modifican eventos deportivos, anchors, overrides, `leadSeconds`, sincronización ni estructura Firestore.
