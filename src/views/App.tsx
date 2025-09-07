import React from 'react'
import { Outlet } from 'react-router-dom'

export default function App() {
  return (
    <div className="w-screen h-screen bg-gray-900 text-white">
      <div className="flex flex-col items-center justify-center h-full">
        <h1 className="text-4xl font-bold mb-4">Tailwind funker 🎉</h1>
        <p className="text-lg mb-8">Nå skal hele skjermen være mørk grå.</p>

        <div className="bg-gray-800 p-6 rounded-xl shadow-lg">
          <p className="text-center">Her kommer resten av appen din ↓</p>
        </div>

        {/* Router Outlet viser sidene (Lobby, Host, Player, Game) */}
        <Outlet />
      </div>
    </div>
  )
}
