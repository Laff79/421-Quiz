import React from 'react'
import { useNavigate } from 'react-router-dom'
import { SpotifyAPI } from '../spotify/api'
import { createWebPlayer } from '../spotify/player'
import { getAccessToken } from '../auth/spotifyAuth'
import { db } from '../firebase/init'
import {
  ref, onValue, set, update, runTransaction, off, get,
} from 'firebase/database'
import { currentScoreAt } from '../logic/score'
import { isArtistMatch } from '../logic/text'

type RoundQ = { id: string; uri: string; name: string; artistNames: string[]; duration_ms: number }
type RoundPayload = { createdAt: number; room: string; selectedPlaylists: string[]; totalCandidates: number; questions: RoundQ[] }
type RoomState = { idx: number; phase: 'idle'|'playing'|'buzzed'|'reveal'|'ended'; startedAt?: number; wrongAtAny?: boolean; revealUntil?: number }
type Buzz = { playerId: string; name: string; at: number; lockWindow?: number } | null
type Answer = { playerId: string; text: string; at: number } | null
type Device = { id: string; name: string; is_active: boolean; type: string; volume_percent?: number }

const AUTO_SKIP_SECONDS = 90

export default function Game() {
  const nav = useNavigate()
  const [round, setRound] = React.useState<RoundPayload | null>(null)

  // Nettleser-spiller
  const [deviceId, setDeviceId] = React.useState<string | null>(null)
  const [playerStatus, setPlayerStatus] = React.useState('Ikke aktiv')

  // Feilsøk/enheter
  const [devices, setDevices] = React.useState<Device[]>([])
  const [playError, setPlayError] = React.useState<string>('')

  // Rom-state
  const [roomState, setRoomState] = React.useState<RoomState>({ idx: 0, phase: 'idle' })
  const [buzz, setBuzz] = React.useState<Buzz>(null)
  const [answer, setAnswer] = React.useState<Answer>(null)
  const [players, setPlayers] = React.useState<Record<string, { name: string; score: number }>>({})

  // Last runden
  React.useEffect(() => {
    const raw = sessionStorage.getItem('edpn_round')
    if (!raw) return
    const r = JSON.parse(raw) as RoundPayload
    setRound(r)
  }, [])

  const room = round?.room || 'EDPN-quiz'
  const q = round?.questions?.[roomState.idx]

  // Init state i DB
  React.useEffect(() => {
    if (!room) return
    ;(async () => {
      const sSnap = await get(ref(db, `rooms/${room}/state`))
      if (!sSnap.exists()) await set(ref(db, `rooms/${room}/state`), { idx: 0, phase: 'idle' })
    })()
  }, [room])

  // Lyttere
  React.useEffect(() => {
    if (!room) return
    const sRef = ref(db, `rooms/${room}/state`)
    const bRef = ref(db, `rooms/${room}/buzz`)
    const aRef = ref(db, `rooms/${room}/answer`)
    const pRef = ref(db, `rooms/${room}/players`)

    const unsub1 = onValue(sRef, (snap) => { const v = snap.val() as RoomState | null; if (v) setRoomState(v) })
    const unsub2 = onValue(bRef, (snap) => setBuzz(snap.val()))
    const unsub3 = onValue(aRef, (snap) => setAnswer(snap.val()))
    const unsub4 = onValue(pRef, (snap) => setPlayers(snap.val() || {}))

    return () => { off(sRef); off(bRef); off(aRef); off(pRef); unsub1(); unsub2(); unsub3(); unsub4() }
  }, [room])

  // Aktiver nettleser-spiller
  async function initWebPlayer() {
    try {
      setPlayerStatus('Aktiverer…')
      const { deviceId: id, player } = await createWebPlayer('EDPN Quiz Player')
      await (player as any)?.activateElement?.()
      setDeviceId(id)
      await SpotifyAPI.transferPlayback(id)
      setPlayerStatus(`Klar (device: ${id})`)
      setPlayError('')
    } catch (e: any) {
      setPlayerStatus('Feil: ' + (e?.message || 'ukjent'))
    }
  }

  // Enheter
  async function refreshDevices() {
    try {
      const token = getAccessToken()
      if (!token) { setDevices([]); return }
      const res = await fetch('https://api.spotify.com/v1/me/player/devices', { headers: { Authorization: `Bearer ${token}` } })
      const json = await res.json()
      setDevices(json.devices || [])
    } catch { setDevices([]) }
  }

  async function transferHere() {
    if (!deviceId) { setPlayerStatus('Mangler nettleser-spiller – trykk “Aktiver nettleser-spiller”.'); return }
    await SpotifyAPI.transferPlayback(deviceId)
    setPlayerStatus('Overført til denne fanen ✔')
    setPlayError('')
  }

  // Hjelpere
  function nowMs() { return Date.now() }
  function secsSinceStart(s: RoomState) { return !s.startedAt ? 0 : Math.max(0, (nowMs() - s.startedAt) / 1000) }
  function windowScore(s: RoomState) { return currentScoreAt(secsSinceStart(s), s.wrongAtAny) }

  async function startQuestion(nextIdx?: number) {
    if (!round) return
    if (!deviceId) { setPlayerStatus('Mangler nettleser-spiller – trykk “Aktiver nettleser-spiller”.'); return }
    const idx = typeof nextIdx === 'number' ? nextIdx : roomState.idx
    const qq = round.questions[idx]; if (!qq) return

    await set(ref(db, `rooms/${room}/buzz`), null)
    await set(ref(db, `rooms/${room}/answer`), null)
    await update(ref(db, `rooms/${room}/state`), { idx, phase: 'playing', startedAt: nowMs(), wrongAtAny: false, revealUntil: null })

    try { await SpotifyAPI.play({ uris: [qq.uri], position_ms: 0 }); setPlayError('') }
    catch { setPlayError('Kunne ikke starte avspilling. Trykk “Overfør avspilling hit” og prøv igjen.') }

    // Auto-skip etter 90s (kun hvis fortsatt i "playing" når tiden er ute)
    setTimeout(async () => {
      const sSnap = await get(ref(db, `rooms/${room}/state`))
      const s = (sSnap.val() || {}) as RoomState
      if (s.phase === 'playing' && s.idx === idx) { void revealFasit(true) }
    }, AUTO_SKIP_SECONDS * 1000)
  }

  async function revealFasit(_skipped = false) {
    await SpotifyAPI.pause().catch(() => {})
    const until = nowMs() + 3000
    await update(ref(db, `rooms/${room}/state`), { phase: 'reveal', revealUntil: until })
    setTimeout(() => { void nextQuestion() }, 3000)
  }

  async function nextQuestion() {
    if (!round) return
    const next = roomState.idx + 1
    if (next >= round.questions.length) { await update(ref(db, `rooms/${room}/state`), { phase: 'ended' }); return }
    await startQuestion(next)
  }

  async function resetToFirst() {
    await SpotifyAPI.pause().catch(() => {})
    await set(ref(db, `rooms/${room}/buzz`), null)
    await set(ref(db, `rooms/${room}/answer`), null)
    await update(ref(db, `rooms/${room}/state`), { idx: 0, phase: 'idle', startedAt: null, wrongAtAny: false, revealUntil: null } as any)
  }

  // Buzz → pause (ingen tidsfrist/auto-feil). lockWindow brukes ved evaluering.
  React.useEffect(() => {
    if (!buzz || roomState.phase !== 'playing') return
    ;(async () => {
      try { await SpotifyAPI.pause() } catch {}
      await update(ref(db, `rooms/${room}/state`), { phase: 'buzzed' })
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buzz?.playerId])

  // Vurder svar
  React.useEffect(() => {
    if (!answer || !round) return
    ;(async () => {
      const ok = isArtistMatch(answer.text || '', (round.questions[roomState.idx]?.artistNames) || [], 0.85)
      await applyAnswerResult(ok, answer.text, answer.playerId)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answer?.playerId, answer?.text])

  async function applyAnswerResult(correct: boolean, text: string, playerId: string) {
    const sSnap = await get(ref(db, `rooms/${room}/state`))
    const s = (sSnap.val() || {}) as RoomState

    // Bruk låst vindu hvis svaret kommer fra aktuell buzzer
    const bSnap = await get(ref(db, `rooms/${room}/buzz`))
    const b = bSnap.val() as Buzz
    const isFromBuzzer = b && b.playerId === playerId
    const locked = isFromBuzzer && typeof b?.lockWindow === 'number' ? b.lockWindow : undefined

    const tSec = secsSinceStart(s)
    let scoreWindow = typeof locked === 'number' ? locked : currentScoreAt(tSec, s.wrongAtAny)

    // Første feil i 4-vinduet senker resten av spørsmålet til 2
    const shouldDropToTwo = !correct && !s.wrongAtAny && scoreWindow === 4

    const delta = correct ? scoreWindow : -scoreWindow
    await runTransaction(ref(db, `rooms/${room}/players/${playerId}/score`), (curr) => (typeof curr === 'number' ? curr : 0) + delta)
    if (shouldDropToTwo) await update(ref(db, `rooms/${room}/state`), { wrongAtAny: true })

    const idx = typeof s.idx === 'number' ? s.idx : roomState.idx
    const accepted = round!.questions[idx]?.artistNames || []
    const pname = players[playerId]?.name || 'Spiller'
    await set(ref(db, `rooms/${room}/lastResult`), { playerId, name: pname, correct, points: delta, window: Math.abs(scoreWindow), text, accepted, at: Date.now() })
    await revealFasit(false)
  }

  // UI
  const tSec = Math.floor(secsSinceStart(roomState))
  const winScore = windowScore(roomState)
  const lockedInfo = buzz?.lockWindow

  return (
    <div className="card vstack">
      <h2>Spillvisning</h2>

      {/* Nettleser-spiller + enheter */}
      <div className="vstack" style={{ marginBottom: 8 }}>
        <div className="hstack" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button onClick={initWebPlayer}>Aktiver nettleser-spiller</button>
          <button onClick={transferHere}>Overfør avspilling hit</button>
          <button onClick={refreshDevices}>Sjekk enheter</button>
          <span className="badge">{playerStatus}</span>
        </div>
        {playError && <small className="badge" style={{ color: '#b00020' }}>{playError}</small>}
        {devices.length > 0 && (
          <div className="vstack" style={{ border: '1px dashed #ddd', borderRadius: 12, padding: 8, marginTop: 6 }}>
            <small className="muted">Spotify-enheter:</small>
            {devices.map(d => (
              <div key={d.id} className="hstack" style={{ justifyContent: 'space-between' }}>
                <div>{d.name} <small className="muted">({d.type})</small></div>
                <span className="badge">{d.is_active ? 'AKTIV' : 'idle'}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {!round ? (
        <p>
          Ingen runde funnet. Gå til{' '}
          <a href="/" onClick={(e) => { e.preventDefault(); nav('/host') }}>Vert</a>{' '}og bygg en runde.
        </p>
      ) : (
        <>
          <div className="hstack" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div>Rom: <span className="badge">{room}</span></div>
              <div>Spørsmål: <span className="badge">{roomState.idx + 1}/{round.questions.length}</span></div>
            </div>
            <div className="hstack" style={{ gap: 8, flexWrap: 'wrap' }}>
              {roomState.phase === 'idle' ? (
                <button onClick={() => startQuestion(0)} title={!deviceId ? 'Aktiver først' : ''}>Start runde (spm #1)</button>
              ) : (
                <>
                  <button onClick={nextQuestion}>Neste spørsmål</button>
                  <button onClick={() => revealFasit(true)}>Fasit (3 s)</button>
                  <button onClick={resetToFirst} title="Tilbake til første spørsmål">Start på nytt (til #1)</button>
                </>
              )}
            </div>
          </div>

          <hr />

          {/* Statuslinje */}
          <div className="hstack" style={{ gap: 12, flexWrap: 'wrap' }}>
            <span className="badge">Fase: {roomState.phase}</span>
            {(roomState.phase !== 'idle' && roomState.phase !== 'ended') && (
              <>
                <span className="badge">Tid: {tSec}s</span>
                <span className="badge">Poengvindu (4→2→1): {winScore}</span>
                {typeof lockedInfo === 'number' && buzz && (
                  <span className="badge">Låst ({buzz.name}): {lockedInfo}</span>
                )}
                {roomState.wrongAtAny && <span className="badge">Første feil registrert</span>}
              </>
            )}
            {buzz && <span className="badge">Buzz: {buzz.name}</span>}
          </div>

          {/* Fasit kun i reveal (3 s) */}
          {roomState.phase === 'reveal' && q && (
            <div className="vstack" style={{ marginTop: 12, border: '1px dashed #ddd', borderRadius: 12, padding: 10, background: '#fafafa' }}>
              <strong>FASIT</strong>
              <small className="muted">{q.artistNames.join(', ')} — {q.name}</small>
            </div>
          )}

          {/* Scoreboard */}
          <div className="vstack" style={{ marginTop: 8 }}>
            <strong>Score</strong>
            <div className="vstack" style={{ border: '1px solid #eee', borderRadius: 12, padding: 8, maxHeight: 220, overflow: 'auto' }}>
              {Object.entries(players).length === 0 && (<small className="muted">Ingen spillere enda – be folk åpne /player og joine.</small>)}
              {Object.entries(players).map(([pid, p]) => (
                <div key={pid} className="hstack" style={{ justifyContent: 'space-between' }}>
                  <div>{p.name}</div>
                  <div style={{ fontWeight: 600 }}>{p.score ?? 0}</div>
                </div>
              ))}
            </div>
          </div>

          {roomState.phase === 'ended' && (
            <div className="vstack" style={{ marginTop: 16 }}>
              <strong>Ferdig 🎉</strong>
              <div className="hstack" style={{ gap: 8 }}>
                <button onClick={resetToFirst}>Start på nytt (til #1)</button>
                <button onClick={() => nav('/host')}>Tilbake til Vert</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}