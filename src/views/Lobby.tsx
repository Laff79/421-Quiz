import React from 'react'
import { useNavigate } from 'react-router-dom'
export default function Lobby(){
  const nav=useNavigate(); const [room,setRoom]=React.useState('EDPN-quiz')
  return (<div className="card vstack">
    <div style={{ textAlign: 'center', marginBottom: '24px' }}>
      <h1 style={{ fontSize: '3rem', marginBottom: '8px' }}>🎵 EDPN Musikkquiz</h1>
      <p style={{ fontSize: '1.2rem', color: 'var(--music-pink)', fontWeight: '600', margin: 0 }}>
        Test dine musikkkunnskaper! 🎤
      </p>
    </div>
    
    <div className="vstack" style={{ gap: '20px' }}>
      <label>🏠 Romnavn</label>
    <input value={room} onChange={e=>setRoom(e.target.value)} placeholder="Velg romnavn"/>
      
      <div className="btn-row" style={{ marginTop: '24px', gap: '20px' }}>
        <button 
          className="primary" 
          onClick={() => nav('/host?room=' + encodeURIComponent(room))}
          style={{ flex: 1, minWidth: '200px' }}
        >
          🎤 Start som vert
        </button>
        <button 
          className="ghost" 
          onClick={() => nav('/player?room=' + encodeURIComponent(room))}
          style={{ flex: 1, minWidth: '200px' }}
        >
          🎮 Bli med som spiller
        </button>
      </div>
      
      <div className="banner" style={{ textAlign: 'center', marginTop: '16px' }}>
        <p style={{ margin: 0, fontSize: '16px' }}>
          💡 <strong>Tips:</strong> Verten deler romnavnet på storskjerm eller som QR-kode
        </p>
        <p style={{ margin: '8px 0 0 0', fontSize: '14px', opacity: 0.8 }}>
          🎯 Buzz inn når du kjenner artisten • 🏆 Få poeng basert på hvor raskt du svarer
        </p>
      </div>
    </div>
  </div>)
}