# Directo local: jerarquía UX y secuencias de amenazas

## Evidencia histórica para la jerarquía de fases

Fuente analizada: `docs/stats/BBDD_amenazas_CD_Alameda_2024-26_.xlsx`, hoja
`Amenazas`.

- 1.585 amenazas de 51 partidos entre 2024-25 y 2025-26.
- POSICIONAL: 609 (38,4%).
- TRANSICIÓN: 281 (17,7%).
- PORTERO JUGADOR: 169 (10,7%).
- PENALTI: 4 (0,3%).
- DOBLE PENALTI: 12 (0,8%).
- ABP agregada: 507 (32,0%).

El subtipo de ABP solo está informado de manera consistente en 2025-26. En
las 250 ABP desglosadas de esa temporada aparecen BANDA 129 (51,6%), CÓRNER
88 (35,2%) y FALTA 33 (13,2%). Las 257 ABP de 2024-25 no tienen subtipo, por
lo que esos porcentajes sirven para ordenar la interfaz, pero no para estimar
con precisión la frecuencia global de cada subtipo.

La primera jerarquía UX queda deliberadamente en tres niveles:

1. Acceso máximo: POSICIONAL y TRANSICIÓN.
2. Acceso intermedio: BANDA, CÓRNER, FALTA y PORTERO-JUGADOR.
3. Acceso compacto: PENALTI y DOBLE PENALTI.

La jerarquía es configuración de presentación, no una regla deportiva ni una
restricción del modelo. Las ocho fases siguen disponibles y podrán cambiar de
peso sin migrar eventos históricos.

## Disciplina y estado numérico

Una tarjeta y una modificación de alineación son hechos distintos. Una roja
propia genera siempre un `card_recorded`. Solo cuando el operador confirma que
la acción reduce el quinteto se añade, en el mismo comando reversible, una
`substitution` desde el jugador en pista hacia `slot:inferiority`.

Esto permite registrar tarjetas a jugadores de pista o banquillo sin deducir
automáticamente una inferioridad. El replay deriva disciplina de las tarjetas
y el estado numérico exclusivamente de las sustituciones.

## Contrato de secuencias y segunda jugada

Una segunda amenaza originada por un rechace o balón vivo no es una novena
fase. Continúa conservando su propia fase táctica y se relaciona causalmente
con la amenaza anterior mediante dos campos opcionales del evento:

- `sequenceId`: identificador estable de toda la cadena. En una amenaza raíz
  coincide con el `id` de esa amenaza.
- `parentEventId`: `id` de la amenaza inmediatamente anterior que provoca la
  continuación.

Una amenaza independiente tiene `sequenceId = id` y no tiene
`parentEventId`. Una continuación hereda `sequenceId` y referencia a su padre.
El replay valida que el padre:

- exista y sea otra amenaza;
- pertenezca al mismo partido;
- esté cronológicamente antes que la continuación;
- pertenezca a la misma secuencia.

El vínculo se conserva aunque el padre tenga soft delete, porque la identidad
inmutable del evento sigue existiendo en la cronología. Reordenar una
continuación antes de su causa se rechaza por integridad.

La futura UX podrá ofrecer “segunda jugada” tras una parada/rechace y crear el
nuevo evento con estos campos. Amenazas ofensivas y defensivas deben reutilizar
el mismo contrato, lo que permitirá reconstruir cadenas, medir conversiones
tras rechace y mostrar una secuencia como unidad visual sin reinterpretar la
fase original.
