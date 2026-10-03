import React, { useCallback, useEffect, useRef, useState } from 'react';
import ThreeScene, { editable } from './ThreeScene.js';
import levels from './levels.js';
import { advanceCircuit, circuitConnections, reclaimCircuitSource, applyTerrainProcess, attemptSignalDelivery, createGame, depositCargo, dropCargoBit, fabricate, fabricateCell, isPassThroughGate, movePlayer, reclaimGateInput, reorderCargo, undoTerrainEdit } from './gameRules.js';
import { FAB_TOOLS } from './terrain.js';
import './App.css';

const DRAG_THRESHOLD = 4;

function Bit({ value }) {
  return <span className={`bit bit-${value}`}>{value}</span>;
}

// Keep drag preview order in sync with cargo that changed mid-drag (e.g. a pickup).
function mergeOrder(order, cargo) {
  const ids = new Set(cargo.map((item) => item.id));
  const kept = order.filter((id) => ids.has(id));
  return [...kept, ...cargo.map((item) => item.id).filter((id) => !kept.includes(id))];
}

function App() {
  const [levelIndex, setLevelIndex] = useState(0);
  const [game, setGame] = useState(() => createGame(levels[0]));
  const [selectedCargoId, setSelectedCargoId] = useState(null);
  const [cmpHeight, setCmpHeight] = useState(1);
  const [drag, setDrag] = useState(null);
  const dragRef = useRef(null);
  const pressRef = useRef(null);
  const suppressClick = useRef(false);
  const itemRefs = useRef(new Map());
  const keyboardNav = useRef(false);
  const sceneRef = useRef(null);
  const level = levels[levelIndex];
  const terrainProcesses = level.fabrication?.allowedProcesses || ['lithography', 'etch', 'deposit', 'cmp'];
  const allowLithography = Boolean(game.terrain && terrainProcesses.includes('lithography'));
  const maskedTiles = game.terrain ? game.terrain.flat().filter((cell) => cell.masked).length : 0;
  const selectedId = game.cargo.some((item) => item.id === selectedCargoId) ? selectedCargoId : null;
  const socketGates = level.gates.filter((gate) => !isPassThroughGate(gate) && !gate.wired);
  const connections = level.circuit ? circuitConnections(level, game) : [];
  const flashedIds = game.gateEvent?.ids || [];

  const updateDrag = (next) => { dragRef.current = next; setDrag(next); };

  const resetUi = () => {
    setSelectedCargoId(null);
    setCmpHeight(1);
    pressRef.current = null;
    updateDrag(null);
  };

  const changeLevel = (index) => {
    setLevelIndex(index);
    setGame(createGame(levels[index]));
    resetUi();
  };

  const restart = () => {
    setGame(createGame(level));
    resetUi();
  };

  const handleMove = useCallback((movement) => {
    setGame((current) => movePlayer(level, current, movement));
  }, [level]);

  const tickCircuit = useCallback((delta) => {
    setGame((current) => advanceCircuit(level, current, delta));
  }, [level]);

  const deliver = useCallback(() => {
    setGame((current) => attemptSignalDelivery(level, current));
  }, [level]);

  const drop = useCallback(() => {
    setGame((current) => dropCargoBit(level, current, selectedId));
    setSelectedCargoId(null);
  }, [level, selectedId]);

  useEffect(() => {
    const pointer = () => { keyboardNav.current = false; };
    const keyDown = (event) => {
      if (event.key === 'Tab') { keyboardNav.current = true; return; }
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === 'z' && !event.altKey) {
        if (editable(event.target)) return;
        event.preventDefault();
        if (!event.repeat) setGame((current) => undoTerrainEdit(current));
        return;
      }
      if ((key !== 'enter' && key !== 'k') || event.ctrlKey || event.metaKey || event.altKey) return;
      if (editable(event.target)) return;
      // Let keyboard-navigated controls keep their native Enter behaviour.
      if (keyboardNav.current && event.target.closest?.('button, a, select, [role="button"]')) return;
      event.preventDefault();
      if (event.repeat) return;
      if (key === 'enter') deliver(); else drop();
    };
    window.addEventListener('keydown', keyDown);
    window.addEventListener('pointerdown', pointer, true);
    return () => {
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('pointerdown', pointer, true);
    };
  }, [deliver, drop]);

  const deposit = (cargoId, target) => {
    if (!cargoId) return;
    setGame((current) => depositCargo(level, current, cargoId, target));
    setSelectedCargoId(null);
  };

  const socketAt = (x, y) => sceneRef.current?.gateSocketAtClientPoint(x, y) || null;

  const interactWithGateSocket = (gateId, inputId) => {
    if (inputId === 'source') {
      if (game.circuit.sources[gateId]) setGame((current) => reclaimCircuitSource(current, gateId));
      else if (selectedId) deposit(selectedId, { kind: 'source', sourceId: gateId });
      else setGame((current) => ({ ...current, message: 'Select a cargo bit and click a wire pin, drag it onto the pin, or press K nearby. Walk over a receiving pin to collect its bit.' }));
      return;
    }
    if (level.gates.find((gate) => gate.id === gateId)?.wired) {
      setGame((current) => ({ ...current, message: 'This gate receives bits through copper. Connect SRC to IN, then load the bit at SRC.' }));
      return;
    }
    const loaded = game.gateState[gateId]?.inputs?.[inputId];
    if (loaded !== undefined) {
      setGame((current) => reclaimGateInput(level, current, gateId, inputId));
      return;
    }
    if (!selectedId) {
      setGame((current) => ({ ...current, message: 'Select a cargo bit, or drag one from cargo onto an empty gate input port.' }));
      return;
    }
    setGame((current) => depositCargo(level, current, selectedId, { kind: 'gate', gateId, inputId }));
    setSelectedCargoId(null);
  };

  const cargoPointerDown = (event, id) => {
    suppressClick.current = false;
    if (event.button !== 0 || game.status !== 'playing') return;
    pressRef.current = { id, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const cargoPointerMove = (event) => {
    const press = pressRef.current;
    if (!press) return;
    const current = dragRef.current;
    if (!current && Math.hypot(event.clientX - press.x, event.clientY - press.y) < DRAG_THRESHOLD) return;
    const order = mergeOrder(current?.order || game.cargo.map((item) => item.id), game.cargo);
    let closest = order.indexOf(press.id), best = Infinity;
    order.forEach((id, index) => {
      const rect = itemRefs.current.get(id)?.getBoundingClientRect();
      if (!rect) return;
      const distance = Math.hypot(event.clientX - (rect.left + rect.width / 2), event.clientY - (rect.top + rect.height / 2));
      if (distance < best) { best = distance; closest = index; }
    });
    const next = order.filter((id) => id !== press.id);
    next.splice(closest, 0, press.id);
    updateDrag({ id: press.id, order: next, x: event.clientX, y: event.clientY, socket: socketAt(event.clientX, event.clientY) });
  };

  const cargoPointerUp = () => {
    const current = dragRef.current;
    pressRef.current = null;
    if (!current) return;
    suppressClick.current = true;
    updateDrag(null);
    if (current.socket) {
      const [gateId, inputId] = current.socket.split(':');
      deposit(current.id, inputId === 'source' ? { kind: 'source', sourceId: gateId } : { kind: 'gate', gateId, inputId });
      return;
    }
    const index = mergeOrder(current.order, game.cargo).indexOf(current.id);
    setGame((state) => reorderCargo(state, current.id, index));
  };

  const cargoPointerCancel = () => { pressRef.current = null; updateDrag(null); };

  const cargoClick = (id) => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    setSelectedCargoId((current) => (current === id ? null : id));
  };

  const displayedCargo = drag
    ? mergeOrder(drag.order, game.cargo).map((id) => game.cargo.find((item) => item.id === id))
    : game.cargo;
  const draggedBit = drag && game.cargo.find((item) => item.id === drag.id);

  const runFabrication = (action) => {
    setGame((current) => fabricate(level, current, action));
  };

  const paintTerrain = (col, row, newStroke) => {
    if (!allowLithography) return;
    setGame((current) => fabricateCell(current, 'lithography', col, row, newStroke));
  };

  const runTerrainProcess = (action) => {
    if (!terrainProcesses.includes(action)) return;
    setGame((current) => applyTerrainProcess(current, action, cmpHeight));
  };

  const nextLevel = () => {
    const nextIndex = Math.min(levelIndex + 1, levels.length - 1);
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
          <strong
            key={game.feedback?.seq || 0}
            className={`signal-value target-bits ${game.feedback ? `feedback-${game.feedback.kind}` : ''}`}
            aria-label={`Target ${level.target}, ${game.targetSlots.filter((slot) => slot.delivered).length} of ${game.targetSlots.length} delivered`}
          >
            {game.targetSlots.map((slot, index) => (
              <span key={index} className={`target-bit ${slot.delivered ? 'delivered' : ''}`}>{slot.value}</span>
            ))}
          </strong>
        </div>
        <div>
          <span>Current signal</span>
          <strong className="signal-value target-bits">
            {game.targetSlots.map((slot, index) => (
              <span key={index} className={slot.delivered ? '' : 'unresolved'}>{slot.delivered ? slot.value : '_'}</span>
            ))}
          </strong>
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

      <div className={`game-layout ${level.circuit ? 'circuit-layout' : ''}`}>
        <aside className="mission-panel">
          <p className="level-number">LEVEL {level.number}</p>
          <h2>{level.title}</h2>
          <div className="goal-block">
            <span>Goal</span>
            <p>{level.goal}</p>
          </div>
          <p className="lesson">{level.lesson}</p>
          <div className="controls-note">
            <span>Controls</span>
            <div className="key-line">
              <div className="key-row" aria-hidden="true"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></div>
              <small>Move</small>
            </div>
            <div className="key-line">
              <div className="key-row" aria-hidden="true"><kbd>K</kbd></div>
              <small>{level.circuit ? 'Load nearby wire pin / drop bit' : 'Load nearby gate input / drop bit'}</small>
            </div>
            <div className="key-line">
              <div className="key-row" aria-hidden="true"><kbd className="wide-key">Enter</kbd></div>
              <small>Deliver cargo at DEST</small>
            </div>
            {game.terrain && (
              <div className="key-line">
                <div className="key-row" aria-hidden="true"><kbd className="wide-key">Ctrl+Z</kbd></div>
                <small>Undo last fabrication stroke</small>
              </div>
            )}
          </div>
          <div className="touch-controls" aria-label="On-screen movement controls">
            <button onClick={() => handleMove({ x: 0, y: 0.35 })} aria-label="Move up">↑</button>
            <button onClick={() => handleMove({ x: -0.35, y: 0 })} aria-label="Move left">←</button>
            <button onClick={() => handleMove({ x: 0, y: -0.35 })} aria-label="Move down">↓</button>
            <button onClick={() => handleMove({ x: 0.35, y: 0 })} aria-label="Move right">→</button>
            <button onClick={drop} aria-label="Drop selected cargo bit">K</button>
            <button onClick={deliver} aria-label="Deliver cargo at DEST">↵</button>
          </div>
        </aside>

        <section className="wafer-panel">
          <ThreeScene
            ref={sceneRef}
            level={level}
            game={game}
            onMove={handleMove}
            onTick={tickCircuit}
            onPaint={paintTerrain}
            onGateSocketClick={interactWithGateSocket}
            hoveredSocket={drag?.socket || null}
            interactingCargo={Boolean(selectedId)}
            allowLithography={allowLithography}
          />
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
            <p className="microcopy">
              Ordered left → right. Drag to reorder, click to select, <b>K</b> drops.
              {level.circuit && ' Send a bit by selecting it and clicking a supplied SRC or a tungsten pin, dragging it onto the pin, or pressing K nearby.'}
              {socketGates.length > 0 && ' Drive next to A/B and press K, drag a bit onto a port, or select it and click the port.'}
            </p>
            <div className={`cargo-row ${drag ? 'dragging' : ''}`}>
              {game.cargo.length === 0 && <span className="empty-state">Move over a bit to collect it.</span>}
              {displayedCargo.map((item, index) => (
                <button
                  key={flashedIds.includes(item.id) ? `${item.id}-${game.gateEvent.seq}` : item.id}
                  ref={(element) => { if (element) itemRefs.current.set(item.id, element); else itemRefs.current.delete(item.id); }}
                  className={`cargo-bit ${selectedId === item.id ? 'selected' : ''} ${drag?.id === item.id ? 'drag-placeholder' : ''} ${flashedIds.includes(item.id) ? 'gate-flash' : ''}`}
                  onClick={() => cargoClick(item.id)}
                  onPointerDown={(event) => cargoPointerDown(event, item.id)}
                  onPointerMove={cargoPointerMove}
                  onPointerUp={cargoPointerUp}
                  onPointerCancel={cargoPointerCancel}
                  aria-label={`Cargo position ${index + 1}: bit ${item.value}${selectedId === item.id ? ', selected' : ''}`}
                >
                  <small className="cargo-index">{index + 1}</small>
                  <Bit value={item.value} />
                </button>
              ))}
            </div>
            {draggedBit && (
              <div className="cargo-ghost" style={{ left: drag.x, top: drag.y }} aria-hidden="true">
                <Bit value={draggedBit.value} />
              </div>
            )}
          </section>

          {level.circuit && (
            <section className="tool-section circuit-section">
              <div className="section-heading"><span>02</span><h3>Copper circuit</h3></div>
              <p className="microcopy">{terrainProcesses.includes('tungsten') ? 'Copper joins supplied pads automatically. To create a missing pin, pattern one copper tile and Deposit Tungsten. Silver pins send selected cargo or hold arriving bits for pickup.' : 'Paint → Etch → Fill Copper. The supplied SRC, IN, OUT and DEST pads work automatically when copper reaches them; no tungsten is required.'} Copper joins by shared edges.</p>
              {connections.length === 0 && <p className="microcopy">No wire pins yet. Pattern copper beneath a ? marker, then Deposit Tungsten.</p>}
              {connections.map((port) => (
                <div className={`circuit-connection ${port.ready ? 'connected' : ''}`} key={port.id}>
                  <strong>{port.label}</strong><p className="microcopy">{port.reason}</p>
                  {['source', 'pin'].includes(port.kind) && (
                    <button disabled={!selectedId || !port.canSend || game.status !== 'playing'} onClick={() => deposit(selectedId, { kind: 'source', sourceId: port.id })}>
                      Send selected bit from {port.label}
                    </button>
                  )}
                </div>
              ))}
              <p className="microcopy">{game.circuit.packets.length} signal{game.circuit.packets.length === 1 ? '' : 's'} in transit. Edits pause until they arrive.</p>
            </section>
          )}

          {level.gates.map((gate) => {
            const currentGate = game.gateState[gate.id];
            if (isPassThroughGate(gate)) {
              const active = game.gateEvent?.gateId === gate.id;
              return (
                <section className="tool-section gate-section" key={gate.id}>
                  <div className="section-heading">
                    <span>02</span>
                    <h3>{gate.type} gate</h3>
                  </div>
                  <div
                    key={game.gateEvent?.seq || 0}
                    className={`gate-passthrough ${active ? 'gate-flash' : ''}`}
                  >
                    <span className="gate-passthrough-tag">Pass through</span>
                    <strong>0 ↔ 1</strong>
                  </div>
                  <p className="microcopy">Walking through this gate flips every carried bit. No placement needed.</p>
                  <p className="gate-reason">
                    {currentGate.inside
                      ? `Inside ${gate.type}. Already applied — exit and return to flip again.`
                      : `Cross ${gate.type} to invert the cargo.`}
                  </p>
                </section>
              );
            }
            const pendingOutput = currentGate.pendingOutput;
            return (
              <section className="tool-section gate-section" key={gate.id}>
                <div className="section-heading">
                  <span>02</span>
                  <h3>{gate.type} gate</h3>
                </div>
                <div className="gate-status-row" aria-label={`${gate.type} gate port status`}>
                  {gate.inputs.map((input) => {
                    const loaded = currentGate.inputs[input.id];
                    return (
                      <span key={input.id} className={`gate-status-chip ${loaded ? 'loaded' : ''}`}>
                        {input.label}: {loaded ? loaded.value : 'empty'}
                      </span>
                    );
                  })}
                  <span className={`gate-status-chip ${pendingOutput ? 'output-ready' : ''}`}>
                    OUT: {pendingOutput ? `bit ${pendingOutput.value} ready` : 'empty'}
                  </span>
                </div>
                {gate.wired ? <p className="microcopy">Copper carries a bit into IN. {gate.type} consumes the input and sends its result through the wire at OUT. Walking through this gate leaves cargo unchanged. Walk over OUT to collect a waiting output bit, then carry it to DEST and press Enter.</p> : <><p className="microcopy">
                  Use the physical A/B ports on the wafer. The easiest method is to drive next to an empty port and press K.
                  Drag/drop and select + click also work. Click a loaded input to take it back before the second input is loaded.
                </p>
                <p className="gate-reason">
                  When both inputs are loaded, they are consumed and one new output bit appears at OUT. Walk over OUT to collect it.
                </p></>}
              </section>
            );
          })}

          {game.terrain && (
            <section className="tool-section fabrication-section">
              <div className="section-heading"><span>02</span><h3>Fabrication</h3></div>

              {allowLithography && (
                <>
                  <p className="microcopy"><b>1 · Lithography:</b> drag on the wafer to build one active mask. Add as many brush strokes as you need before running a process.</p>
                  <div className="mask-status">
                    <span>Active mask</span>
                    <strong>{maskedTiles} tiles</strong>
                  </div>
                </>
              )}

              {(terrainProcesses.includes('etch') || terrainProcesses.includes('deposit')) && (
                <p className="microcopy process-label"><b>{allowLithography ? '2 · ' : ''}Process the mask</b></p>
              )}
              {terrainProcesses.includes('etch') && (
                <button onClick={() => runTerrainProcess('etch')} disabled={!maskedTiles || Boolean(game.circuit.packets.length)}>
                  <span>Etch patterned tiles</span><small>{FAB_TOOLS.etch.base} + {FAB_TOOLS.etch.cell}/tile</small>
                </button>
              )}
              {terrainProcesses.includes('deposit') && (
                <button onClick={() => runTerrainProcess('deposit')} disabled={!maskedTiles || Boolean(game.circuit.packets.length)}>
                  <span>Deposit on patterned tiles</span><small>{FAB_TOOLS.deposit.base} + {FAB_TOOLS.deposit.cell}/tile</small>
                </button>
              )}
              {(terrainProcesses.includes('etch') || terrainProcesses.includes('deposit')) && (
                <p className="microcopy">Etch or Deposit applies to the whole yellow mask at once, then clears that mask.</p>
              )}

              {terrainProcesses.includes('copper') && (
                <>
                  <button onClick={() => runTerrainProcess('copper')} disabled={!game.terrain.flat().some((cell) => cell.height === 0) || Boolean(game.circuit.packets.length)}>
                    <span>Fill Copper in trenches</span><small>{FAB_TOOLS.copper.base} + {FAB_TOOLS.copper.cell}/tile</small>
                  </button>
                  <p className="microcopy">Fills all etched trenches at height 0. In this introductory process, copper finishes flush at height 1; separate contact etching and CMP come later.</p>
                </>
              )}

              {terrainProcesses.includes('tungsten') && (
                <>
                  <button onClick={() => runTerrainProcess('tungsten')} disabled={!maskedTiles || Boolean(game.circuit.packets.length)}>
                    <span>Deposit Tungsten pins</span><small>{FAB_TOOLS.tungsten.base} + {FAB_TOOLS.tungsten.cell}/new pin</small>
                  </button>
                  <p className="microcopy">Pattern copper tiles at height 1. Each patterned tile becomes a silver contact pin; the wire stays walkable. Supplied pads already work and need no tungsten.</p>
                </>
              )}

              {terrainProcesses.includes('cmp') && (
                <>
                  <label className="cmp-target">
                    <span>CMP target height</span>
                    <select value={cmpHeight} onChange={(event) => setCmpHeight(Number(event.target.value))}>
                      <option value={0}>0</option>
                      <option value={1}>1</option>
                      <option value={2}>2</option>
                    </select>
                  </label>
                  <button onClick={() => runTerrainProcess('cmp')}>
                    <span>Run CMP globally</span><small>{FAB_TOOLS.cmp.base} + {FAB_TOOLS.cmp.cell}/changed tile</small>
                  </button>
                </>
              )}

              <button
                className="undo-fab"
                onClick={() => setGame((current) => undoTerrainEdit(current))}
                disabled={!game.terrainHistory.length || Boolean(game.circuit.packets.length)}
              >
                <span>Undo last action</span><small>Ctrl+Z</small>
              </button>
              <p className="microcopy">Height 1 is walkable. Height 0 is a trench; height 2+ is a wall.</p>
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

          <section className="tool-section delivery-section">
            <div className="section-heading">
              <span>{level.gates.length || level.fabrication ? '03' : '02'}</span>
              <h3>DEST delivery</h3>
            </div>
            <div className="slot-row" aria-label="Target slots">
              {game.targetSlots.map((slot, index) => (
                <span key={index} className={`target-slot ${slot.delivered ? 'delivered' : ''}`}>
                  {slot.delivered && <i aria-hidden="true">✓</i>}{slot.value}
                </span>
              ))}
            </div>
            <p className={`microcopy ${game.atDestination ? 'at-dest' : ''}`}>
              {level.circuit && 'Wired signals are checked automatically; rejected bits return to cargo. '}{game.atDestination
                ? 'Carrier at DEST. Press Enter to submit cargo.'
                : 'Drive to DEST, then press Enter.'}
              {' '}Cargo fills open slots left → right; mismatching bits stay in cargo.
            </p>
          </section>
        </aside>
      </div>
    </main>
  );
}

export default App;
