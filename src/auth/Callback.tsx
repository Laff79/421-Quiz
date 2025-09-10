import React,{useEffect,useState} from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { exchangeCodeForToken } from './spotifyAuth'
export default function Callback(){
  const [search]=useSearchParams(); const nav=useNavigate(); const [status,setStatus]=useState('Veksler kode…')
  useEffect(()=>{ const code=search.get('code'); if(!code){ setStatus('Mangler kode fra Spotify.'); return }
    exchangeCodeForToken(code).then(()=>{ setStatus('Innlogget!'); nav('/',{replace:true})}).catch(()=>setStatus('Kunne ikke logge inn. Prøv igjen.')) },[])
  return <div className="container"><p>{status}</p></div>
}