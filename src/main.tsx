import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import App from './views/App'
import Callback from './auth/Callback'
import Lobby from './views/Lobby'
import Host from './views/Host'
import Player from './views/Player'
import Game from './views/Game'
import './index.css' // ✅ Bruk Tailwind i stedet for gamle styles

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Lobby /> },
      { path: 'host', element: <Host /> },
      { path: 'player', element: <Player /> },
      { path: 'game', element: <Game /> },
      { path: 'callback', element: <Callback /> },
    ],
  },
])

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
)
