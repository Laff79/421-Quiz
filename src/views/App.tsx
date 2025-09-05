import React from 'react'
import { Outlet, Link } from 'react-router-dom'
import { beginLogin } from '../auth/spotifyAuth'
import { ensureAnonAuth } from '../firebase/init'
export default function App(){
  React.useEffect(()=>{ ensureAnonAuth().catch(console.error) },[])
  return (<div className="container">
    <div className="hstack" style={{justifyContent:'space-between',marginBottom:12}}>
      <div className="hstack" style={{gap:12}}><Link to="/">Lobby</Link><Link to="/host">Vert</Link><Link to="/player">Spiller</Link></div>
      <button className="ghost" onClick={()=>beginLogin()}>Logg inn med Spotify</button>
    </div><Outlet/></div>)
}