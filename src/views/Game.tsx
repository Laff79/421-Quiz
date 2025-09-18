// src/views/Game.tsx
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

  const [deviceId, setDeviceId] = React.useState<string | null>(null)
  const [playerStatus, setPlayerStatus] = React.useState('Ikke aktiv')
  const [devices, setDevices] = React.useState<Device[]>([])
  const [playError, setPlayError] = React.useState<string>('')

  const [roomState, setRoomState] = React.useState<RoomState>({ idx: 0, phase: 'idle' })
  const [buzz, setBuzz] = React.useState<Buzz>(null)
  const [answer, setAnswer] = React.useState<Answer>(null)
  const [players, setPlayers] = React.useState<Record<string, { name: string; score: number; lastSeen?: number }>>({})

  const room = round?.room || 'EDPN-quiz'
  const q = round?.questions?.[roomState.idx]

  // 🚀 Hent runden fra Firebase
  React.useEffect(() => {
    if (!room) return
    const rRef = ref(db, `rooms/${room}/round`)
    const unsub = onValue(rRef, (snap) => {
      const v = snap.val() as RoundPayload | null
      if (v) setRound(v)
    })
    return () => off(rRef)
  }, [room])

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

  // Spotify nettleser-spiller
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

    try {
      await SpotifyAPI.transferPlayback(deviceId)
      await SpotifyAPI.play({ uris: [qq.uri], position_ms: 0 })
      setPlayError('')
    } catch (e:any) {
      setPlayError('Kunne ikke starte avspilling. Trykk “Aktiver nettleser-spiller” og/eller “Overfør avspilling hit” og prøv igjen.')
    }

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

  // Buzz → pause
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

    const bSnap = await get(ref(db, `rooms/${room}/buzz`))
    const b = bSnap.val() as Buzz
    const isFromBuzzer = b && b.playerId === playerId
    const locked = isFromBuzzer && typeof b?.lockWindow === 'number' ? b.lockWindow : undefined

    const tSec = secsSinceStart(s)
    let scoreWindow = typeof locked === 'number' ? locked : currentScoreAt(tSec, s.wrongAtAny)

    const delta = correct ? scoreWindow : -scoreWindow
    await runTransaction(
      ref(db, `rooms/${room}/players/${playerId}/score`),
      (curr) => (typeof curr === 'number' ? curr : 0) + delta
    )

    if (!correct && !s.wrongAtAny && scoreWindow === 4) {
      await update(ref(db, `rooms/${room}/state`), { wrongAtAny: true })
    }

    const idx = typeof s.idx === 'number' ? s.idx : roomState.idx
    const accepted = correct ? (round!.questions[idx]?.artistNames || []) : []
    const pname = players[playerId]?.name || 'Spiller'
    await set(ref(db, `rooms/${room}/lastResult`), {
      playerId,
      name: pname,
      correct,
      points: delta,
      window: Math.abs(scoreWindow),
      text,
      accepted,
      at: Date.now(),
    })

    if (correct) {
      await revealFasit(false)
    } else {
      await update(ref(db, `rooms/${room}/state`), { phase: 'playing' })
      await set(ref(db, `rooms/${room}/buzz`), null)
      await set(ref(db, `rooms/${room}/answer`), null)

      try {
        const token = getAccessToken()
        if (token) {
          const res = await fetch("https://api.spotify.com/v1/me/player", {
            headers: { Authorization: `Bearer ${token}` }
          })
          if (res.ok) {
            const json = await res.json()
            const pos = json?.progress_ms || 0
            const qq = round!.questions[idx]
            await SpotifyAPI.play({ uris: [qq.uri], position_ms: pos })
          }
        }
      } catch (e) {
        console.error("Kunne ikke starte låta igjen:", e)
      }
    }
  }

  // UI
  const tSec = Math.floor(secsSinceStart(roomState))
  const winScore = windowScore(roomState)
  const lockedInfo = buzz?.lockWindow

  const activePlayers = Object.entries(players).filter(([_, p]) => (p.lastSeen || 0) >= (round?.createdAt || 0))

  return (
    <div className="card vstack">
      <div style={{ textAlign: 'center', marginBottom: '24px' }}>
        <h2 style={{ fontSize: '2.5rem', marginBottom: '8px' }}>🎮 Spillvisning</h2>
        <p style={{ color: 'var(--music-pink)', fontSize: '1.1rem', margin: 0, fontWeight: '600' }}>
          Kontrollpanel for verten
        </p>
      </div>

      {/* Kontroller */}
      <div className="vstack" style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: '1.4rem', margin: '0 0 12px 0' }}>🎵 Spotify Kontroller</h3>
        <div className="hstack" style={{ gap: 12, flexWrap: 'wrap' }}>
          <button onClick={initWebPlayer}>Aktiver nettleser-spiller</button>
            <button onClick={transferHere}>🔄 Overfør avspilling hit</button>
            <button onClick={refreshDevices}>📱 Sjekk enheter</button>
          <span className="badge" style={{ fontSize: '14px', padding: '10px 16px' }}>{playerStatus}</span>
        </div>
        {playError && (
          <div className="banner err" style={{ fontSize: '14px', padding: '16px' }}>
            {playError}
          </div>
        )}
      </div>

      {!round ? (
        <div className="banner" style={{ textAlign: 'center', padding: '32px' }}>
          <h3 style={{ margin: '0 0 16px 0', color: 'var(--warning)' }}>⚠️ Ingen runde funnet</h3>
          <p style={{ margin: '0 0 20px 0', fontSize: '16px' }}>
            Du må først bygge en runde med spillelister og spørsmål.
          </p>
          <button 
            className="primary" 
            onClick={() => nav('/host')}
            style={{ fontSize: '16px', padding: '16px 32px' }}
          >
            🎤 Gå til Vertspanel
          </button>
        </div>
      ) : (
        <>
          <div className="hstack" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '20px' }}>
            <div className="vstack" style={{ gap: '8px' }}>
              <div style={{ fontSize: '16px' }}>
                🏠 Rom: <span className="badge" style={{ fontSize: '15px', padding: '8px 16px' }}>{room}</span>
              </div>
              <div style={{ fontSize: '16px' }}>
                ❓ Spørsmål: <span className="badge" style={{ fontSize: '15px', padding: '8px 16px', background: 'var(--accent-weak)', borderColor: 'var(--accent)', color: 'var(--accent)' }}>
                  {roomState.idx + 1}/{round.questions.length}
                </span>
              </div>
            </div>
            <div className="hstack" style={{ gap: 12, flexWrap: 'wrap' }}>
              {roomState.phase === 'idle' ? (
                <button 
                  className="primary"
                  onClick={() => startQuestion(0)} 
                  title={!deviceId ? 'Aktiver nettleser-spiller først' : ''}
                  style={{ fontSize: '16px', padding: '16px 24px' }}
                >
                  🎬 Start runde (spm #1)
                </button>
              ) : (
                <>
                  <button className="primary" onClick={nextQuestion}>⏭ Neste spørsmål</button>
                  <button className="ghost" onClick={() => revealFasit(true)}>💡 Vis fasit (3s)</button>
                  <button className="ghost" onClick={resetToFirst} title="Tilbake til første spørsmål">🔄 Start på nytt</button>
                </>
              )}
            </div>
          </div>

          <div className="btn-row" style={{ marginTop: 16 }}>
            <button className="ghost" onClick={() => nav("/")}>🏠 Til Lobby</button>
          </div>

          <hr />

          {/* Status */}
          <div className="hstack sticky-top" style={{ gap: 20, flexWrap: 'wrap', alignItems: 'center', padding: '24px 0' }}>
            <div className={`phase-indicator ${roomState.phase}`}>
              {roomState.phase === 'idle' && '⏸️ Venter'}
              {roomState.phase === 'playing' && '🎵 Spiller'}
              {roomState.phase === 'buzzed' && '🚨 Buzzet'}
              {roomState.phase === 'reveal' && '💡 Fasit'}
              {roomState.phase === 'ended' && '🏁 Ferdig'}
            </div>
            {(roomState.phase !== 'idle' && roomState.phase !== 'ended') && (
              <>
                <span className="badge" style={{ fontSize: '16px', padding: '10px 16px' }}>
                  ⏰ {tSec} sekunder
                </span>
                <span className="badge" style={{ 
                  fontSize: '16px', 
                  padding: '10px 16px',
                  background: 'var(--accent-weak)',
                  borderColor: 'var(--accent)',
                  color: 'var(--accent)'
                }}>
                  🎯 {roomState.phase === 'buzzed' && typeof lockedInfo === 'number' ? lockedInfo : winScore} poeng
                </span>
                {typeof lockedInfo === 'number' && buzz && (
                  <span className="badge pulse" style={{ 
                    background: 'var(--warning-weak)',
                    borderColor: 'var(--warning)',
                    color: 'var(--warning)'
                  }}>
                    🔒 {buzz.name}: {lockedInfo}p
                  </span>
                )}
                {roomState.wrongAtAny && (
                  <span className="badge" style={{ 
                    background: 'var(--err-weak)',
                    borderColor: 'var(--err)',
                    color: 'var(--err)'
                  }}>
                    ❌ Første feil
                  </span>
                )}
              </>
            )}
            {buzz && (
              <span className="badge pulse" style={{ 
                background: 'var(--accent-weak)',
                borderColor: 'var(--accent)',
                color: 'var(--accent)',
                fontSize: '16px',
                padding: '10px 16px',
                fontWeight: 'bold'
              }}>
                🚨 {buzz.name}
              </span>
            )}
          </div>

          {/* Fasit */}
          {roomState.phase === 'reveal' && q && (
            <div className="banner ok" style={{ 
              marginTop: 20, 
              padding: '32px',
              textAlign: 'center',
              fontSize: '20px',
              boxShadow: '0 0 40px rgba(46, 213, 115, 0.4)'
            }}>
              <div style={{ fontSize: '28px', fontWeight: 'bold', marginBottom: '12px', color: 'white' }}>
                💡 RIKTIG SVAR
              </div>
              <div style={{ 
                fontSize: '24px', 
                color: 'white',
                fontWeight: 'bold',
                background: 'rgba(255, 255, 255, 0.1)',
                padding: '16px 24px',
                borderRadius: '16px',
                margin: '16px 0'
              }}>
                🎤 {q.artistNames.join(', ')}<br/>
                <span style={{ fontSize: '20px', opacity: 0.9 }}>🎵 "{q.name}"</span>
              </div>
            </div>
          )}

          {/* Scoreboard */}
          <div className="vstack" style={{ marginTop: 24 }}>
            <div style={{ textAlign: 'center', marginBottom: '20px' }}>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '2rem' }}>🏆 Scoreboard</h3>
              <p style={{ margin: 0, color: 'var(--muted)', fontSize: '14px' }}>
                {activePlayers.length} aktive spillere
              </p>
            </div>
            <div className="scoreboard" style={{ maxHeight: 320, overflow: 'auto' }}>
              {activePlayers.length === 0 && (
                <div style={{ 
                  padding: '40px 20px', 
                  textAlign: 'center',
                  color: 'var(--muted)',
                  fontSize: '16px'
                }}>
                  <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎮</div>
                  <div>Ingen spillere enda</div>
                  <div style={{ fontSize: '14px', marginTop: '8px' }}>
                    Be folk åpne /player og bli med!
                  </div>
                </div>
              )}
              {activePlayers
                .sort(([,a], [,b]) => (b.score || 0) - (a.score || 0))
                .map(([pid, p], index) => (
                <div key={pid} className="scoreboard-row">
                  <div className="hstack" style={{ gap: '16px' }}>
                    <span style={{ 
                      fontSize: '20px',
                      minWidth: '32px',
                      textAlign: 'center'
                    }}>
                      {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`}
                    </span>
                    <div className="score-name" style={{ fontSize: '18px', fontWeight: '600' }}>{p.name}</div>
                  </div>
                  <div className="score-points" style={{ fontSize: '20px' }}>{p.score ?? 0}</div>
                </div>
              ))}
            </div>
          </div>

          {roomState.phase === 'ended' && (
            <div className="vstack" style={{ marginTop: 24 }}>
              <div style={{ 
                textAlign: 'center', 
                fontSize: '28px', 
                fontWeight: 'bold',
                marginBottom: '20px',
                color: 'var(--music-pink)'
              }}>
                🎉 Spillet er ferdig! 🎉
              </div>
              <div className="banner" style={{ textAlign: 'center', marginBottom: '20px' }}>
                <p style={{ margin: 0, fontSize: '18px' }}>
                  Takk for en fantastisk musikkquiz! 🎵
                </p>
              </div>
              <div className="hstack" style={{ gap: 16, justifyContent: 'center' }}>
                <button className="primary" onClick={resetToFirst}>🔄 Spill igjen</button>
                <button className="ghost" onClick={() => nav('/host')}>🏠 Nytt spill</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
