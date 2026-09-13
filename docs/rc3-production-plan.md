# RC3 · Plan de producción, continuidad y piloto

Estado: **solo diseño**. Este documento no crea Firebase PROD, no despliega Hosting/Rules, no exporta ni importa datos y no migra DEV.

## Principios y orden recomendado

1. Acordar ownership institucional y responsables de recuperación.
2. Definir configuración DEV/PROD y guardas duras contra proyectos cruzados.
3. Crear Firebase PROD limpio bajo cuenta del club.
4. Desplegar y probar Auth, Rules e índices en un entorno vacío.
5. Implementar y ensayar backup **y restore** lógico sobre datos desechables.
6. Inventariar DEV en lectura y construir export selectivo de Chelva.
7. Validar el bundle sin escribir PROD; después importar una sola vez con informe de colisiones.
8. Preparar Hosting/PWA y seguridad de actualización.
9. Ejecutar piloto alojado, incluida la prueba multidispositivo pendiente de RC2.
10. Solo tras validar recuperación, permisos y operación, plantear V1.0.

Riesgos principales: elegir accidentalmente el proyecto equivocado, reglas divergentes, IDs colisionados, pérdida de datos locales pendientes, restore no probado, actualización de PWA durante captura, dependencia de una cuenta personal y reinterpretación incorrecta de coordenadas históricas.

## A. Firebase PROD limpio

- Crear un proyecto diferente de `cdalameda-dev`, sin copiar documentos de forma implícita.
- Registrar el `projectId` esperado en cada herramienta y abortar si no coincide exactamente.
- Empezar sin fixtures, códigos DEV, sesiones, leases, outbox ni conflictos.
- Mantener Spark: sin Functions, Firebase Storage ni export administrado que requiera billing.

## B. Configuración DEV / PROD

- Dos juegos de variables locales/hosting, nunca valores Firebase hardcodeados.
- Mostrar el entorno de forma inequívoca en administración y logs técnicos.
- Scripts de export/import con `--source-project` y `--target-project` explícitos, allowlist y confirmación de inventario; nunca depender solo de un alias CLI.
- Prohibir que una build PROD acepte `cdalameda-dev`, y que tooling DEV acepte el futuro ID PROD para operaciones destructivas.

## C. Firestore Rules, índices y Auth

- Partir de las Rules versionadas, revisarlas como política PROD y probarlas contra Authentication y AccessSession reales.
- Mantener scope por club/equipo, VIEWER sin escrituras, Access sin list público, leases con get exacto y sin hard delete.
- Versionar índices requeridos por consultas de matches/catálogos y verificarlos antes del piloto.
- Anonymous Auth puede sostener el modelo técnico V1, pero debe documentarse su recuperación, revocación y ciclo de vida; no equivale a identidad personal.

## D. Cloudinary PROD

- Usar un cloud/preset/carpeta lógicamente separados de DEV y credenciales restringidas por entorno.
- Firestore conserva referencias/metadata, no binarios.
- El backup debe inventariar public IDs, URLs, versión y entidad propietaria. Restore debe detectar referencias ausentes y reportarlas sin romper la entidad deportiva.

## E. Backup lógico y restore

El formato debe ser legible, versionado, determinista y compatible con Spark. Alcance:

- `clubs/{clubId}`;
- players y staff maestros;
- teams, seasons y memberships de jugadores/staff;
- `matches/{matchId}` y `matches/{matchId}/events/{eventId}`;
- segmentos de vídeo, anchors/overrides y demás metadata incluida en match;
- Access profiles/mappings/sesiones solo como metadata hash/versionada, **nunca códigos plaintext**;
- referencias Cloudinary.

Los leases activos, outbox y conflictos locales no forman parte del backup deportivo remoto ordinario: son estado operativo/por dispositivo. Antes de backup o migración debe comprobarse outbox cero; cualquier recovery bundle pendiente se custodia aparte.

Restore no es “volver a subir JSON”. Debe:

1. validar `schemaVersion`, checksums, IDs y referencias antes de escribir;
2. operar contra un projectId explícito y un club permitido;
3. ofrecer dry-run con altas, coincidencias, colisiones y referencias ausentes;
4. conservar IDs y crear/update solo según política seleccionada, sin hard delete;
5. ser idempotente mediante clave de ejecución/documento y revisión esperada;
6. ordenar padres antes que hijos y eventos después del match;
7. verificar recuentos y hashes lógicos tras restaurar;
8. generar informe firmado/fechado y permitir una segunda restauración de prueba.

Debe ensayarse export + restore completo en un proyecto vacío de pruebas antes de considerarlo backup operativo. Las herramientas administradas de Firestore que requieran billing no son dependencia de este plan.

