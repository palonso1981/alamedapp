# Vídeo V2.9.2 · apertura determinista

AlamedAPP separa la posición real de una acción de la posición desde la que se abre el reproductor. Un anchor o un override guarda `videoSecond`; `VER JUGADA` deriva `openSecond = max(0, videoSecond resuelto - leadSeconds)`.

Las aperturas precisas usan la URL oficial de reproductor `youtube.com/embed/{videoId}?start={openSecond}&autoplay=1`. Esto aísla el salto del progreso recordado por la sesión normal de youtube.com. YouTube puede ajustar el inicio al fotograma clave más cercano, por lo que no existe garantía de precisión de fotograma.

Las acciones quedan diferenciadas:

- `VER JUGADA`: abre el `openSecond` calculado en el reproductor aislado.
- `PROBAR` durante un ajuste manual: prueba el mismo resultado que tendrá `VER JUGADA`, incluido el margen.
- `PROBAR` junto a un anchor: abre exactamente el `videoSecond` escrito para ese anchor, sin margen.
- `ABRIR EN YOUTUBE`: usa la URL base `watch?v={videoId}`, sin anchor, override ni margen.

Si una jugada no tiene resolución temporal válida, no se genera una URL precisa ni se inventa un segundo. La resolución siempre conserva la identidad completa del `videoId` y utiliza únicamente el segmento compatible elegido por cobertura o por override.

No se modifican eventos deportivos, anchors, overrides, `leadSeconds`, sincronización ni estructura Firestore.
