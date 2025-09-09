import React, { useState, useEffect } from "react";

const Player: React.FC = () => {
  const [currentPoints, setCurrentPoints] = useState(4);
  const [hasStopped, setHasStopped] = useState(false);
  const [answer, setAnswer] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [score, setScore] = useState(0);

  // Teller ned poeng etter tid
  useEffect(() => {
    if (hasStopped) return; // ikke fortsett nedtelling etter stopp

    setCurrentPoints(4); // reset på start

    const t1 = setTimeout(() => setCurrentPoints(2), 20000);
    const t2 = setTimeout(() => setCurrentPoints(1), 40000);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [hasStopped]);

  const handleStop = () => {
    setHasStopped(true);
  };

  const handleSubmit = () => {
    if (answer.trim() === "") return;

    // TODO: her kan du legge inn logikk for å sjekke riktig svar
    const isCorrect = true; // midlertidig – alltid riktig

    if (isCorrect) {
      setScore(currentPoints);
    } else {
      setScore(0);
    }
    setSubmitted(true);
  };

  return (
    <div style={{ textAlign: "center", marginTop: "2rem" }}>
      {!hasStopped && !submitted && (
        <>
          <h2>Poeng nå: {currentPoints}</h2>
          {currentPoints === 4 && <p>(deretter 2 → 1)</p>}
          {currentPoints === 2 && <p>(deretter 1)</p>}
          {currentPoints === 1 && <p>(siste sjanse)</p>}

          <button onClick={handleStop} style={{ marginTop: "1rem" }}>
            STOPP
          </button>
        </>
      )}

      {hasStopped && !submitted && (
        <div style={{ marginTop: "2rem" }}>
          <h3>Skriv svaret ditt:</h3>
          <input
            type="text"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            style={{ padding: "0.5rem", fontSize: "1rem" }}
          />
          <br />
          <button onClick={handleSubmit} style={{ marginTop: "1rem" }}>
            Send svar
          </button>
        </div>
      )}

      {submitted && (
        <div style={{ marginTop: "2rem" }}>
          <h2>Du fikk {score} poeng!</h2>
        </div>
      )}
    </div>
  );
};

export default Player;
