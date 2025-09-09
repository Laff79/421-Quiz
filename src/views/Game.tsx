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

// ... type-definisjoner uendret ...

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
  const [players, setPlayers] = React.useState<Record<string, { name: string; score: number }>>({})

  const room = round?.room || 'EDPN-quiz'
  const q = round?.questions?.[roomState.idx]

  // 🚀 NY: Last runden fra Firebase
  React.useEffect(() => {
    if (!room) return
    const rRef = ref(db, `rooms/${room}/round`)
    const unsub = onValue(rRef, (snap) => {
      const v = snap.val() as RoundPayload | null
      if (v) setRound(v)
    })
    return () => off(rRef)
  }, [room])

  // resten av logikken (startQuestion, applyAnswerResult osv.) uendret

  return (
    <div className="card vstack">
      <h2>Spillvisning</h2>
      {/* resten av UI */}
    </div>
  )
}
