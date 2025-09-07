import React from 'react'
import { useNavigate } from 'react-router-dom'
export default function Lobby(){
  const nav=useNavigate(); const [room,setRoom]=React.useState('EDPN-quiz')
  return (<div className="card vstack"><h2>Lobby</h2><label>Romnavn</label>
    <input value={room} onChange={e=>setRoom(e.target.value)} placeholder="Velg romnavn"/>
    <div className="hstack" style={{marginTop:12}}>
      <button className="primary" onClick={()=>nav('/host?room='+encodeURIComponent(room))}>Start som vert</button>
      <button className="ghost" onClick={()=>nav('/player?room='+encodeURIComponent(room))}>Bli med som spiller</button>
    </div><p className="muted">Del romnavnet på storskjerm eller som QR (kommer i vertspanelet).</p></div>)
}