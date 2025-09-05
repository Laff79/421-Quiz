import React from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { SpotifyAPI } from '../spotify/api'
import { createWebPlayer } from '../spotify/player'
import { db } from '../firebase/init'
import { ref, onValue, set, update, runTransaction, off, get } from 'firebase/database'
import { currentScoreAt } from '../logic/score'
import { isArtistMatch } from '../logic/text'

type RoundQ = { id: string; uri: string; name: string; artistNames: string[]; duration_ms: number }
type RoundPayload = { createdAt: number; room: string; selectedPlaylists: string[]; totalCandidates: number; questions: RoundQ[] }
type RoomState = { idx: number; phase: 'idle'|'playing'|'buzzed'|'reveal'|'ended'; startedAt?: number; wrongAtAny?: boolean; revealUntil?: number }
type Buzz = { playerId: string; name: string; at: number } | null
type Answer = { playerId: string; text: string; at: number } | null

const ANSWER_SECONDS = 15
const AUTO_SKIP_SECONDS = 90

export default function Game() {
  const nav = useNavigate()
  const [search] = useSearchParams()
  const urlRoom = search.get('room') || 'EDPN-quiz'

  const [round, setRound] = React.useState<RoundPayload | null>(null)
  const [roomState, setRoomState] = React.useState<RoomState>({ idx: 0, phase: 'idle' })
  const [buzz, setBuzz] = React.useState<Buzz>(null)
  const [answer, setAnswer] = React.useState<Answer>(null)
  const [players, setPlayers] = React.useState<Record<string, { name: string; score: number }>>({})

  // Nettleser-spiller
  const [deviceId, setDeviceId] = React.useState<string | null>(null)
  const [playerStatus, setPlayerStatus] = React.useState('Ikke aktiv')
  async function initWebPlayer() {
    try {
      setPlayerStatus('Aktiverer…')
      const { deviceId: id, player } = await createWebPlayer('EDPN Quiz Player')
      await (player as any)?.activateElement?.()
      setDeviceId(id)
      await SpotifyAPI.transferPlayback(id)
      setPlayerStatus(`Klar (device: ${id})`)
    } catch (e: any) { setPlayerStatus('Feil: ' + (e?.message || 'ukjent')) }
  }

  // Last runde: først fra sessionStorage, ellers fra Firebase
  React.useEffect(() => {
    const raw = sessionStorage.getItem('edpn_round')
    if (raw) {
      setRound(JSON.parse(raw) as RoundPayload)
      return
    }
    // Fallback: hent fra DB
    get(ref(db, `rooms/${urlRoom}/round`)).then(snap => {
      const r = snap.val() as RoundPayload | null
      if (r) setRound(r)
    }).catch(console.error)
  }, [urlRoom])

  const room = round?.room || urlRoom
  const q = round?.questions?.[roomState.idx]

  // Firebase bindings
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

  // Helpers
  function nowMs(){ return Date.now() }
  function secsSinceStart(s: RoomState){ return !s.startedAt ? 0 : Math.max(0, (nowMs()-s.startedAt)/1000) }
  function windowScore(s: RoomState){ return currentScoreAt(secsSinceStart(s), s.wrongAtAny) }

  async function startQuestion(nextIdx?: number) {
    if (!round) return
    if (!deviceId) { setPlayerStatus('Mangler nettleser-spiller – klikk “Aktiver nettleser-spiller”.'); return }
    const idx = typeof nextIdx === 'number' ? nextIdx : roomState.idx
    const qq = round.questions[idx]; if (!qq) return
    await set(ref(db, `rooms/${room}/buzz`), null)
    await set(ref(db, `rooms/${room}/answer`), null)
    await update(ref(db, `rooms/${room}/state`), { idx, phase:'playing', startedAt: nowMs(), wrongAtAny:false, revealUntil:null })
    await SpotifyAPI.play({ uris:[qq.uri], position_ms:0 })
    setTimeout(() => { const s = roomState; if (s.phase==='playing' && s.idx===idx) revealFasit(true) }, AUTO_SKIP_SECONDS*1000)
  }

  async function revealFasit(_skipped=false){
    await SpotifyAPI.pause().catch(()=>{})
    const until = nowMs() + 3000
    await update(ref(db, `rooms/${room}/state`), { phase:'reveal', revealUntil: until })
    setTimeout(()=>{ nextQuestion() }, 3000)
  }

  async function nextQuestion(){
    if (!round) return
    const next = roomState.idx + 1
    if (next >= round.questions.length) { await update(ref(db, `rooms/${room}/state`), { phase:'ended' }); return }
    await startQuestion(next)
  }

  // Buzz → pause + 15s vindu
  React.useEffect(() => {
    if (!buzz || roomState.phase !== 'playing') return
    ;(async ()=>{
      try { await SpotifyAPI.pause() } catch {}
      await update(ref(db, `rooms/${room}/state`), { phase:'buzzed' })
      setTimeout(async ()=>{
        const sSnap = await get(ref(db, `rooms/${room}/state`))
        const s = (sSnap.val() || {}) as RoomState
        const aSnap = await get(ref(db, `rooms/${room}/answer`))
        const a = aSnap.val() as Answer
        if (s.phase==='buzzed' && !a && buzz) await applyAnswerResult(false, '', buzz.playerId)
      }, ANSWER_SECONDS*1000)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buzz?.playerId])

  // Answer → vurdering
  React.useEffect(() => {
    if (!answer || !round) return
    ;(async ()=>{
      const ok = isArtistMatch(answer.text || '', (round.questions[roomState.idx]?.artistNames)||[], 0.85)
      await applyAnswerResult(ok, answer.text, answer.playerId)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answer?.playerId, answer?.text])

  async function applyAnswerResult(correct:boolean, text:string, playerId:string){
    const sSnap = await get(ref(db, `rooms/${room}/state`))
    const s = (sSnap.val() || {}) as RoomState
    const tSec = secsSinceStart(s)
    let dropWrong=false
    let scoreWindow = currentScoreAt(tSec, s.wrongAtAny)
    if (!correct && tSec < 20 && !s.wrongAtAny){ dropWrong=true; scoreWindow=4 }
    const delta = correct ? scoreWindow : -scoreWindow
    await runTransaction(ref(db, `rooms/${room}/players/${playerId}/score`), curr => (typeof curr==='number'?curr:0)+delta)
    if (dropWrong) await update(ref(db, `rooms/${room}/state`), { wrongAtAny:true })

    const idx = typeof s.idx==='number' ? s.idx : roomState.idx
    const accepted = round!.questions[idx]?.artistNames || []
    const pname = (Object.values(players).find(p=>p) as any)?.name // ikke kritisk
    await set(ref(db, `rooms/${room}/lastResult`), {
      playerId, name: pname, correct, points: delta, window: Math.abs(scoreWindow), text, accepted, at: Date.now(),
    })
    await revealFasit(false)
  }

  // UI
  const tSec = Math.floor(secsSinceStart(roomState))
  const winScore = windowScore(roomState)

  return (
    <div className="card vstack">
      <h2>Spillvisning</h2>

      {/* Aktiver nettleser-spiller */}
      <div className="vstack" style={{ marginBottom: 8 }}>
        <div className="hstack" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="primary" onClick={initWebPlayer}>Aktiver nettleser-spiller</button>
          <span className="badge">{playerStatus}</span>
        </div>
        <small className="muted">Må trykkes én gang pga. autoplay-regler.</small>
      </div>

      {!round && <p>Ingen runde funnet for rom <span className="badge">{urlRoom}</span>. Gå til <a href="/" onClick={(e)=>{e.preventDefault(); nav('/host?room='+encodeURIComponent(urlRoom))}}>Vert</a> og trykk “Bygg runde” → “Send til spill”.</p>}

      {round && (
        <>
          <div className="hstack" style={{ justifyContent:'space-between', alignItems:'center' }}>
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

          <div className="hstack" style={{ gap: 12, flexWrap: 'wrap' }}>
            <span className="badge">Fase: {roomState.phase}</span>
            {roomState.phase!=='idle' && roomState.phase!=='ended' && (
              <>
                <span className="badge">Tid: {tSec}s</span>
                <span className="badge">Poengvindu: {winScore}</span>
                {roomState.wrongAtAny && <span className="badge">Første feil registrert</span>}
              </>
            )}
            {buzz && <span className="badge">Buzz: {buzz.name}</span>}
          </div>

          {/* Scoreboard */}
          <div className="vstack" style={{ marginTop: 8 }}>
            <strong>Score</strong>
            <div className="vstack" style={{ border:'1px solid #eee', borderRadius:12, padding:8, maxHeight:220, overflow:'auto' }}>
              {Object.entries(players).length===0 && <small className="muted">Ingen spillere enda – be folk åpne /player og joine.</small>}
              {Object.entries(players).map(([pid,p])=>(
                <div key={pid} className="hstack" style={{ justifyContent:'space-between' }}>
                  <div>{p.name}</div><div style={{ fontWeight:600 }}>{p.score ?? 0}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Teknisk info (kan skjules) */}
          <div className="vstack" style={{ marginTop: 12 }}>
            <small className
