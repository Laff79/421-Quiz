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
    if (_skipped) {
      setTimeout(() => { void nextQuestion() }, 3000)
    }
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
    <>
      <div className="game-background"></div>
      <div className="glass-card vstack" style={{ margin: '16px', padding: '32px' }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <h2 style={{ 
            margin: 0, 
            fontSize: '3rem',
            background: 'linear-gradient(135deg, var(--accent) 0%, var(--blue) 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text'
          }}>
            🎮 Spillkontroll
          </h2>
        </div>

      {/* Kontroller */}
        <div className="glass-card vstack" style={{ marginBottom: 24, padding: '24px' }}>
          <h3 style={{ margin: '0 0 16px 0', textAlign: 'center' }}>🎵 Lydkontroller</h3>
          <div className="hstack" style={{ gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button className="btn-enhanced primary" onClick={initWebPlayer}>
              🎧 Aktiver nettleser-spiller
            </button>
            <button className="btn-enhanced" onClick={transferHere}>
              🔄 Overfør avspilling hit
            </button>
            <button className="btn-enhanced" onClick={refreshDevices}>
              📱 Sjekk enheter
            </button>
          </div>
          <div style={{ textAlign: 'center', marginTop: '16px' }}>
            <span className="badge" style={{ 
              fontSize: '16px', 
              padding: '12px 20px',
              background: deviceId ? 'var(--ok-weak)' : 'var(--warning-weak)',
              borderColor: deviceId ? 'var(--ok)' : 'var(--warning)',
              color: deviceId ? 'var(--ok)' : 'var(--warning)'
            }}>
              {deviceId ? '✅' : '⚠️'} {playerStatus}
            </span>
        </div>
          {playError && (
            <div className="banner err" style={{ marginTop: '16px', textAlign: 'center' }}>
              {playError}
            </div>
          )}
      </div>

      {!round ? (
        <div className="banner" style={{ textAlign: 'center', padding: '32px' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎵</div>
          <h3 style={{ margin: '0 0 16px 0' }}>Ingen runde funnet</h3>
          <p style={{ margin: '0 0 24px 0', color: 'var(--muted)' }}>
          Ingen runde funnet. Gå til{' '}
            <a href="/" onClick={(e) => { e.preventDefault(); nav('/host') }}>Vert</a>{' '}
            og bygg en runde.
          </p>
          <button className="btn-enhanced primary" onClick={() => nav('/host')}>
            🏠 Gå til Vert
          </button>
        </div>
      ) : (
        <>
          <div className="glass-card" style={{ padding: '24px', marginBottom: '24px' }}>
            <div className="hstack" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <div>
                <div style={{ marginBottom: '8px' }}>
                  🏠 Rom: <span className="badge" style={{ 
                    fontSize: '16px', 
                    padding: '8px 16px',
                    background: 'var(--accent-weak)',
                    borderColor: 'var(--accent)',
                    color: 'var(--accent)'
                  }}>{room}</span>
                </div>
                <div>
                  ❓ Spørsmål: <span className="badge" style={{ 
                    fontSize: '16px', 
                    padding: '8px 16px',
                    background: 'var(--blue)',
                    borderColor: 'var(--blue)',
                    color: 'white'
                  }}>{roomState.idx + 1}/{round.questions.length}</span>
                </div>
            </div>
            </div>
            <div className="hstack" style={{ gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
              {roomState.phase === 'idle' ? (
                <button 
                  className="btn-enhanced primary"
                  onClick={() => startQuestion(0)} 
                  title={!deviceId ? 'Aktiver først' : ''}
                  style={{ fontSize: '18px', padding: '16px 32px' }}
                >
                  🎬 Start runde (spm #1)
                </button>
              ) : (
                <>
                  <button className="btn-enhanced" onClick={() => revealFasit(false)}>
                    👀 Vis fasit (3s)
                  </button>
                  <button className="btn-enhanced" onClick={() => {
                    const ph = roomState && roomState.phase;
                    if (ph === 'playing' || ph === 'buzzed') {
                      revealFasit(true);
                    } else {
                      nextQuestion();
                    }
                  }}>
                    {(roomState && (roomState.phase === 'playing' || roomState.phase === 'buzzed')) ? '⏭ Neste (vis fasit først)' : '⏭ Neste spørsmål'}
                  </button>
                  <button className="btn-enhanced" onClick={resetToFirst} title="Tilbake til første spørsmål">
                    🔄 Start på nytt (til #1)
                  </button>
                </>
              )}
            </div>
          </div>

          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <button className="btn-enhanced" onClick={() => nav("/")}>
              🏠 Til Lobby
            </button>
          </div>


          {/* Status */}
          <div className="glass-card sticky-top" style={{ 
            padding: '20px', 
            marginBottom: '24px',
            background: 'rgba(0, 0, 0, 0.3)',
            backdropFilter: 'blur(25px)'
          }}>
            <div className="hstack" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center' }}>
              <div className={`phase-enhanced ${roomState.phase}`}>
                <div style={{ fontSize: '20px' }}>
              {roomState.phase === 'idle' && '⏸️ Venter'}
              {roomState.phase === 'playing' && '🎵 Spiller'}
              {roomState.phase === 'buzzed' && '🚨 Buzzet'}
              {roomState.phase === 'reveal' && '💡 Fasit'}
              {roomState.phase === 'ended' && '🏁 Ferdig'}
                </div>
                {roomState.phase === 'playing' && (
                  <div className="music-bars">
                    <div className="music-bar"></div>
                    <div className="music-bar"></div>
                    <div className="music-bar"></div>
                    <div className="music-bar"></div>
                    <div className="music-bar"></div>
                  </div>
                )}
            </div>
            {(roomState.phase !== 'idle' && roomState.phase !== 'ended') && (
              <>
                <span className="badge" style={{ 
                  fontSize: '18px', 
                  padding: '12px 20px',
                  background: 'rgba(255, 255, 255, 0.1)',
                  backdropFilter: 'blur(10px)'
                }}>
                  ⏰ {tSec}s
                </span>
                <span className="badge" style={{ 
                  fontSize: '18px', 
                  padding: '12px 20px',
                  background: 'var(--accent-weak)',
                  borderColor: 'var(--accent)',
                  color: 'var(--accent)',
                  fontWeight: 'bold'
                }}>
                  🎯 {roomState.phase === 'buzzed' && typeof lockedInfo === 'number' ? lockedInfo : winScore} poeng
                </span>
                {typeof lockedInfo === 'number' && buzz && (
                  <span className="badge" style={{ 
                    background: 'var(--warning-weak)',
                    borderColor: 'var(--warning)',
                    color: 'var(--warning)',
                    fontSize: '16px',
                    padding: '10px 16px',
                    animation: 'pulse-glow-phase 1s ease-in-out infinite'
                  }}>
                    🔒 {buzz.name}: {lockedInfo}p
                  </span>
                )}
                {roomState.wrongAtAny && (
                  <span className="badge" style={{ 
                    background: 'var(--err-weak)',
                    borderColor: 'var(--err)',
                    color: 'var(--err)',
                    fontSize: '16px',
                    padding: '10px 16px'
                  }}>
                    ❌ Første feil
                  </span>
                )}
              </>
            )}
            {buzz && (
              <span className="badge" style={{ 
                background: 'var(--accent-weak)',
                borderColor: 'var(--accent)',
                color: 'var(--accent)',
                fontSize: '18px',
                padding: '12px 20px',
                fontWeight: 'bold',
                animation: 'pulse-glow-phase 1s ease-in-out infinite'
              }}>
                🚨 {buzz.name}
              </span>
            )}
            </div>
          </div>

          {/* Fasit */}
          {roomState.phase === 'reveal' && q && (
            <div className="result-enhanced correct" style={{ 
              marginTop: 16, 
              marginBottom: 24
            }}>
              <div style={{ fontSize: '32px', marginBottom: '16px' }}>
                💡 FASIT
              </div>
              <div style={{ fontSize: '24px', fontWeight: 'bold' }}>
                {q.artistNames.join(', ')} — {q.name}
              </div>
            </div>
          )}

          {/* Scoreboard */}
          <div className="glass-card vstack" style={{ padding: '24px' }}>
            <h3 style={{ 
              margin: '0 0 24px 0', 
              textAlign: 'center',
              fontSize: '2rem',
              background: 'linear-gradient(135deg, var(--gold) 0%, var(--accent) 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text'
            }}>
              🏆 Scoreboard
            </h3>
            <div className="scoreboard-enhanced" style={{ maxHeight: 400, overflow: 'auto' }}>
              {activePlayers.length === 0 && (<small className="muted">Ingen spillere enda – be folk åpne /player og joine.</small>)}
              {activePlayers
                .sort(([,a], [,b]) => (b.score || 0) - (a.score || 0))
                .map(([pid, p], index) => (
                <div key={pid} className="scoreboard-row-enhanced">
                  <div className="hstack" style={{ gap: '12px' }}>
                    <span style={{ 
                      fontSize: '24px',
                      minWidth: '32px',
                      textAlign: 'center',
                      fontWeight: 'bold'
                    }}>
                      {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`}
                    </span>
                    <div className="score-name" style={{ 
                      fontSize: '18px',
                      fontWeight: index < 3 ? 'bold' : 'normal'
                    }}>
                      {p.name}
                    </div>
                  </div>
                  <div className="score-points" style={{ 
                    fontSize: '20px',
                    fontWeight: 'bold'
                  }}>
                    {p.score ?? 0}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {roomState.phase === 'ended' && (
            <div className="glass-card vstack" style={{ marginTop: 24, padding: '32px' }}>
              <div style={{ 
                textAlign: 'center', 
                fontSize: '32px', 
                fontWeight: 'bold',
                marginBottom: '24px',
                background: 'linear-gradient(135deg, var(--accent) 0%, var(--gold) 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text'
              }}>
                🎉 Spillet er ferdig!
              </div>
              
              {/* Spilleliste-oversikt */}
              <div className="vstack" style={{ marginTop: 32 }}>
                <h3 style={{ 
                  margin: '0 0 20px 0', 
                  textAlign: 'center',
                  fontSize: '1.8rem'
                }}>
                  🎵 Sanger i quizen
                </h3>
                <div 
                  className="glass-card vstack"
                  style={{
                    maxHeight: 500,
                    overflow: 'auto',
                    padding: 16,
                    gap: 12
                  }}
                >
                  {round.questions.map((q, i) => (
                    <div
                      key={q.id} 
                      className="glass-card hstack" 
                      style={{ 
                        justifyContent: 'space-between',
                        padding: '12px 16px',
                        transition: 'all 0.2s ease'
                      }}
                    >
                      <div className="vstack" style={{ gap: 4, flex: 1 }}>
                        <div className="hstack" style={{ gap: 12 }}>
                          <span className="badge" style={{
                            minWidth: '32px', 
                            textAlign: 'center',
                            fontSize: '14px',
                            fontWeight: 'bold'
                          }}>
                            {i + 1}
                          </span>
                          <div>
                            <div style={{ fontWeight: 'bold', fontSize: '18px' }}>
                              {q.name}
                            </div>
                            <div style={{ 
                              color: 'var(--muted)', 
                              fontSize: '15px',
                              marginTop: '2px'
                            }}>
                              👤 {q.artistNames.join(', ')}
                            </div>
                          </div>
                        </div>
                      </div>
                      <div style={{ 
                        fontSize: '14px', 
                        color: 'var(--muted)',
                        textAlign: 'right',
                        fontWeight: '500'
                      }}>
                        ⏱️ {Math.round((q.duration_ms || 0) / 1000)}s
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              
              <div className="hstack" style={{ gap: 16, marginTop: 32, justifyContent: 'center' }}>
                <button className="btn-enhanced" onClick={resetToFirst}>
                  🔄 Start på nytt (til #1)
                </button>
                <button className="btn-enhanced primary" onClick={() => nav('/host')}>
                  🏠 Tilbake til Vert
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
