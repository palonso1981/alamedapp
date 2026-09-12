import { ActiveAccessGrant } from "./accessDomain";

let runtimeGrant: ActiveAccessGrant | null | undefined;

export function setRuntimeAccessGrant(grant: ActiveAccessGrant | null): void {
  runtimeGrant = grant;
}

/** undefined mantiene compatibilidad con tests y tareas puras sin shell de aplicación. */
export function getRuntimeAccessGrant(): ActiveAccessGrant | null | undefined {
  return runtimeGrant;
}

export function resetRuntimeAccessGrantForTests(): void {
  runtimeGrant = undefined;
}
