import React from 'react'
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom'
import { beginLogin, getAccessToken } from '../auth/spotifyAuth'
import { ensureAnonAuth } from '../firebase/init'

export default function App() {
  const nav = useNavigate()
  const location = useLocation()
  const isPlayerRoute = location.pathname.includes('/player')
  const [isLoggedIn, setIsLoggedIn] = React.useState(false)

  function goToActiveGame(e?: React.MouseEvent) {
    if (e) e.preventDefault()
    const raw = sessionStorage.getItem('edpn_round')
    if (raw) {
      nav('/game')
    } else {
      nav('/host')
    }
  }

  React.useEffect(() => {
    ensureAnonAuth().catch(console.error)
    // sjekk Spotify-token
    const token = getAccessToken()
    setIsLoggedIn(!!token)
  }, [])

  return (
    <div className="container">
      {!isPlayerRoute && (
      <div
        className="hstack sticky-top"
        style={{ justifyContent: 'space-between', marginBottom: 12 }}
      >
        <div className="hstack" style={{ gap: 12 }}>
          <Link to="/">Lobby</Link>
          <Link to="/host">Vert</Link>
          <Link to="/player">Spiller</Link>
          {location.pathname.startsWith('/host') && (
            <a href="/game" onClick={goToActiveGame}>
              Game
            </a>
          )}
        </div>

        {!isLoggedIn ? (
          <button className="ghost" onClick={() => beginLogin()}>
            Logg inn med Spotify
          </button>
        ) : (
          <span className="badge">Spotify innlogget ✔</span>
        )}
      </div>
      )}
      <Outlet />
    </div>
  )
}
