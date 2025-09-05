import React from 'react'
import { useSearchParams } from 'react-router-dom'
export default function Host(){
  const [search]=useSearchParams(); const room=search.get('room')||'EDPN-quiz'
  return (<div className="card vstack"><h2>Vertspanel</h2><div>Rom: <span className="badge">{room}</span></div>
    <ul><li>Velg spillelister (TODO)</li><li>Toggle: filtrer explicit (standard: av)</li><li>Test lyd + velg avspillingsenhet</li><li>Start runde (15 spørsmål, tilfeldig trekk, maks 1 pr artist)</li></ul>
    <p>Skjelett – resten implementeres i sanntid/Spotify‑logikken.</p></div>)
}