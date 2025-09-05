import { getAccessToken } from '../auth/spotifyAuth'
declare global { interface Window { onSpotifyWebPlaybackSDKReady:any; Spotify:any } }
export function loadSpotifySDK(): Promise<void> {
  return new Promise((resolve,reject)=>{ if(document.getElementById('spotify-sdk')) return resolve()
    const s=document.createElement('script'); s.id='spotify-sdk'; s.src='https://sdk.scdn.co/spotify-player.js'
    s.onload=()=>resolve(); s.onerror=()=>reject(new Error('Kunne ikke laste Spotify SDK')); document.body.appendChild(s)
  })
}
export async function createWebPlayer(name='EDPN Quiz Player'):Promise<{deviceId:string,player:any}>{
  await loadSpotifySDK(); const token=getAccessToken(); if(!token) throw new Error('Mangler access token')
  return new Promise((resolve,reject)=>{
    const player=new window.Spotify.Player({ name, getOAuthToken:(cb:(t:string)=>void)=>cb(token), volume:1.0 })
    player.addListener('ready',({ device_id }:any)=>resolve({deviceId:device_id, player}))
    player.addListener('not_ready',()=>console.warn('Web Playback not ready'))
    player.addListener('initialization_error',({message}:any)=>reject(new Error(message)))
    player.addListener('authentication_error',({message}:any)=>reject(new Error(message)))
    player.addListener('account_error',({message}:any)=>reject(new Error(message)))
    player.connect()
  })
}