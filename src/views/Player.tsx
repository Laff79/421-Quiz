// src/views/Player.tsx
import React from 'react'
import { useSearchParams } from 'react-router-dom'
import { ensureAnonAuth, db } from '../firebase/init'
import {
  ref, set, update, onValue, runTransaction, off, get,
} from 'firebase/database'
import { currentScoreAt } from '../logic/score'

type RoundQ = { id: string; name: string; artistNames: string[]; uri: string; duration_ms: number }
type RoundPayload = { room: string; questions: RoundQ[] }

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
  const [idx, setIdx] = React.useState<number>(0)
  const [revealUntil, setRevealUntil] = React.useState<number | null>(null)
  const [round, setRound] = React.useState<RoundPayload | null>(null)
  const [buzzOwner, setBuzzOwner] = React.useState<Buzz>(null)
  const [answerText, setAnswerText] = React.useState('')

  const [startedAt, setStartedAt] = React.useState<number | null>(null)
  const [wrongAtAny, setWrongAtAny] = React.useState<boolean>(false)

  const [result, setResult] = React.useState<LastResult | null>(null)
  const [buzzing, setBuzzing] = React.useState(false)

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
    const roundRef = ref(db, `rooms/${room}/round`)
    const pRef = uid ? ref(db, `rooms/${room}/players/${uid}/score`) : null

    const unsub1 = onValue(sRef, (snap) => {
      const v = snap.val() || {}
      if (v.phase) setPhase(v.phase)
      setStartedAt(v.startedAt ?? null)
      setWrongAtAny(!!v.wrongAtAny)
      if (typeof v.idx === 'number') setIdx(v.idx)
      if (typeof v.revealUntil === 'number') setRevealUntil(v.revealUntil); else setRevealUntil(null)
      if (typeof v.idx === 'number') setIdx(v.idx)
      if (typeof v.revealUntil === 'number') setRevealUntil(v.revealUntil); else setRevealUntil(null)
      if (v.phase !== 'buzzed') { setAnswerText('') }
    })
    const unsub2 = onValue(bRef, (snap) => { setBuzzOwner(snap.val()) })
    const unsub3 = onValue(rRef, (snap) => {
      const v = snap.val() as LastResult | null
      if (v && uid && v.playerId === uid) {
        setResult(v)
        setTimeout(() => setResult(null), 3000)
      }
    })
    const unsubRound = onValue(roundRef, (snap) => { setRound(snap.val() || null) })


    let unsub4 = () => {}
    if (pRef) {
      unsub4 = onValue(pRef, (snap) => { setMyScore(snap.val() || 0) })
    }

    return () => { off(sRef); off(bRef); off(rRef); if (pRef) off(pRef); unsub1(); unsub2(); unsub3(); unsub4(); unsubRound(); unsubRound() }
  }, [room, uid])

  const q = round?.questions?.[idx]
  const facit = q ? `${q.artistNames?.join(', ')} – ${q.name}` : ''
  const now = Date.now()
  const isRevealActive = phase === 'reveal' || (revealUntil && now < revealUntil)

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

  async function sendAnswer() {
    if (!uid) return
    if (!buzzOwner || buzzOwner.playerId !== uid) return
    const aRef = ref(db, `rooms/${room}/answer`)
    const snap = await get(aRef)
    if (snap.exists()) return
    await set(aRef, { playerId: uid, text: answerText, at: Date.now() })
  }

  // Compact layout: detect small viewport height (avoid scroll)
