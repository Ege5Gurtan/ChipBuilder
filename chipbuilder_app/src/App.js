import React, { useCallback, useState } from 'react';
import ThreeScene from './ThreeScene.js';
import levels from './levels.js';
import { createGame, depositCargo, fabricate, fabricateCell, movePlayer, returnSignalBit } from './gameRules.js';
import { FAB_TOOLS } from './terrain.js';
import './App.css';

function Bit({ value }) {
  return <span className={`bit bit-${value}`}>{value}</span>;
}

function App() {
  const [levelIndex, setLevelIndex] = useState(0);
  const [unlockedLevel, setUnlockedLevel] = useState(0);
  const [game, setGame] = useState(() => createGame(levels[0]));
  const [selectedCargoId, setSelectedCargoId] = useState(null);
  const [selectedTool, setSelectedTool] = useState('lithography');
  const level = levels[levelIndex];

  const changeLevel = (index) => {
    setLevelIndex(index);
    setGame(createGame(levels[index]));
    setSelectedCargoId(null);
  };

  const restart = () => {
    setGame(createGame(level));
    setSelectedCargoId(null);
  };

  const handleMove = useCallback((movement) => {
    setGame((current) => movePlayer(level, current, movement));
  }, [level]);

  const deposit = (cargoId, target) => {
    if (!cargoId) return;
    setGame((current) => depositCargo(level, current, cargoId, target));
    setSelectedCargoId(null);
  };

  const allowDrop = (event) => event.preventDefault();
  const handleDrop = (event, target) => {
    event.preventDefault();
    deposit(event.dataTransfer.getData('text/plain'), target);
  };

  const runFabrication = (action) => {
    setGame((current) => fabricate(level, current, action));
  };

  const paintTerrain = (col, row, newStroke) => {
    setGame((current) => fabricateCell(current, selectedTool, col, row, newStroke));
  };

  const nextLevel = () => {
    const nextIndex = Math.min(levelIndex + 1, levels.length - 1);
    setUnlockedLevel((current) => Math.max(current, nextIndex));
    changeLevel(nextIndex);
  };

  return (
    <main className="game-shell">
      <header className="topbar">
        <div className="brand-block">
          <span className="brand-mark" aria-hidden="true">SC</span>
          <div>
            <p className="eyebrow">Wafer logic lab</p>
            <h1>SemiConGame</h1>
          </div>
        </div>
        <nav className="level-nav" aria-label="Levels">
          {levels.map((item, index) => (
            <button
              key={item.id}
              className={index === levelIndex ? 'active' : ''}
              disabled={index > unlockedLevel}
              onClick={() => changeLevel(index)}
              aria-label={`Level ${item.number}: ${item.title}`}
            >
              {item.number}
            </button>
          ))}
        </nav>
        <button className="restart-button" onClick={restart}>Restart level</button>
      </header>

      <section className={`telemetry ${game.terrain ? 'terrain-telemetry' : ''}`} aria-label="Live signal status">
        <div>
          <span>Target signal</span>
          <strong className="signal-value">{level.target}</strong>
        </div>
        <div>
          <span>Current signal</span>
          <strong className="signal-value">{game.signal.join('') || '—'}</strong>
        </div>
        <div>
          <span>Cargo</span>
          <strong>{game.cargo.length} bit{game.cargo.length === 1 ? '' : 's'}</strong>
        </div>
        <div>
          <span>Process steps</span>
          <strong>{game.cost.processSteps}</strong>
        </div>
        <div>
          <span>Energy</span>
          <strong>{game.cost.energy} u</strong>
        </div>
        {game.terrain && <div><span>Manufacturing cost</span><strong>{game.cost.manufacturing} credits</strong></div>}
      </section>

      <div className="game-layout">
        <aside className="mission-panel">
          <p className="level-number">LEVEL {level.number}</p>
          <h2>{level.title}</h2>
          <div className="goal-block">
            <span>Goal</span>
            <p>{level.goal}</p>
          </div>
          <p className="lesson">{level.lesson}</p>
          <div className="controls-note">
            <span>Movement</span>
            <div className="key-row" aria-label="Use W A S D to move">
              <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>
            </div>
          </div>
          <div className="touch-controls" aria-label="On-screen movement controls">
            <button onClick={() => handleMove({ x: 0, y: 0.35 })} aria-label="Move up">↑</button>
            <button onClick={() => handleMove({ x: -0.35, y: 0 })} aria-label="Move left">←</button>
            <button onClick={() => handleMove({ x: 0, y: -0.35 })} aria-label="Move down">↓</button>
            <button onClick={() => handleMove({ x: 0.35, y: 0 })} aria-label="Move right">→</button>
          </div>
        </aside>

        <section className="wafer-panel">
          <ThreeScene level={level} game={game} onMove={handleMove} onPaint={paintTerrain} tool={selectedTool} />
          <div className={`event-strip ${game.status}`} role="status" aria-live="polite">
            <span>{game.status === 'failed' ? 'CHECK FAILED' : game.status === 'success' ? 'DELIVERY OK' : 'SYSTEM'}</span>
            <p>{game.message}</p>
          </div>

          {game.status !== 'playing' && (
            <div className="result-screen" role="dialog" aria-modal="true" aria-labelledby="result-title">
              <div className="result-content">
                <p className="eyebrow">{game.status === 'success' ? 'Signal accepted' : 'Signal rejected'}</p>
                <h2 id="result-title">{game.status === 'success' ? 'Route complete' : 'Destination check failed'}</h2>
                <p>{game.message}</p>
                <div className="cost-summary">
                  <span><b>{game.cost.processSteps}</b> process steps</span>
                  <span><b>{game.cost.energy}</b> energy units</span>
                  {game.terrain && <span><b>{game.cost.manufacturing}</b> fabrication credits</span>}
                </div>
                <div className="result-actions">
                  <button className="secondary-button" onClick={restart}>Restart</button>
                  {game.status === 'success' && levelIndex < levels.length - 1 && (
                    <button className="primary-button" onClick={nextLevel}>Next level</button>
                  )}
                  {game.status === 'success' && levelIndex === levels.length - 1 && (
                    <button className="primary-button" onClick={() => changeLevel(0)}>Replay course</button>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>

        <aside className="signal-panel">
          <section className="tool-section">
            <div className="section-heading">
              <span>01</span>
              <h3>Carrier cargo</h3>
            </div>
            <p className="microcopy">Click a bit, then click a socket. Or drag it directly.</p>
            <div className="cargo-row">
              {game.cargo.length === 0 && <span className="empty-state">Move over a bit to collect it.</span>}
              {game.cargo.map((item) => (
                <button
                  key={item.id}
                  draggable
                  className={`cargo-bit ${selectedCargoId === item.id ? 'selected' : ''}`}
                  onClick={() => setSelectedCargoId(item.id)}
                  onDragStart={(event) => event.dataTransfer.setData('text/plain', item.id)}
                  aria-label={`Cargo bit ${item.value}${selectedCargoId === item.id ? ', selected' : ''}`}
                >
                  <Bit value={item.value} />
                </button>
              ))}
            </div>
          </section>

          {level.gates.map((gate) => {
            const currentGate = game.gateState[gate.id];
            return (
              <section className="tool-section gate-section" key={gate.id}>
                <div className="section-heading">
                  <span>02</span>
                  <h3>{gate.type} gate</h3>
                </div>
                <div className="gate-diagram">
                  <div className="gate-inputs">
                    {gate.inputs.map((input) => {
                      const value = currentGate.inputs[input.id];
                      return (
                        <button
                          key={input.id}
                          className="input-socket"
                          disabled={value !== undefined}
                          onClick={() => deposit(selectedCargoId, { kind: 'gate', gateId: gate.id, inputId: input.id })}
                          onDragOver={allowDrop}
                          onDrop={(event) => handleDrop(event, { kind: 'gate', gateId: gate.id, inputId: input.id })}
                        >
                          <span>{input.label}</span>
                          {value === undefined ? 'drop' : <Bit value={value} />}
                        </button>
                      );
                    })}
                  </div>
                  <div className="gate-body">{gate.type}</div>
                  <div className="gate-output">
                    <span>OUT</span>
                    {currentGate.output === null ? '—' : <Bit value={currentGate.output} />}
                  </div>
                </div>
                <p className="gate-reason">
                  {currentGate.output === null
                    ? `${gate.type} is waiting for ${gate.inputs.length - Object.keys(currentGate.inputs).length} input(s).`
                    : game.message}
                </p>
              </section>
            );
          })}

          {game.terrain && (
            <section className="tool-section fabrication-section">
              <div className="section-heading"><span>02</span><h3>Fabrication · mouse drag</h3></div>
              <p className="microcopy">Select a process, then draw on the wafer. WASD keeps moving the electron.</p>
              {Object.entries(FAB_TOOLS).map(([key, tool]) => (
                <button
                  key={key}
                  className={selectedTool === key ? 'fab-done' : ''}
                  onClick={() => setSelectedTool(key)}
                  aria-pressed={selectedTool === key}
                >
                  <span>{tool.label}</span><small>{tool.base} + {tool.cell}/tile credits</small>
                </button>
              ))}
              <p className="microcopy">Purple oxide → mask → etch. Dark trench → deposit → CMP.</p>
            </section>
          )}

          {level.fabrication && !game.terrain && (
            <section className="tool-section fabrication-section">
              <div className="section-heading">
                <span>02</span>
                <h3>Simplified fabrication</h3>
              </div>
              <p className="microcopy">Actions execute immediately on the highlighted channel.</p>
              <button
                className={game.fabrication.patterned ? 'fab-done' : ''}
                onClick={() => runFabrication('lithography')}
              >
                <span>Lithography</span><small>+1 step · +3 energy</small>
              </button>
              <button
                className={game.fabrication.etched ? 'fab-done' : ''}
                onClick={() => runFabrication('etch')}
              >
                <span>Etch</span><small>+1 step · +4 energy</small>
              </button>
            </section>
          )}

          <section className="tool-section bucket-section">
            <div className="section-heading">
              <span>{level.gates.length || level.fabrication ? '03' : '02'}</span>
              <h3>Signal bucket</h3>
            </div>
            <div
              className="signal-bucket"
              role="button"
              tabIndex={0}
              aria-label="Deposit selected bit into signal bucket"
              onClick={() => deposit(selectedCargoId, { kind: 'signal' })}
              onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); deposit(selectedCargoId, { kind: 'signal' }); } }}
              onDragOver={allowDrop}
              onDrop={(event) => handleDrop(event, { kind: 'signal' })}
            >
              <span className="bucket-label">DEPOSIT</span>
              <span className="bucket-bits">
                {game.signal.length === 0 ? 'Drop or click here' : game.signal.map((value, index) => (
                  <span
                    role="button"
                    tabIndex={0}
                    className="placed-bit"
                    key={`${value}-${index}`}
                    aria-label={`Return signal bit ${value} to cargo`}
                    onClick={(event) => { event.stopPropagation(); setGame((current) => returnSignalBit(current, index)); }}
                    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); setGame((current) => returnSignalBit(current, index)); } }}
                  ><Bit value={value} /></span>
                ))}
              </span>
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}

export default App;
