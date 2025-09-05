import React from 'react'
import { useNavigate } from 'react-router-dom'
import { SpotifyAPI } from '../spotify/api'
import { createWebPlayer } from '../spotify/player'
import { db } from '../firebase/init'
import {
  ref, onValue, set, update, runTransaction, off,
} from 'firebase/database'
import { currentScoreAt } from '../logic/score'
import { isArtistMatch } from '../logic/text'

type RoundQ = {
  id: string
  uri: string
  name: string
  artistNames: string[]
  duration_ms: number
}

type RoundPayload = {
  createdAt: number
  room: string
  selectedPlaylists: string[]
  totalCandidates: number
  questions: RoundQ[]
}

type RoomState = {
  idx: number
  phase: 'idle' | 'playing' | 'buzzed' | 'reveal' | 'ended'
  startedAt?: number // ms
  wrongAtAny?: boolean
  revealUntil?: number // ms
}

type Buzz = { playerId: string; name: string; at: number } | null
type Answer = { playerId: string; text: string; at: number } | null

const ANSWER_SECONDS = 15
const AUTO_SKIP_SECONDS = 90

export default function Game() {
  const nav = useNavigate()
  const [round, setRound] = React.useState<RoundPayload | null>(null)
  const [deviceId, setDeviceId] = React.useState<string | null>(null)

  const [roomState, setRoomState] = React.useState<RoomState>({
    idx: 0, phase: 'idle',
  })
  const [buzz, setBuzz] = React.useState<Buzz>(null)
  const [answer, setAnswer] = React.useState<Answer>(null)
  const [players, setPlayers] = React.useState<Record<string, { name: string; score: number }>>({})

  // --- Load round from sessionStorage ---
  React.useEffect(() => {
    const raw = sessionStorage.getItem('edpn_round')
    if (!raw) return
    const r = JSON.parse(raw) as RoundPayload
    setRound(r)
  }, [])

  const room = round?.room || 'EDPN-quiz'
  const q = round?.questions?.[roomState.idx]

  // --- Ensure web player on this page too ---
  React.useEffect(() => {
    let alive = true
    async function boot() {
      try {
        const { deviceId } = await createWebPlayer('EDPN Quiz Player')
        if (!alive) return
        setDeviceId(deviceId)
        await SpotifyAPI.transferPlayback(deviceId)
      } catch (e) {
        console.error(e)
      }
    }
    boot()
    return () => { alive = false }
  }, [])

  // --- Firebase bindings ---
  React.useEffect(() => {
    if (!room) return
    const sRef = ref(db, `rooms/${room}/state`)
    const bRef = ref(db, `rooms/${room}/buzz`)
    const aRef = ref(db, `rooms/${room}/answer`)
    const pRef = ref(db, `rooms/${room}/players`)

    const unsub1 = onValue(sRef, (snap) => {
      const val = snap.val() as RoomState | null
      if (val) setRoomState(val)
    })
    const unsub2 = onValue(bRef, (snap) => setBuzz(snap.val()))
    const unsub3 = onValue(aRef, (snap) => setAnswer(snap.val()))
    const unsub4 = onValue(pRef, (snap) => setPlayers(snap.val() || {}))

    return () => {
      off(sRef); off(bRef); off(aRef); off(pRef)
      unsub1(); unsub2(); unsub3(); unsub4()
    }
  }, [room])

  // --- Helpers ---
  function nowMs() { return Date.now() }
  function secsSinceStart(s: RoomState) {
    if (!s.startedAt) return 0
    return Math.max(0, (nowMs() - s.startedAt) / 1000)
  }
  function windowScore(s: RoomState) {
    return currentScoreAt(secsSinceStart(s), s.wrongAtAny)
  }

  async function startQuestion(nextIdx?: number) {
    if (!round || deviceId == null) return
    const idx = typeof nextIdx === 'number' ? nextIdx : roomState.idx
    const qq = round.questions[idx]
    if (!qq) return

    // Reset DB state for this question
    await set(ref(db, `rooms/${room}/buzz`), null)
    await set(ref(db, `rooms/${room}/answer`), null)
    await update(ref(db, `rooms/${room}/state`), {
      idx,
      phase: 'playing',
      startedAt: nowMs(),
      wrongAtAny: false,
      revealUntil: null,
    })

    // Start playback at 0:00
    await SpotifyAPI.play({ uris: [qq.uri], position_ms: 0 })

    // Auto-skip etter 90s hvis ingen har svart
    setTimeout(() => {
      const s = roomState
      if (s.phase === 'playing' && s.idx === idx) {
        revealFasit(true)
      }
    }, AUTO_SKIP_SECONDS * 1000)
  }

  async function revealFasit(skipped = false) {
    if (!round) return
    await SpotifyAPI.pause().catch(() => {})
    const until = nowMs() + 3000
    await update(ref(db, `rooms/${room}/state`), {
      phase: 'reveal',
      revealUntil: until,
    })
    // Etter 3 sek, neste spørsmål
    setTimeout(() => {
      nextQuestion()
    }, 3000)
  }

  async function nextQuestion() {
    if (!round) return
    const next = roomState.idx + 1
    if (next >= round.questions.length) {
      await update(ref(db, `rooms/${room}/state`), { phase: 'ended' })
      return
    }
    await startQuestion(next)
  }

  // Når det kommer et buzz, pause og sett fase=buzzed + svarfrist
  React.useEffect(() => {
    if (!buzz || roomState.phase !== 'playing') return
    // Første buzz vinner; andre vil bli ignorert (DB transaksjon ligger i Player)
    ;(async () => {
      try {
        await SpotifyAPI.pause()
      } catch {}
      await update(ref(db, `rooms/${room}/state`), { phase: 'buzzed' })
      // Autotime ut etter 15s hvis ingen svar
      setTimeout(async () => {
        const sSnap = await (await import('firebase/database')).get(ref(db, `rooms/${room}/state`))
        const s = (sSnap.val() || {}) as RoomState
        const aSnap = await (await import('firebase/database')).get(ref(db, `rooms/${room}/answer`))
        const a = aSnap.val() as Answer
        if (s.phase === 'buzzed' && !a) {
          // Ingen svar – feil svar (0 tekst). Poeng: minus nåværende vindu.
          await applyAnswerResult(false, '', buzz.playerId)
        }
      }, ANSWER_SECONDS * 1000)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buzz?.playerId])

  // Når det kommer et answer, vurder og tildel poeng
  React.useEffect(() => {
    if (!answer || !round) return
    ;(async () => {
      const ok = isArtistMatch(answer.text || '', (round.questions[roomState.idx]?.artistNames) || [], 0.85)
      await applyAnswerResult(ok, answer.text, answer.playerId)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answer?.playerId, answer?.text])

  async function applyAnswerResult(correct: boolean, text: string, playerId: string) {
    if (!round) return
    const sSnap = await (await import('firebase/database')).get(ref(db, `rooms/${room}/state`))
    const s = (sSnap.val() || {}) as RoomState
    const tSec = secsSinceStart(s)
    let dropWrong = false
    let scoreWindow = currentScoreAt(tSec, s.wrongAtAny)
    if (!correct) {
      // Hvis vi er i 4p-vindu og dette er første feil, dropp til 2p for resten
      if (tSec < 20 && !s.wrongAtAny) {
        dropWrong = true
        scoreWindow = 4
      }
    }
    const delta = correct ? scoreWindow : -scoreWindow

    // Oppdater spiller-score atomisk
    await runTransaction(ref(db, `rooms/${room}/players/${playerId}/score`), (curr) => {
      return (typeof curr === 'number' ? curr : 0) + delta
    })

    if (dropWrong) {
      await update(ref(db, `rooms/${room}/state`), { wrongAtAny: true })
    }

    // Vis fasit 3s og gå videre
    await revealFasit(false)
  }

  // UI helpers
  const tSec = Math.floor(secsSinceStart(roomState))
  const winScore = windowScore(roomState)

  return (
    <div className="card vstack">
      <h2>Spillvisning</h2>

      {!round && <p>Ingen runde funnet. Gå til <a href="/" onClick={(e)=>{e.preventDefault(); nav('/host')}}>Vert</a> og bygg en runde.</p>}

      {round && (
        <>
          <div className="hstack" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div>Rom: <span className="badge">{room}</span></div>
              <div>Spørsmål: <span className="badge">{roomState.idx + 1}/{round.questions.length}</span></div>
            </div>
            <div className="hstack" style={{ gap: 8 }}>
              {roomState.phase === 'idle' && (
                <button className="primary" onClick={() => startQuestion(0)}>Start runde</button>
              )}
              {roomState.phase !== 'idle' && roomState.phase !== 'ended' && (
                <>
                  <button className="ghost" onClick={() => revealFasit(true)}>Fasit (3 s)</button>
                  <button className="ghost" onClick={() => nextQuestion()}>Hopp til neste</button>
                </>
              )}
            </div>
          </div>

          <hr/>

          {/* Statuslinje */}
          <div className="hstack" style={{ gap: 12, flexWrap: 'wrap' }}>
            <span className="badge">Fase: {roomState.phase}</span>
            {roomState.phase !== 'idle' && roomState.phase !== 'ended' && (
              <>
                <span className="badge">Tid: {tSec}s</span>
                <span className="badge">Poengvindu: {winScore}</span>
                {roomState.wrongAtAny && <span className="badge">Første feil registrert</span>}
              </>
            )}
            {buzz && <span className="badge">Buzz: {buzz.name}</span>}
          </div>

          {/* Enkel scoreboard */}
          <div className="vstack" style={{ marginTop: 8 }}>
            <strong>Score</strong>
            <div className="vstack" style={{ border: '1px solid #eee', borderRadius: 12, padding: 8, maxHeight: 220, overflow: 'auto' }}>
              {Object.entries(players).length === 0 && <small className="muted">Ingen spillere enda – be folk åpne /player og joine.</small>}
              {Object.entries(players).map(([pid, p]) => (
                <div key={pid} className="hstack" style={{ justifyContent: 'space-between' }}>
                  <div>{p.name}</div>
                  <div style={{ fontWeight: 600 }}>{p.score ?? 0}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Nåværende spørsmål (kun teknisk info – vert er “blind” ellers) */}
          <div className="vstack" style={{ marginTop: 12 }}>
            <small className="muted">Spiller: {q ? `${q.name} — ${q.artistNames.join(', ')}` : '—'}</small>
          </div>

          {roomState.phase === 'ended' && (
            <div className="vstack" style={{ marginTop: 16 }}>
              <strong>Ferdig 🎉</strong>
              <button className="primary" onClick={() => nav('/host')}>Tilbake til Vert</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
