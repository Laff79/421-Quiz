import React from 'react'
import { useSearchParams } from 'react-router-dom'
export default function Player(){
  const [search]=useSearchParams(); const room=search.get('room')||'EDPN-quiz'
  const [name,setName]=React.useState('Spiller')
  return (<div className="card vstack"><h2>Spiller</h2><div>Rom: <span className="badge">{room}</span></div>
    <label>Spillernavn (unikt i rommet)</label><input value={name} onChange={e=>setName(e.target.value)}/>
    <div className="hstack" style={{marginTop:12}}><button className="primary">Join</button><button className="ghost">Forlat</button></div>
    <hr/><div className="vstack"><button className="primary" style={{fontSize:24,padding:'24px 32px'}}>STOPP</button>
    <input placeholder="Skriv artistnavn…"/><button className="ghost">Send svar</button></div></div>)
}