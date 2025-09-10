// src/state/gameStore.ts
// Minimal fix: write per-player under /lobby/players/{playerId} and NEVER set() the whole /players node.
import { db } from "../lib/firebase";
import { ref, get, set, update, runTransaction } from "firebase/database";

export type RoundState = "idle" | "running" | "buzzed" | "review";

export interface Player {
  id: string;
  name: string;
  score: number;
  joinedAt: number;
  online?: boolean;
}

export interface Round {
  state: RoundState;
  startedAt?: number;
  pointsNow?: 1 | 2 | 4;
  buzz?: { playerId: string; at: number; frozenPoints: 1 | 2 | 4 } | null;
  correctPlayerId?: string | null;
  lastEventAt?: number;
}

// === FIXED: Only touch the /round subtree when starting/advancing rounds. Do not clear lobby/players. ===
export async function startRound(sessionId: string) {
  const startedAt = Date.now();
  await set(ref(db, `/sessions/${sessionId}/round`), {
    state: "running",
    startedAt,
    pointsNow: 4,
    buzz: null,
    correctPlayerId: null,
    lastEventAt: Date.now(),
  } as Round);
}

export function pointsFromStart(startedAt: number): 1 | 2 | 4 {
  const elapsed = Math.floor((Date.now() - startedAt) / 1000);
  if (elapsed < 20) return 4;
  if (elapsed < 40) return 2;
  return 1;
}

export async function markCorrect(sessionId: string) {
  const rRef = ref(db, `/sessions/${sessionId}/round`);
  const snap = await get(rRef);
  const round = (snap.val() as Round) || { state: "idle" };
  if (!round.buzz?.playerId) return;
  const playerId = round.buzz.playerId;
  const pts = round.buzz.frozenPoints || 1;
  const pScoreRef = ref(db, `/sessions/${sessionId}/lobby/players/${playerId}/score`);
  await runTransaction(pScoreRef, (cur) => (cur || 0) + pts);
  await update(rRef, { correctPlayerId: playerId, state: "review", lastEventAt: Date.now() });
}

export async function nextQuestion(sessionId: string) {
  await set(ref(db, `/sessions/${sessionId}/round`), { state: "idle", lastEventAt: Date.now() });
}

// === FIX: Never overwrite /players. Upsert individual player under /players/{playerId}. ===
export async function ensurePlayer(sessionId: string, playerId: string, name: string) {
  const pRef = ref(db, `/sessions/${sessionId}/lobby/players/${playerId}`);
  await runTransaction(pRef, (current: any) => {
    if (current && typeof current === "object") {
      return { ...current, name, online: true }; // keep score etc.
    }
    return {
      id: playerId,
      name,
      score: 0,
      joinedAt: Date.now(),
      online: true,
    } as Player;
  });
}

// Optional helper if you somewhere had code like set('/players', {...}) — DO NOT use that.
// Instead call: await upsertPlayers(sessionId, { [playerId]: playerObject });
export async function upsertPlayers(sessionId: string, playersMap: Record<string, Partial<Player>>) {
  // Merges keys without nuking siblings.
  await update(ref(db, `/sessions/${sessionId}/lobby/players`), playersMap);
}
