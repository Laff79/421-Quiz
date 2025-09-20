import React from 'react';
import type { Database } from 'firebase/database';
import { ref, update } from 'firebase/database';

type Track = { artist: string; title: string; [k: string]: any };
type RoomState = {
  phase?: 'idle' | 'loading' | 'playing' | 'buzzed' | 'reveal' | 'between' | string;
  currentIndex?: number;
  reveal?: { answerText?: string | null } | null;
};

type GameProps = {
  db: Database;
  roomId: string;
  state: RoomState | null | undefined;
  currentTrack: Track;
};

export default function Game(props: GameProps){
  const { db, roomId, state, currentTrack } = props;

  function formatAnswer(t: Track){
    const a = t?.artist ?? '';
    const ti = t?.title ?? '';
    return `${a} — ${ti}`.trim();
  }

  async function revealAnswer(){
    const answerText = formatAnswer(currentTrack);
    await update(ref(db, `rooms/${roomId}/roomState`), {
      phase: 'reveal',
      reveal: { answerText },
    });
  }

  async function nextTrack(){
    if (state?.phase !== 'reveal') return;
    const nextIndex = (state?.currentIndex ?? 0) + 1;

    // Multi-location update: advance, clear reveal, clear answers
    const updates: Record<string, any> = {};
    updates[`rooms/${roomId}/roomState/phase`] = 'playing';
    updates[`rooms/${roomId}/roomState/currentIndex`] = nextIndex;
    updates[`rooms/${roomId}/roomState/reveal`] = null;
    updates[`rooms/${roomId}/answers`] = null;

    await update(ref(db), updates);
  }

  return (
    <div className="flex items-center gap-2">
      {(state?.phase === 'playing' || state?.phase === 'buzzed') && (
        <button className="btn border rounded px-3 py-2" onClick={revealAnswer}>
          Vis fasit
        </button>
      )}
      <button
        className="btn border rounded px-3 py-2"
        onClick={nextTrack}
        disabled={state?.phase !== 'reveal'}
        title={state?.phase !== 'reveal' ? 'Tilgjengelig etter Vis fasit' : undefined}
      >
        Neste låt
      </button>
    </div>
  );
}
