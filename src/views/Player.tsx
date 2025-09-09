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
  points: number   // +/−
  window: number   // 4/2/1
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

  // For å vise “poeng nå”
  const [startedAt, setStartedAt] = React.useState<number | null>(null)
  const [wrongAtAny, setWrongAtAny] = React.useState<boolean>(false)

  const [result, setResult] = React.useState<LastResult | null>(null)
  const [buzzing, setBuzzing] = React.useState(false)
  const [confirmPending, setConfirmPending] = React.useState(false)

  React.useEffect(() => {
    ensureAnonAuth().then(setUid).catch(console.error)
  }, [])

  function secsSinceStart() {
    if (!startedAt) return 0
    return Math.max(0, (Date.now() - startedAt) / 1000)
  }
  const winScore = currentScoreAt(secsSinceStart(), wrongAtAny)
  const iAmBuzzer = buzzOwner?.playerId === uid
  const lockedInfo = typeof buzzOwner?.lockWindow === 'number' ? buzzOwner!.lockWindow : undefined

  // Lytt til romstatus + buzz + siste resultat
  React.useEffect(() => {
    const sRef = ref(db, `rooms/${room}/state`)
    const bRef = ref(db, `rooms/${room}/buzz`)
    const rRef = ref(db, `rooms/${room}/lastResult`)

    const unsub1 = onValue(sRef, (snap) => {
      const v = snap.val() || {}
      if (v.phase) setPhase(v.phase)
      setStartedAt(v.startedAt ?? null)
      setWrongAtAny(!!v.wrongAtAny)
      if (v.phase !== 'buzzed') { setAnswerText(''); setConfirmPending(false) }
    })
    const unsub2 = onValue(bRef, (snap) => {
      setBuzzOwner(snap.val())
    })
    const unsub3 = onValue(rRef, (snap) => {
      const v = snap.val() as LastResult | null
      if (v && uid && v.playerId === uid) {
        setResult(v)
        setTimeout(() => setResult(null), 3000)
      }
    })

    return () => { off(sRef); off(bRef); off(rRef); unsub1(); unsub2(); unsub3() }
  }, [room, uid])

  async function join() {
    if (!uid) return
    await set(ref(db, `rooms/${room}/players/${uid}`), {
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
    if (buzzing) return;
    setBuzzing(true);
    try {
    if (!uid) return
    try {
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
    }
  
    } finally { setBuzzing(false) }
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

      <div className="hstack" style={{ gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
        <span className="badge">Fase: {phase}</span>
        <span className="badge">Buzz: {buzzOwner ? buzzOwner.name : '—'}</span>
        {(phase === 'playing' || phase === 'buzzed') && (
          <>
            <span className="badge">Poengvindu (4→2→1): {winScore}</span>
            {iAmBuzzer && typeof lockedInfo === 'number' && (
              <span className="badge">Låst poeng: {lockedInfo}</span>
            )}
          </>
        )}
      </div>

      {result && (
        <div className={`banner ${result.correct ? 'ok' : 'err'}`} style={{ marginTop: 8 }}>
          <strong>{result.correct ? 'Riktig!' : 'Feil'}</strong>
          <div>
            <small>
              {result.correct ? 'Du fikk' : 'Du mistet'} {Math.abs(result.points)} poeng
              {result.window ? ` (vindu: ${result.window})` : ''}.&nbsp;
              {result.accepted?.length ? `Akseptert(e): ${result.accepted.join(', ')}.` : ''}
            </small>
          </div>
        </div>
      )}

      <hr/>

      {!joined ? (
        <>
          <label>Spillernavn (unikt i rommet)</label>
          <input autoFocus inputMode="text" enterKeyHint="send" autoComplete="off" value={name} onChange={(e)=>setName(e.target.value)} />
          <div className="hstack" style={{ marginTop: 12 }}>
            <button onClick={join} disabled={!name.trim()}>Join</button>
          </div>
        </>
      ) : (
        <>
          <div className="hstack" style={{ gap: 8 }}>
            <button onClick={leave}>Forlat</button>
          </div>

          <div className="vstack" style={{ gap: 6 }}>
            <strong>Buzzer</strong>
            <button
              onClick={buzz}
              disabled={phase !== 'playing' || !!buzzOwner || buzzing}
              aria-label="Buzz / Stopp"
              className="buzzer-primary"
              title={phase !== 'playing' ? 'Venter på neste spørsmål' : (buzzOwner ? `Buzz hos ${buzzOwner.name}` : '')}
              style={{ fontSize: 28, padding: '22px 30px', borderRadius: 18 }}
            >
              STOPP
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
              <div className="hstack" style={{ gap: 8, marginTop: 6 }}>
                <button onClick={requestSubmit} disabled={!answerText.trim()}>
                  Send svar
                </button>
              
              </div>

              {confirmPending && (
                <div className="hstack" style={{ gap: 8, marginTop: 8 }}>
                  <button className="primary" onClick={confirmSubmit} title="Send inn svaret">
                    Er du sikker? Send inn
                  </button>
                  <button className="ghost" onClick={cancelSubmit} title="Gå tilbake og rediger">
                    Avbryt
                  </button>
                </div>
              )}

              <small className="muted">Bare “Send svar” (eller Enter) leverer – klikking utenfor gjør ingenting.</small>
            </div>
          )}
        </>
      )}
    </div>
  )
}
