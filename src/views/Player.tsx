import React from 'react'
import { useSearchParams } from 'react-router-dom'
import { ensureAnonAuth, db } from '../firebase/init'
import {
  ref, set, update, onValue, runTransaction, off, get,
} from 'firebase/database'

export default function Player() {
  const [search] = useSearchParams()
  const room = search.get('room') || 'EDPN-quiz'

  const [uid, setUid] = React.useState<string | null>(null)
  const [name, setName] = React.useState<string>(search.get('name') || 'Spiller')

  const [joined, setJoined] = React.useState(false)
  const [phase, setPhase] = React.useState<'idle'|'playing'|'buzzed'|'reveal'|'ended'>('idle')
  const [buzzOwner, setBuzzOwner] = React.useState<{playerId:string; name:string}|null>(null)
  const [answerText, setAnswerText] = React.useState('')

  React.useEffect(() => {
    ensureAnonAuth().then(setUid).catch(console.error)
  }, [])

  // Lytt til romstatus + buzz
  React.useEffect(() => {
    const sRef = ref(db, `rooms/${room}/state`)
    const bRef = ref(db, `rooms/${room}/buzz`)
    const unsub1 = onValue(sRef, (snap) => {
      const v = snap.val()
      if (v?.phase) setPhase(v.phase)
      if (v?.phase !== 'buzzed') setAnswerText('')
    })
    const unsub2 = onValue(bRef, (snap) => {
      const v = snap.val()
      setBuzzOwner(v ? { playerId: v.playerId, name: v.name } : null)
    })
    return () => { off(sRef); off(bRef); unsub1(); unsub2() }
  }, [room])

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
    if (!uid) return
    // Kun tillatt når fase = playing, og hvis ingen allerede har buzz
    const bRef = ref(db, `rooms/${room}/buzz`)
    await runTransaction(bRef, (curr) => {
      if (curr) return curr // allerede noen som har buzzet
      return { playerId: uid, name, at: Date.now() }
    })
  }

  async function sendAnswer() {
    if (!uid) return
    if (!buzzOwner || buzzOwner.playerId !== uid) return // bare buzzer kan svare
    const aRef = ref(db, `rooms/${room}/answer`)
    const snap = await get(aRef)
    if (snap.exists()) return // svar allerede registrert
    await set(aRef, { playerId: uid, text: answerText, at: Date.now() })
    // svar sendt – la host/game vurdere
  }

  const iAmBuzzer = buzzOwner?.playerId === uid

  return (
    <div className="card vstack">
      <h2>Spiller</h2>
      <div>Rom: <span className="badge">{room}</span></div>

      {!joined ? (
        <>
          <label>Spillernavn (unikt i rommet)</label>
          <input value={name} onChange={(e)=>setName(e.target.value)} />
          <div className="hstack" style={{ marginTop: 12 }}>
            <button className="primary" onClick={join} disabled={!name.trim()}>Join</button>
          </div>
        </>
      ) : (
        <>
          <div className="hstack" style={{ gap: 8 }}>
            <button className="ghost" onClick={leave}>Forlat</button>
          </div>

          <hr/>

          {/* Buzzer */}
          <div className="vstack" style={{ gap: 6 }}>
            <strong>Buzzer</strong>
            <button
              className="primary"
              style={{ fontSize: 24, padding: '24px 32px' }}
              onClick={buzz}
              disabled={phase !== 'playing' || !!buzzOwner}
              title={phase !== 'playing' ? 'Venter på neste spørsmål' : (buzzOwner ? `Buzz hos ${buzzOwner.name}` : '')}
            >
              STOPP
            </button>
            <small className="muted">
              {phase === 'playing' && !buzzOwner && 'Trykk når du kan artisten'}
              {phase === 'playing' && buzzOwner && `Buzz: ${buzzOwner.name}`}
              {phase === 'buzzed' && (iAmBuzzer ? 'Du har 15 s til å svare' : 'Venter på svar')}
              {phase === 'reveal' && 'Fasit vises…'}
            </small>
          </div>

          {/* Svarfelt – kun for buzzer */}
          {iAmBuzzer && phase === 'buzzed' && (
            <div className="vstack" style={{ marginTop: 8 }}>
              <label>Skriv artistnavn</label>
              <input
                value={answerText}
                onChange={(e)=>setAnswerText(e.target.value)}
                placeholder="Artist…"
              />
              <div className="hstack" style={{ gap: 8, marginTop: 6 }}>
                <button className="primary" onClick={sendAnswer} disabled={!answerText.trim()}>
                  Send svar
                </button>
              </div>
              <small className="muted">Feilsvar gir minuspoeng likt poengvinduet.</small>
            </div>
          )}
        </>
      )}
    </div>
  )
}
