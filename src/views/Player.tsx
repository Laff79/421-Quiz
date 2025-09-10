// src/views/Player.tsx
// Minimal fix version: reads session code (?c=12345 or from localStorage) and joins without overwriting other players.
import React, { useEffect, useMemo, useState } from "react";
import { ensurePlayer } from "../state/gameStore";

function uid() {
  const k = localStorage.getItem("playerId");
  if (k) return k;
  const v = Math.random().toString(36).slice(2, 10);
  localStorage.setItem("playerId", v);
  return v;
}

function useSessionId(): string | null {
  const qp = new URLSearchParams(window.location.search);
  const q = qp.get("c") || qp.get("sid") || "";
  const ls = localStorage.getItem("sessionId") || "";
  const sid = q || ls || null;
  useEffect(() => {
    if (q) localStorage.setItem("sessionId", q);
  }, [q]);
  return sid;
}

export default function Player() {
  const [name, setName] = useState(localStorage.getItem("playerName") || "");
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useMemo(uid, []);
  const sessionId = useSessionId();

  async function join() {
    setError(null);
    if (!sessionId) {
      setError("Manglende spillkode i lenka. Be verten sende deg riktig lenke med ?c=XXXXX");
      return;
    }
    const finalName = name.trim() || `Spiller ${id.slice(0,4)}`;
    localStorage.setItem("playerName", finalName);
    try {
      await ensurePlayer(sessionId, id, finalName); // <-- writes ONLY to /players/{id}
      setJoined(true);
    } catch (e:any) {
      setError(e?.message || "Klarte ikke å joine. Prøv igjen.");
    }
  }

  return (
    <div className="container">
      {!joined ? (
        <div className="card">
          <h2>Bli med i spillet</h2>
          <p className="hint">Sjekk at lenka har ?c=KODE (5 siffer). Eksempel: /player?c=12345</p>
          <input
            placeholder="Ditt navn"
            value={name}
            onChange={(e)=>setName(e.target.value)}
          />
          <button onClick={join}>Join</button>
          {error && <p style={{color:'#fca5a5'}}>{error}</p>}
        </div>
      ) : (
        <div className="card">
          <h2>Velkommen, {name || `Spiller ${id.slice(0,4)}`}!</h2>
          <p>Du er inne i økt <code>{sessionId}</code>. Vent på at runden starter.</p>
        </div>
      )}
    </div>
  );
}
