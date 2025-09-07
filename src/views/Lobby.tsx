import React from 'react'

export default function Lobby() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white">
      <div className="w-full max-w-md bg-gray-800 rounded-xl shadow-lg p-8">
        <h1 className="text-3xl font-bold text-center mb-6">Velkommen til Quiz 🎵</h1>
        
        <p className="text-center mb-4 text-gray-300">
          Vent på at verten starter spillet, eller bli med som spiller.
        </p>

        <div className="flex flex-col space-y-4">
          <button className="w-full py-3 rounded-lg bg-green-600 hover:bg-green-700 transition font-semibold">
            Bli med som spiller
          </button>
          <button className="w-full py-3 rounded-lg bg-blue-600 hover:bg-blue-700 transition font-semibold">
            Start som vert
          </button>
        </div>
      </div>
    </div>
  )
}
