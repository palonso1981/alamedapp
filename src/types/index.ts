export interface Player {
  id: string;
  name: string;
  number: number;
  pin: string; // Para el login ágil sin email (ADR-05)
}

export interface Match {
  id: string;
  date: string;
  opponent: string;
  homeScore: number;
  awayScore: number;
  isSuperiority: boolean; // Toggle de asimetría (ADR-03)
  status: 'pending' | 'ongoing' | 'finished';
}

export interface MatchEvent {
  id: string;
  matchId: string;
  type: 'sub_in' | 'sub_out' | 'goal' | 'foul' | 'timeout';
  minute: number;
  timestamp: number; // Para desempatar acciones súper rápidas (ADR-04)
  playerId?: string; // Opcional porque un tiempo muerto no es de un jugador
}