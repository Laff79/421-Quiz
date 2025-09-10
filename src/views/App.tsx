// src/views/App.tsx
import React from "react";
import { Outlet, Link, useLocation } from "react-router-dom";
import "../styles.css";

export default function App() {
  const loc = useLocation();
  return (
    <div>
      <header className="topbar">
        <div className="wrap">
          <Link to="/" className="brand">EDPN Spotify Quiz</Link>
          <span className="path">{loc.pathname}</span>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
