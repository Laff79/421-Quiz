import React from 'react'
import { Outlet } from 'react-router-dom'

export default function App() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-900 text-white">
      <h1 className="text-4xl font-bold mb-4">Tailwind funker 🎉</h1>
      <p className="text-lg mb-8">
        Hvis du ser mørk bakgrunn og hvit tekst, er Tailwind på plass.
      </p>

      <div className="bg-gray-800 p-6 rounded-xl shadow-lg">
        <p className="text-center">Her kommer resten av appen din ↓</p>
      </div>

      {/* Router Outlet viser resten av sidene dine (Lobby, Host, Player, osv.) */}
      <Outlet />
    </div>
  )
}
