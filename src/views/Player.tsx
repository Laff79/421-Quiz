// src/views/Player.tsx
import React from 'react'
import { useSearchParams } from 'react-router-dom'
import { ensureAnonAuth, db } from '../firebase/init'
import {
  ref, set, update, onValue, runTransaction, off, get,
} from 'firebase/database'
import { currentScoreAt } from '../logic/score'

type LastResult = {
  playerId: string
  name: string
  correct: boolean
  points: number
  window: number
  text: string
  accepted: string[]
  at: number
}

type Buzz = { playerId: string; name: string; at: number; lockWindow?: number } | null

export default function Player() {
  const [search] = useSearchParams()
  const room = search.get('room') || 'EDPN-quiz'

  const [uid, setUid] = React.useState<string | null>(null)
  const [name, setName] = React.useState<string>(search.get('name') || 'Spiller')

  const [joined, setJoined] = React.useState(false)
  const [phase, setPhase] = React.useState<'idle'|'playing'|'buzzed'|'reveal'|'ended'>('idle')
  const [buzzOwner, setBuzzOwner] = React.useState<Buzz>(null)
  const [answerText, setAnswerText] = React.useState('')

  const [startedAt, setStartedAt] = React.useState<number | null>(null)
  const [wrongAtAny, setWrongAtAny] = React.useState<boolean>(false)

  const [result, setResult] = React.useState<LastResult | null>(null)
  const [buzzing, setBuzzing] = React.useState(false)
  const [confirmPending, setConfirmPending] = React.useState(false)

  // egen poengsum
  const [myScore, setMyScore] = React.useState<number>(0)

  // status
  const [connecting, setConnecting] = React.useState(true)

  // dummy-state for å trigge re-render hvert sekund
  const [tick, setTick] = React.useState(0)

  React.useEffect(() => {
    ensureAnonAuth()
      .then((id) => { setUid(id); setConnecting(false) })
      .catch((err) => { console.error(err); setConnecting(false) })
  }, [])

  function secsSinceStart() {
    if (!startedAt) return 0
    return Math.max(0, (Date.now() - startedAt) / 1000)
  }
  const winScore = currentScoreAt(secsSinceStart(), wrongAtAny)
  const iAmBuzzer = buzzOwner?.playerId === uid

  // Lytt til romstatus + buzz + siste resultat + egen score
  React.useEffect(() => {
    if (!room) return

    const sRef = ref(db, `rooms/${room}/state`)
    const bRef = ref(db, `rooms/${room}/buzz`)
    const rRef = ref(db, `rooms/${room}/lastResult`)
    const pRef = uid ? ref(db, `rooms/${room}/players/${uid}/score`) : null

    const unsub1 = onValue(sRef, (snap) => {
      const v = snap.val() || {}
      if (v.phase) setPhase(v.phase)
      setStartedAt(v.startedAt ?? null)
      setWrongAtAny(!!v.wrongAtAny)
      if (v.phase !== 'buzzed') { setAnswerText(''); setConfirmPending(false) }
    })
    const unsub2 = onValue(bRef, (snap) => { setBuzzOwner(snap.val()) })
    const unsub3 = onValue(rRef, (snap) => {
      const v = snap.val() as LastResult | null
      if (v && uid && v.playerId === uid) {
        setResult(v)
        setTimeout(() => setResult(null), 3000)
      }
    })

    let unsub4 = () => {}
    if (pRef) {
      unsub4 = onValue(pRef, (snap) => { setMyScore(snap.val() || 0) })
    }

    return () => { off(sRef); off(bRef); off(rRef); if (pRef) off(pRef); unsub1(); unsub2(); unsub3(); unsub4() }
  }, [room, uid])

  // Oppdater tick hvert sekund når vi spiller → winScore oppdateres live
  React.useEffect(() => {
    if (phase === 'playing' || phase === 'buzzed') {
      const iv = setInterval(() => setTick((t) => t + 1), 1000)
      return () => clearInterval(iv)
    }
  }, [phase, startedAt, wrongAtAny])

  async function join() {
    if (!uid) return
    await update(ref(db, `rooms/${room}/players/${uid}`), {
      name,
      score: 0,
      lastSeen: Date.now(),
    })
    setJoined(true)
  }

  async function leave() {
    if (!uid) return
    await update(ref(db, `rooms/${room}/players/${uid}`), { lastSeen: Date.now() })
    setJoined(false)
  }

  async function buzz() {
    if (buzzing) return
    setBuzzing(true)
    try {
      if (!uid) return
      const sSnap = await get(ref(db, `rooms/${room}/state`))
      const s = sSnap.val() || {}
      if (s.phase !== 'playing') {
        alert('Venter på at nytt spørsmål spiller (fase er ikke "playing").')
        return
      }
      const tSec = s.startedAt ? Math.max(0, (Date.now() - s.startedAt) / 1000) : 0
      const win = currentScoreAt(tSec, !!s.wrongAtAny)

      const bRef = ref(db, `rooms/${room}/buzz`)
      const res = await runTransaction(bRef, (curr) => {
        if (curr) return curr
        return { playerId: uid, name, at: Date.now(), lockWindow: win }
      })
      if (!res.committed) {
        alert(`For seint – ${res.snapshot?.val()?.name || 'en annen spiller'} buzzet først.`)
      }
    } catch (e:any) {
      alert('Buzz-feil: ' + (e?.message || 'ukjent'))
    } finally {
      setBuzzing(false)
    }
  }

  function requestSubmit(){ if(!answerText.trim()) return; setConfirmPending(true) }
  function cancelSubmit(){ setConfirmPending(false) }
  async function confirmSubmit(){ await sendAnswer(); setConfirmPending(false) }

  async function sendAnswer() {
    if (!uid) return
    if (!buzzOwner || buzzOwner.playerId !== uid) return
    const aRef = ref(db, `rooms/${room}/answer`)
    const snap = await get(aRef)
    if (snap.exists()) return
    await set(aRef, { playerId: uid, text: answerText, at: Date.now() })
  }

  return (
    <div className="card vstack">
      <h2>Spiller</h2>
      <div>Rom: <span className="badge">{room}</span></div>

      {connecting && <div><small className="muted">Kobler til…</small></div>}

      {joined && (
        <div className="score-display">
          <div className="score-number">{myScore}</div>
          <div className="score-label">Dine poeng</div>
          {(phase === 'playing' || phase === 'buzzed') && (
            <div style={{ marginTop: 12, fontSize: 16, color: 'var(--accent)' }}>
              🎯 Poeng nå: {winScore}{" "}
              {winScore === 4 && "(deretter 2 → 1)"}
              {winScore === 2 && "(deretter 1)"}
              {winScore === 1 && "(siste sjanse)"}
            </div>
          )}
        </div>
      )}

      {result && (
        <div
          className={`banner ${result.correct ? 'ok result-correct' : 'err result-wrong'}`}
          style={{
            marginTop: 8,
            padding: 12,
            borderRadius: 10,
            textAlign: 'center',
            fontSize: 20,
            fontWeight: 'bold',
            color: 'white',
          }}
        >
          {result.correct
            ? `🎉 Riktig! Du fikk +${result.points} poeng`
            : `❌ Feil! Du mistet ${Math.abs(result.points)} poeng`}
        </div>
      )}

      {!joined ? (
        <>
          <label>Spillernavn (unikt i rommet)</label>
          <input
            autoFocus
            inputMode="text"
            enterKeyHint="send"
            autoComplete="off"
            value={name}
            onChange={(e)=>setName(e.target.value)}
          />
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button onClick={join} disabled={!name.trim() || !uid}>Join</button>
          </div>
        </>
      ) : (
        <>
          <div className="hstack" style={{ gap: 8 }}>
            <button onClick={leave}>Forlat</button>
          </div>

          <div className="vstack" style={{ gap: 12 }}>
            <strong>Buzzer</strong>
            <button
              onClick={buzz}
              disabled={phase !== 'playing' || !!buzzOwner || buzzing}
              aria-label="Buzz / Stopp"
              className="buzzer-primary"
              style={{ position: 'relative' }}
            >
              🚨 STOPP
            </button>
            <small className="muted">
              {phase === 'playing' && !buzzOwner && 'Trykk når du kan artisten'}
              {phase === 'playing' && buzzOwner && `Buzz: ${buzzOwner.name}`}
              {phase === 'buzzed' && (iAmBuzzer ? 'Skriv inn og send svaret ditt' : 'Venter på svar')}
              {phase === 'reveal' && 'Fasit vises…'}
            </small>
          </div>

          {iAmBuzzer && phase === 'buzzed' && (
            <div className="vstack" style={{ marginTop: 8 }}>
              <label>Skriv artistnavn</label>
              <input
                value={answerText}
                onChange={(e)=>setAnswerText(e.target.value)}
                placeholder="Artist…"
                onKeyDown={(e)=>{ if(e.key==='Enter' && answerText.trim()) requestSubmit() }}
              />
              <div className="btn-row" style={{ marginTop: 12 }}>
                <button onClick={requestSubmit} disabled={!answerText.trim()}>
                  📝 Send svar
                </button>
              </div>

              {confirmPending && (
                <div className="btn-row" style={{ marginTop: 16 }}>
                  <button className="primary" onClick={confirmSubmit} title="Send inn svaret">
                    ✅ Er du sikker? Send inn
                  </button>
                  <button className="ghost" onClick={cancelSubmit} title="Gå tilbake og rediger">
                    ❌ Avbryt
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
