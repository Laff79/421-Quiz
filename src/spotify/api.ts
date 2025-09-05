import { getAccessToken } from '../auth/spotifyAuth'
async function api(path:string, opts:RequestInit={}){
  const token=getAccessToken(); if(!token) throw new Error('Ikke innlogget')
  const res=await fetch(`https://api.spotify.com/v1${path}`,{...opts,headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json',...(opts.headers||{})}})
  if(!res.ok) throw new Error('Spotify API-feil'); return res.json()
}
export const SpotifyAPI={
  me:()=>api('/me'),
  myPlaylists:(limit=50,offset=0)=>api(`/me/playlists?limit=${limit}&offset=${offset}`),
  getPlaylistTracks:(playlistId:string,limit=100,offset=0)=>api(`/playlists/${playlistId}/tracks?limit=${limit}&offset=${offset}`),
  transferPlayback:(deviceId:string)=>fetch('https://api.spotify.com/v1/me/player',{method:'PUT',headers:{'Authorization':`Bearer ${getAccessToken()}`!,'Content-Type':'application/json'},body:JSON.stringify({device_ids:[deviceId],play:false})}),
  play:(data:any)=>fetch('https://api.spotify.com/v1/me/player/play',{method:'PUT',headers:{'Authorization':`Bearer ${getAccessToken()}`!,'Content-Type':'application/json'},body:JSON.stringify(data)}),
  pause:()=>fetch('https://api.spotify.com/v1/me/player/pause',{method:'PUT',headers:{'Authorization':`Bearer ${getAccessToken()}`!}}),
}