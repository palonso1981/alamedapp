"use client";

import { useState } from 'react';
import { db } from '../../../../lib/firebase';
import { collection, addDoc } from 'firebase/firestore';
import { useMatchStore } from '../../../../store/useMatchStore';

export default function DirectoPage({ params }: { params: { id: string } }) {
  // Traemos toda la "inteligencia" de nuestro store
  const { 
    minute, events, playersOnCourt, bench, 
    addEvent, incrementMinute, swapPlayer 
  } = useMatchStore();

  // Estado local para saber a qué jugador hemos tocado para salir
  const [playerOutId, setPlayerOutId] = useState<string | null>(null);

  // Mantenemos tu función original para seguir enviando goles a Firebase
  const registrarGol = async (jugadorId: string, nombre: string) => {
    addEvent({ matchId: params.id, type: 'goal', minute: minute, playerId: jugadorId });
    try {
      await addDoc(collection(db, "match_events"), {
        matchId: params.id, type: 'goal', minute: minute,
        playerId: jugadorId, playerName: nombre, timestamp: Date.now()
      });
    } catch (e) {
      console.error("Error en Firebase:", e);
    }
  };

  return (
    <div className="p-4 flex flex-col h-screen bg-gray-900 text-white font-sans overflow-hidden">
      {/* CABECERA */}
      <header className="flex justify-between items-center mb-4 border-b border-gray-700 pb-2 shrink-0">
        <h1 className="text-xl font-bold">Directo: CD Alameda</h1>
        <div className="flex items-center gap-4">
          <span className="text-3xl font-mono text-green-400">{minute}&apos;</span>
          <button onClick={incrementMinute} className="bg-gray-700 px-3 py-1 rounded text-sm hover:bg-gray-600 transition-colors">
            +1 Min
          </button>
        </div>
      </header>

      {/* CUERPO PRINCIPAL (PISTA Y BANQUILLO) */}
      <main className="flex-1 flex flex-col gap-4 overflow-hidden">
        
        {/* PISTA */}
        <div className="bg-gray-800 p-4 rounded-xl flex-1 flex flex-col">
          <h2 className="text-gray-400 text-sm font-bold uppercase mb-3">
            En Pista (Toca a un jugador para cambiarlo)
          </h2>
          {/* Grid automático que pinta a los 5 jugadores activos */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 flex-1">
            {playersOnCourt.map(p => (
              <div 
                key={p.id}
                onClick={() => setPlayerOutId(playerOutId === p.id ? null : p.id)}
                className={`p-3 rounded-xl flex flex-col justify-between cursor-pointer transition-all duration-200 border-2 ${
                  playerOutId === p.id 
                    ? 'bg-yellow-600 border-yellow-300 shadow-[0_0_15px_rgba(202,138,4,0.5)]' 
                    : 'bg-slate-700 border-slate-600 hover:bg-slate-600'
                }`}
              >
                <span className="font-bold text-lg">{p.number}. {p.name}</span>
                <div className="flex justify-between items-end mt-4">
                  <span className="text-xs text-gray-300 uppercase tracking-wider">Activo</span>
                  {/* Botón de gol aislado para no activar la sustitución */}
                  <button 
                    onClick={(e) => { e.stopPropagation(); registrarGol(p.id, p.name); }}
                    className="bg-blue-600 hover:bg-blue-500 px-3 py-1.5 rounded-lg text-sm font-bold shadow-md transition-colors"
                  >
                    ⚽ Gol
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* BANQUILLO */}
        <div className="bg-gray-800 p-4 rounded-xl shrink-0">
          <h2 className="text-gray-400 text-sm font-bold uppercase mb-3 flex items-center justify-between">
            {playerOutId ? (
              <span className="text-yellow-400 animate-pulse">👇 Toca a su sustituto</span>
            ) : (
              <span>Banquillo</span>
            )}
          </h2>
          <div className="flex overflow-x-auto gap-3 pb-2">
            {bench.map(p => (
              <button
                key={p.id}
                onClick={() => {
                  if (playerOutId) {
                    swapPlayer(playerOutId, p.id); // ¡Magia! Se ejecuta el cambio
                    setPlayerOutId(null); // Reseteamos la selección
                  }
                }}
                disabled={!playerOutId}
                className={`min-w-[120px] p-4 rounded-xl font-bold border-2 text-left transition-all duration-200 ${
                  playerOutId 
                    ? 'bg-slate-700 border-green-500 hover:bg-green-600/30 cursor-pointer shadow-lg' 
                    : 'bg-slate-800 border-slate-700 text-slate-500 opacity-50 cursor-not-allowed'
                }`}
              >
                {p.number}. {p.name}
              </button>
            ))}
          </div>
        </div>
      </main>

      {/* TIMELINE DE EVENTOS */}
      <footer className="mt-4 p-3 bg-gray-800 rounded-xl overflow-x-auto whitespace-nowrap h-20 flex items-center gap-3 shrink-0">
        {events.length === 0 && <span className="text-sm text-gray-500 italic">Los eventos aparecerán aquí...</span>}
        {events.map((ev) => (
          <div key={ev.id} className="bg-slate-700 px-3 py-2 rounded-lg text-sm shrink-0 flex items-center shadow-sm">
            <span className="font-bold text-green-400 mr-2">{ev.minute}&apos;</span>
            {ev.type === 'goal' && <span>⚽ Gol (ID: {ev.playerId})</span>}
            {(ev.type as string) === 'substitution' && <span>🔄 Cambio</span>}
          </div>
        ))}
      </footer>
    </div>
  );
}