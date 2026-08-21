import { create } from 'zustand';
import { MatchEvent } from '../types';

// Tipos temporales para nuestros jugadores (hasta que los traigamos de Firebase)
export interface Player {
  id: string;
  name: string;
  number: number;
}

interface MatchState {
  minute: number;
  events: MatchEvent[];
  playersOnCourt: Player[];
  bench: Player[];
  addEvent: (event: Omit<MatchEvent, 'id' | 'timestamp'>) => void;
  incrementMinute: () => void;
  swapPlayer: (outId: string, inId: string) => void;
}

export const useMatchStore = create<MatchState>((set) => ({
  minute: 1, // Empezamos en el minuto 1
  events: [],
  
  // Estado inicial ficticio para poder maquetar la interfaz
  playersOnCourt: [
    { id: 'p1', name: 'Mario', number: 10 },
    { id: 'p2', name: 'Pablo', number: 7 },
    { id: 'p3', name: 'Lucas', number: 4 },
    { id: 'p4', name: 'Hugo', number: 5 },
    { id: 'p5', name: 'Dani (P)', number: 1 }
  ],
  bench: [
    { id: 'p6', name: 'Alex', number: 11 },
    { id: 'p7', name: 'Marcos', number: 8 },
    { id: 'p8', name: 'Leo', number: 9 }
  ],
  
  addEvent: (eventData) => set((state) => ({
    events: [
      ...state.events,
      {
        ...eventData,
        id: crypto.randomUUID(),
        timestamp: Date.now(), // ADR-04: Timestamp en milisegundos para desempatar acciones
      }
    ]
  })),
  
  incrementMinute: () => set((state) => ({ minute: state.minute + 1 })),

  // Función crítica: Intercambia un jugador y guarda el evento en la cronología
  swapPlayer: (outId, inId) => set((state) => {
    const playerOut = state.playersOnCourt.find(p => p.id === outId);
    const playerIn = state.bench.find(p => p.id === inId);

    if (!playerOut || !playerIn) return state; // Medida de seguridad

    // Generamos el evento de sustitución para el timeline
    const substitutionEvent = {
      id: crypto.randomUUID(),
      matchId: 'actual', 
      type: 'substitution' as any, // Forzamos tipo temporalmente para evitar errores estrictos de TS
      minute: state.minute,
      timestamp: Date.now(),
      playerId: outId, // El jugador que sale
      playerInId: inId // El jugador que entra
    };

    return {
      playersOnCourt: [...state.playersOnCourt.filter(p => p.id !== outId), playerIn],
      bench: [...state.bench.filter(p => p.id !== inId), playerOut],
      events: [...state.events, substitutionEvent]
    };
  })
}));