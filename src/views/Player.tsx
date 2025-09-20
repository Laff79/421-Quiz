import React from 'react';
import type { Database } from 'firebase/database';
import { ref, set, serverTimestamp, onValue } from 'firebase/database';

type RoomState = {
  phase?: 'idle' | 'loading' | 'playing' | 'buzzed' | 'reveal' | 'between' | string;
  reveal?: { answerText?: string | null } | null;
};

type PlayerProps = {
  db: Database;
  roomId: string;
  playerId: string;
  state: RoomState | null | undefined;
};

export default function Player(props: PlayerProps){
  const { db, roomId, playerId, state } = props;
  const [answer, setAnswerText] = React.useState('');
  const [hasSubmitted, setHasSubmitted] = React.useState(false);

  // Keep local flag in sync in case of reconnect/reload
  React.useEffect(() => {
    const myAnsRef = ref(db, `rooms/${roomId}/answers/${playerId}`);
    return onValue(myAnsRef, snap => setHasSubmitted(snap.exists()));
  }, [db, roomId, playerId]);

  const disabled = (state?.phase !== 'playing') || hasSubmitted;

  async function submit(){
    const trimmed = answer.trim();
    if (!trimmed || disabled) return;
    await set(ref(db, `rooms/${roomId}/answers/${playerId}`), {
      text: trimmed,
      ts: serverTimestamp(),
    });
    setHasSubmitted(true);
    setAnswerText('');
  }

  return (
    <div className="p-4 max-w-xl mx-auto">
      {/* REVEAL OVERLAY (full-screen on player device) */}
      {state?.phase === 'reveal' && (
        <div className="fixed inset-0 bg-black/80 grid place-content-center text-center p-6 z-50">
          <div className="text-3xl font-bold uppercase opacity-80">FASIT</div>
          <div className="mt-2 text-4xl sm:text-6xl font-black tracking-tight">
            {state?.reveal?.answerText ?? '—'}
          </div>
        </div>
      )}

      <label className="block mb-2 text-sm opacity-80">Svar</label>
      <div className="flex gap-2">
        <input
          value={answer}
          onChange={e => setAnswerText(e.target.value)}
          onKeyDown={e => { if(e.key === 'Enter') submit(); }}
          placeholder="Skriv svaret og trykk Enter"
          className="input w-full border rounded px-3 py-2"
          disabled={disabled}
          autoFocus
        />
        <button className="btn border rounded px-3 py-2" onClick={submit} disabled={disabled}>
          Send
        </button>
      </div>

      {hasSubmitted && state?.phase === 'playing' && (
        <div className="mt-2 text-sm opacity-80">✅ Svar levert</div>
      )}
      {state?.phase !== 'playing' && (
        <div className="mt-2 text-sm opacity-60">⏳ Avventer neste runde…</div>
      )}
    </div>
  );
}
