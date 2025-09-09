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

  // Lytt til romstatus + buzz + siste resultat + egen score
  React.useEffect(() => {
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
      {joined && <div>Poeng: <span className="badge">{myScore}</span></div>}

      {/* resten av UI er uendret */}
      {/* ... */}
    </div>
  )
}
