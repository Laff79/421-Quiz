import React from 'react'
import { useSearchParams } from 'react-router-dom'
import { createWebPlayer } from '../spotify/player'
import { SpotifyAPI } from '../spotify/api'

const TEST_TRACK = '11dFghVXANMlKmJXsNCbNl' // Spotify sin demo-låt-ID

export default function Host() {
  const [search] = useSearchParams()
  const room = search.get('room') || 'EDPN-quiz'

  const [deviceId, setDeviceId] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState<string>('Klar')

  async function initPlayer() {
    try {
      setStatus('Starter nettleser-spiller…')
      const { deviceId: id } = await createWebPlayer('EDPN Quiz Player')
      setDeviceId(id)
      setStatus(`Spiller klar (device: ${id}). Overfører…`)
      await SpotifyAPI.transferPlayback(id)
      setStatus('Overført til nettleser-enheten 👍')
    } catch (e: any) {
      setStatus('Feil ved oppstart: ' + e?.message)
    }
  }

  async function playTest() {
    try {
      if (!deviceId) {
        setStatus('Ingen enhet enda – trykk “Start nettleser-spiller” først')
        return
      }
      setStatus('Spiller testsang…')
      await SpotifyAPI.play({ uris: [`spotify:track:${TEST_TRACK}`] })
      setStatus('Spiller 🎵 (hør i PA/høyttaler som får lyd fra nettleseren)')
    } catch (e: any) {
      setStatus('Feil ved avspilling: ' + e?.message)
    }
  }

  async function pauseTest() {
    try {
      await SpotifyAPI.pause()
      setStatus('Pauset ⏸')
    } catch (e: any) {
      setStatus('Feil ved pause: ' + e?.message)
    }
  }

  return (
    <div className="card vstack">
      <h2>Vertspanel</h2>
      <div>Rom: <span className="badge">{room}</span></div>

      <hr />

      <div className="vstack">
        <strong>Lydtest</strong>
        <div className="hstack" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="primary" onClick={initPlayer}>Start nettleser-spiller</button>
          <button className="ghost" onClick={playTest}>Spill testsang</button>
          <button className="ghost" onClick={pauseTest}>Pause</button>
        </div>
        <small className="badge">{status}</small>
      </div>

      <hr />

      <ul>
        <li>Velg spillelister (TODO)</li>
        <li>Toggle: filtrer explicit (standard: av)</li>
        <li>Start runde (15 spørsmål, tilfeldig trekk, maks 1 pr artist)</li>
      </ul>
      <p>Dette er skjelettet – nå med lydtest.</p>
    </div>
  )
}