return (
    <>
      <div className="game-background"></div>
      <div className="player-root glass-card vstack" style={{ margin: '16px', padding: '32px' }}>
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <h2 style={{ 
            margin: 0, 
            fontSize: '2.5rem',
            background: 'linear-gradient(135deg, var(--accent) 0%, var(--blue) 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text'
          }}>
            🎵 Musikkquiz
          </h2>
        </div>
        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          <span className="badge" style={{ 
            fontSize: '16px', 
            padding: '12px 20px',
            background: 'rgba(255, 255, 255, 0.1)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255, 255, 255, 0.2)'
          }}>
            🏠 {room}
          </span>
        </div>

        {connecting && (
          <div style={{ textAlign: 'center', padding: '20px' }}>
            <div className="spinner" style={{ margin: '0 auto 12px' }}></div>
            <small className="muted">Kobler til Firebase...</small>
          </div>
        )}

        {joined && (
          <div className="score-display score-enhanced" style={{ 
            background: 'linear-gradient(135deg, rgba(255, 71, 87, 0.1) 0%, rgba(0, 210, 211, 0.1) 100%)',
            backdropFilter: 'blur(20px)',
            border: '2px solid transparent',
            borderRadius: '24px',
            position: 'relative',
            overflow: 'hidden'
          }}>
            <div className="score-number" style={{
              background: 'linear-gradient(135deg, var(--accent) 0%, var(--blue) 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              textShadow: '0 0 30px rgba(255, 71, 87, 0.3)'
            }}>
            {myScore}
          </div>
            <div className="score-label" style={{ 
              fontSize: '1.3rem',
              fontWeight: '600',
              color: 'var(--muted)'
            }}>
              💎 Dine poeng
            </div>
          {(phase === 'playing' || phase === 'buzzed') && (
              <div className="phase-enhanced playing" style={{ 
              marginTop: 16, 
                fontSize: 18, 
              fontWeight: 'bold',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '12px'
            }}>
                <div className="music-bars">
                  <div className="music-bar"></div>
                  <div className="music-bar"></div>
                  <div className="music-bar"></div>
                  <div className="music-bar"></div>
                  <div className="music-bar"></div>
                </div>
                <div>
                  🎯 Poeng nå: <span style={{ fontSize: '24px', fontWeight: 'bold' }}>{winScore}</span>
                </div>
              </div>
            )}
            {(phase === 'playing' || phase === 'buzzed') && (
              <div style={{ 
                fontSize: '14px', 
                marginTop: '12px', 
                opacity: 0.8,
                textAlign: 'center',
                padding: '8px 16px',
                background: 'rgba(255, 255, 255, 0.05)',
                borderRadius: '12px'
              }}>
                {winScore === 4 && "Perfekt timing! (deretter 2 → 1)"}
                {winScore === 2 && "Bra timing! (deretter 1)"}
                {winScore === 1 && "Siste sjanse!"}
              </div>
          )}
          </div>
        )}

        {result && (
          <div
            className={`result-enhanced ${result.correct ? 'correct' : 'wrong'}`}
          style={{
            marginTop: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '16px',
            fontSize: '24px'
          }}
        >
            <div style={{ fontSize: '32px' }}>
              {result.correct ? '🎉' : '💥'}
            </div>
            <div>
          {result.correct
                ? `Perfekt! +${result.points} poeng`
                : `Feil svar! -${Math.abs(result.points)} poeng`}
            </div>
          </div>
        )}

        {!joined ? (
        <>
            <div style={{ textAlign: 'center', marginBottom: '24px' }}>
              <h3 style={{ 
                margin: '0 0 8px 0',
                fontSize: '1.8rem',
                color: 'var(--fg)'
              }}>
                Bli med i spillet! 🎮
              </h3>
              <p style={{ 
                margin: 0,
                color: 'var(--muted)',
                fontSize: '16px'
              }}>
                Skriv inn ditt spillernavn for å starte
              </p>
            </div>
            <input className="input-enhanced" 
            autoFocus
            inputMode="text"
            enterKeyHint="send"
            autoComplete="off"
              placeholder="Ditt spillernavn..."
            value={name}
            onChange={(e)=>setName(e.target.value)}
              style={{ 
                width: '100%',
                textAlign: 'center',
                fontSize: '20px',
                fontWeight: '600'
              }}
          />
          <div className="btn-row" style={{ marginTop: 12 }}>
              <button 
                className="btn-enhanced primary"
                onClick={join} 
                disabled={!name.trim() || !uid}
                style={{ 
                  width: '100%',
                  fontSize: '18px',
                  padding: '18px 32px',
                  fontWeight: 'bold'
                }}
              >
                🚀 Bli med i spillet!
              </button>
          </div>
        </>
        ) : (
        <>
            <div className="hstack" style={{ gap: 8, justifyContent: 'center', marginBottom: '20px' }}>
              <button 
                className="btn-enhanced" 
              onClick={leave}
                style={{ fontSize: '14px', padding: '10px 16px' }}
            >
              👋 Forlat spill
            </button>
          </div>

            <div className="vstack" style={{ gap: 20, marginTop: 16 }}>
              <div style={{ textAlign: 'center' }}>
                <h3 style={{ 
                  margin: 0,
                  fontSize: '2rem',
                  background: 'linear-gradient(135deg, var(--accent) 0%, var(--warning) 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text'
                }}>
                  ⚡ Buzzer
                </h3>
              </div>
            <button
              onClick={buzz}
              disabled={phase !== 'playing' || !!buzzOwner || buzzing}
              aria-label="Buzz / Stopp"
                className="buzzer-primary buzzer-enhanced"
              style={{ 
                position: 'relative',
                opacity: (phase !== 'playing' || !!buzzOwner) ? 0.5 : 1,
                  cursor: (phase !== 'playing' || !!buzzOwner) ? 'not-allowed' : 'pointer',
                  fontSize: '2.5rem',
                  padding: '48px 32px',
                  fontFamily: 'Concert One, sans-serif'
              }}
            >
                {buzzing ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div className="spinner"></div>
                    BUZZER...
                  </div>
                ) : '🚨 STOPP'}
            </button>
              <div className="phase-enhanced" style={{ 
              textAlign: 'center', 
              fontSize: '16px',
                justifyContent: 'center'
            }}>
                <div style={{ fontSize: '20px', marginRight: '8px' }}>
                  {phase === 'playing' && !buzzOwner && '🎵'}
                  {phase === 'playing' && buzzOwner && '🚨'}
                  {phase === 'buzzed' && '✍️'}
                  {phase === 'idle' && '⏸️'}
                  {phase === 'ended' && '🏁'}
                </div>
                <div>
              {phase === 'playing' && !buzzOwner && '🎵 Trykk når du kan artisten!'}
              {phase === 'playing' && buzzOwner && `🚨 ${buzzOwner.name} buzzet først`}
              {phase === 'buzzed' && (iAmBuzzer ? '✍️ Skriv inn svaret ditt' : '⏳ Venter på svar...')}
              {phase === 'idle' && '⏸️ Venter på neste spørsmål'}
              {phase === 'ended' && '🏁 Spillet er ferdig!'}
                </div>
            </div>
          </div>

            {isRevealActive && (
              <div className="glass-card" style={{
              padding: 20, 
              textAlign: 'center',
              marginTop: 16,
                background: 'linear-gradient(135deg, rgba(46, 213, 115, 0.15) 0%, rgba(0, 210, 211, 0.15) 100%)',
                border: '2px solid var(--ok)',
                boxShadow: '0 0 30px rgba(46, 213, 115, 0.2)'
            }}>
                <div style={{ 
                  fontSize: '24px',
                  marginBottom: '12px'
                }}>
                  💡
                </div>
                <div className="facit-title" style={{ 
                fontSize: '16px', 
                opacity: 0.8, 
                marginBottom: '8px',
                  color: 'var(--ok)',
                  fontWeight: '600'
              }}>
                  RIKTIG SVAR
              </div>
              <div className="facit-answer" style={{ 
                fontSize: '20px', 
                fontWeight: 'bold',
                  color: 'var(--ok)',
                  textShadow: '0 0 10px rgba(46, 213, 115, 0.3)'
              }}>
                {facit || 'Fasit'}
              </div>
            </div>
            )}

            {iAmBuzzer && phase === 'buzzed' && (
              <div className="glass-card vstack" style={{ 
              marginTop: 20, 
              padding: '20px',
                background: 'linear-gradient(135deg, rgba(255, 71, 87, 0.15) 0%, rgba(255, 165, 2, 0.15) 100%)',
                border: '2px solid var(--accent)',
                boxShadow: '0 0 30px rgba(255, 71, 87, 0.2)'
            }}>
                <div style={{ 
                  textAlign: 'center',
                  fontSize: '24px',
                  marginBottom: '16px'
                }}>
                  ✍️
                </div>
                <label style={{ 
                fontSize: '16px', 
                fontWeight: 'bold',
                color: 'var(--accent)',
                  textAlign: 'center',
                  textTransform: 'uppercase',
                  letterSpacing: '1px'
              }}>
                  Skriv artistnavn
              </label>
                <input
                  className="input-enhanced"
                autoFocus
                value={answerText}
                onChange={(e)=>setAnswerText(e.target.value)}
                placeholder="Artist…"
                onKeyDown={(e)=>{ if(e.key==='Enter' && answerText.trim()) sendAnswer() }}
                style={{ 
                    fontSize: '20px',
                  textAlign: 'center',
                    fontWeight: 'bold',
                    marginTop: '12px'
                }}
              />
              <div className="btn-row" style={{ marginTop: 16 }}>
                <button 
                    className="btn-enhanced primary"
                  onClick={sendAnswer} 
                  disabled={!answerText.trim()}
                    style={{ 
                      fontSize: '18px', 
                      padding: '18px 32px',
                      width: '100%',
                      fontWeight: 'bold'
                    }}
                >
                  📝 Send svar
                </button>
              </div>
            </div>
            )}
        </>
        )}
      </div>
    </>
  )
}
