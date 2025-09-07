import React from 'react'
import { Outlet } from 'react-router-dom'

export default function App() {
  return (
    <div className="w-screen h-screen bg-gray-900 text-white flex flex-col items-center justify-center">
      <h1 className="text-4xl font-bold mb-4">Tailwind funker 🎉</h1>
      <p className="text-lg mb-8">
        Hele skjermen skal være mørkegrå nå.
      </p>

      <div className="bg-gray-800 p-6 rounded-xl shadow-lg">
        <p className="text-center">Her kommer resten av appen din ↓</p>
      </div>

      <Outlet />
    </div>
  )
}
