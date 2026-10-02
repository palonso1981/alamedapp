# Momentum V1

Momentum es una proyección de lectura del partido. No persiste métricas nuevas ni crea un *score* artificial.

## Fuente y semántica

- Solo usa eventos canónicos activos `threat_recorded`.
- CDA (`FOR`) se representa sobre el eje como remates; rival (`AGAINST`), bajo el eje como amenazas.
- La altura es siempre el número exacto de acciones agrupadas por minuto deportivo.
- Cada acción ocupa un único segmento. La prioridad exclusiva es `GOL > ALTO PELIGRO > CERCANA > NORMAL`.
- `CERCANA` utiliza la misma derivación canónica del Dashboard: zonas de origen `Z1`, `Z2` o `Z3`, con orientación según el lado atacante. El corte actual es el 25 % de la pista más próximo a la portería atacada.
- `ALTO PELIGRO` es una acción cercana cuyo resultado va a portería (`PARADA`; un `GOL` entra en la categoría prioritaria GOL).
- Coordenadas ausentes o inválidas no se estiman: la acción queda como `NORMAL`.

Los colores verde/rojo expresan exclusivamente lado e intensidad dentro de Momentum. No sustituyen la semántica espacial de resultado usada en los mapas de portería.

## Tiempo y coincidencia de jugadores

Los intervalos se reconstruyen con `replayMatch`, alineaciones y sustituciones. Con varios jugadores solo se resalta la intersección en que todos están simultáneamente en pista; el resto de la cronología permanece visible y atenuado.

El reloj deportivo persistido tiene precisión de minuto. Momentum no fabrica segundos a partir de `createdAt` u `observedAt`; por ello la coincidencia se muestra con esa precisión. Si el modelo incorpora segundos deportivos fiables en el futuro, el componente puede consumirlos sin cambiar su semántica.

## Selector y exportación

Momentum analiza exactamente un partido. Si el scope global contiene uno, lo adopta; con cero o varios, mantiene un selector interno que no cambia los filtros globales.

La exportación genera un PNG local con partido, marcador, filtros, selección de jugadores, gráfica y leyenda. Usa compartir nativo cuando admite ficheros y descarga el PNG como fallback. No necesita backend ni publica datos.