## F. Bundle selectivo Chelva

Forma lógica adaptada al modelo actual:

```ts
interface ChelvaBundle {
  schemaVersion: 1;
  kind: "ALAMEDAPP_CHELVA_EXPORT";
  exportedAt: number;
  sourceProjectId: "cdalameda-dev";
  club: ClubProfile;
  team: TeamProfile;
  season: Season | null;
  match: MatchSession;
  events: MatchEvent[];
  referencedPlayers: MasterPlayer[];
  relevantPlayerMemberships: SeasonPlayer[];
  relevantStaff: MasterStaffMember[];
  relevantStaffMemberships: SeasonStaff[];
  videoMetadata: {
    segments: MatchVideoSegment[];
    eventOverrides: MatchVideoEventOverride[];
  };
  integrity: {
    matchId: string;
    eventIds: string[];
    playerIds: string[];
    warnings: string[];
  };
}
```

El export selecciona el partido Chelva por `matchId` confirmado, toma todos sus eventos y calcula referencias reales por ID desde convocatoria, alineaciones, sustituciones, autorías, asistencias, porteros, faltas y tarjetas. Incluye únicamente memberships/staff necesarios para reconstruir esas referencias y el contexto del partido. La lista exacta se valida contra el schema vigente al implementar.

Excluye `accessCodes`, `accessSessions`, Access profiles operativos, `matchCaptureLeases`, analytics de uso, outbox/conflictos DEV, fixtures, otros partidos y entidades test no referenciadas.

## G. Import selectivo Chelva e identidades

- Conservar `matchId`, todos los `eventId`, `playerId` y las referencias causales (`sequenceId`, `parentEventId`).
- Conservar `clubId`, `teamId` y `seasonId` cuando el destino no colisione y represente la misma entidad. Una colisión se detiene y se documenta; no se remapea por nombre.
- No generar IDs nuevos por conveniencia ni identificar jugadores por nombre/dorsal.
- Importar padres, maestros, memberships, match y eventos en ese orden; dry-run obligatorio.
- Tras importar, nombres, fotos, dorsales y datos incompletos se corrigen sobre los mismos IDs mediante la aplicación.
- Verificar recuentos, replay, marcador, cronología, referencias, vídeo y revisión antes de aceptar el resultado.

### Coordenadas legacy

Chelva se capturó antes de cerrar la orientación canónica. El bundle conserva coordenadas raw y versión geométrica disponible. El import no gira, refleja ni “corrige” por heurística. Se añade una advertencia histórica visible en auditoría; esto no invalida jugadores, resultado, eventos, cronología, vídeo, cambios o goles fiables.

## H. Hosting, PWA y prueba real

- Elegir hosting HTTPS accesible desde tablet/móvil y configurar solamente variables PROD aprobadas.
- Verificar rutas dinámicas, offline shell, caché, iconos, instalación y recuperación después de cierre.
- Repetir primero en entorno alojado la prueba RC2 pendiente: A lease → A offline con eventos → B takeover y eventos → A reconnect → mismatch, payload/export preservados y cronología B intacta.
- Probar además dos partidos simultáneos, revocación y reapertura en dos dispositivos físicos.

## I. Seguridad de actualización

Una nueva versión no debe forzar reload mientras haya captura activa, modo offline, outbox enviable o recovery/conflictos sin atender. Diseño RC3/RC4:

- detectar versión nueva sin recargar automáticamente;
- posponer activación del service worker y mostrar aviso no intrusivo;
- bloquear `skipWaiting`/reload automático con lease activo u outbox pendiente;
- permitir actualizar cuando sync está a cero y el lease se ha liberado;
- conservar compatibilidad de schema local durante al menos una versión y probar upgrade/reapertura.

No se implementa en este cierre; antes de PWA debe auditarse cualquier mecanismo actual de auto-update.

## J. Ownership institucional y piloto

- Firebase PROD y Cloudinary PROD deben quedar administrables por cuentas institucionales del club, con al menos dos responsables y recuperación documentada.
- El mantenedor técnico puede conservar acceso delegado/revocable; no debe ser propietario único.
- Los códigos internos de APP ALAM autorizan funciones del producto, pero no sustituyen propiedad ni permisos de las consolas Firebase/Cloudinary.
- Mantener inventario de responsables, MFA, dominios, facturación (aunque sea Spark), rotación y baja.

El piloto previo a V1.0 debe incluir checklist de dispositivo, batería/red, operador suplente, backup previo, sync cero inicial/final, prueba de recuperación y registro de incidencias. No se promociona a V1.0 hasta completar restore probado y la validación alojada multidispositivo.
