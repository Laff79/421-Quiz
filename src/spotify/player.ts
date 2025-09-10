import { getAccessToken } from '../auth/spotifyAuth'

declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady: () => void
    Spotify: any
  }
}

export function loadSpotifySDK(): Promise<void> {
  return new Promise((resolve, reject) => {
    // Allerede lastet?
    if (window.Spotify) return resolve()

    // Script finnes men ikke klart: heng deg på callbacken
    const existing = document.getElementById('spotify-sdk')
    if (existing) {
      window.onSpotifyWebPlaybackSDKReady = () => resolve()
      return
    }

    // Viktig: sett callback FØR vi legger til scriptet
    window.onSpotifyWebPlaybackSDKReady = () => resolve()

    const script = document.createElement('script')
    script.id = 'spotify-sdk'
    script.src = 'https://sdk.scdn.co/spotify-player.js'
    script.onerror = () => reject(new Error('Kunne ikke laste Spotify SDK'))
    document.body.appendChild(script)
  })
}

export async function createWebPlayer(name = 'EDPN Quiz Player'): Promise<{deviceId: string, player: any}> {
  await loadSpotifySDK()
  const token = getAccessToken()
  if (!token) throw new Error('Mangler access token (logg inn på nytt)')

  return new Promise((resolve, reject) => {
    const player = new window.Spotify.Player({
      name,
      getOAuthToken: (cb: (t: string) => void) => cb(token),
      volume: 1.0,
    })
    player.addListener('ready', ({ device_id }: any) => resolve({ deviceId: device_id, player }))
    player.addListener('not_ready', () => console.warn('Web Playback not ready'))
    player.addListener('initialization_error', ({ message }: any) => reject(new Error(message)))
    player.addListener('authentication_error', ({ message }: any) => reject(new Error(message)))
    player.addListener('account_error', ({ message }: any) => reject(new Error(message)))
    player.connect()
  })
}
