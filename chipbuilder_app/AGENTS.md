# SemiConGame — project instructions

## Repository and current state

- Repository: `Ege5Gurtan/ChipBuilder`.
- The web app lives in `chipbuilder_app/`. It uses React, JavaScript, Create React App, and Three.js. `levels.js` defines eight data-driven missions; `gameRules.js` owns gameplay state and terrain edit history, while `terrain.js` builds per-level discrete-height terrain from region data and defines process costs. `ThreeScene.js` renders a tilted 3D wafer and handles lithography painting and WASD movement; `App.js` renders the HUD and level-specific fabrication controls.
- Read the current repository before changing code. Keep this file aligned with the implementation as the project evolves; distinguish intended features from features that actually exist.

## Game vision

Build an interactive semiconductor game in which the player controls a small electron/carrier on a chip or wafer and uses fabrication actions to change the environment. The central objective of each level is to deliver the **correct signal** to a destination while keeping fabrication and operating cost low. Merely reaching the destination does not complete a level if the signal is wrong.

Teach semiconductor and digital-logic ideas through playable cause and effect. Prefer a legible, simplified model over a physically exact simulation. Where game rules simplify real device physics, make the simplification consistent and avoid presenting it as a literal semiconductor process.

## Core interaction rules

- There is **no switch between fabrication mode and carrier mode**. WASD controls the carrier continuously during gameplay. Mouse and on-screen fabrication controls operate alongside movement.
- Clicking a fabrication action such as lithography or etching should perform that action in the appropriate context (or let the player target the wafer as needed); it must not require entering a separate mode. Give immediate visual and cost feedback.
- The carrier picks up encountered bits into a visible, ordered cargo inventory (`cargo: [{ id, value }]`, stable IDs). Cargo can be drag-reordered in the right panel (pointer events); the order determines submission order. Multi-input gate sockets are physical ports on the 3D wafer: drag a cargo bit onto a port or select it and click the port. A partially loaded input can be clicked to return that token to cargo.
- When every input of a multi-input gate is loaded, the input tokens are consumed and the gate creates one dedicated pending output token at its physical OUT port. The OUT token is rendered directly from gate state and is collected by moving the carrier into pickup range; OUT holds at most one pending token, so the gate cannot be reloaded until it is collected and finite inputs cannot generate infinite outputs.
- Unary/pass-through gates such as NOT automatically transform the carrier's cargo when the carrier crosses them. They do not require drag-and-drop input. Explicit input placement is reserved for mechanics that genuinely require separate inputs, such as later multi-input gates. `applyGateToCargo(gateType, cargo)` owns the transformation; `movePlayer` detects entry into the gate footprint (`gateFootprint(gate)`) and fires once per crossing, re-arming only after the carrier leaves. Three.js only renders the gate and its activation pulse.
- **Enter** attempts signal delivery only while the carrier is within `DESTINATION_RADIUS` of DEST. `attemptSignalDelivery()` pairs cargo[i] with the i-th undelivered target slot (`targetSlots: [{ value, delivered }]`), computing all matches before mutating. Matching bits are deposited and removed from cargo; mismatching bits stay in cargo. Partial delivery persists. Reaching DEST alone never completes a level.
- Target Signal shows each slot's delivered state individually (green = delivered); Current Signal shows delivered slots and `_` for open ones. DEST pulses green/red on delivery feedback.
- **K** is context-sensitive for cargo: when the carrier is within the generous interaction radius of an empty physical multi-input gate port, K loads the selected cargo bit (fallback: rightmost) into the nearest empty port. Otherwise K drops it onto the wafer as a normal `worldBits` entry. Gate ports use larger visible rings plus oversized invisible pointer hit targets so both proximity play and mouse drag/drop are forgiving. A normal wafer-dropped bit is unarmed until the carrier leaves pickup range, then it can be collected again.
- Enter/K are ignored in editable fields and on keyboard-focused (Tab-navigated) controls.
- Introduce logic gradually: pass-through gates transform carried bits on crossing; gates with multiple inputs require the player to place the appropriate bits at their distinct inputs. Eventually let players construct gates through simplified fabrication steps rather than only using premade gates.
- Make signal state, cargo, gate inputs and outputs, destination requirement, and costs understandable on screen. Explain failed signal checks so a player can learn and retry.

## Levels and scoring

- All level buttons are directly selectable during development/playtesting; players do not need to replay earlier levels to reach a later mission.
- Terrain levels are data-driven: each mission may define terrain regions and an `allowedProcesses` list. Mouse dragging only paints lithography when that level allows it; multiple strokes build one active pattern. Etch lowers every patterned tile by one height and Deposit raises every patterned tile by one height, then either process clears the entire mask. CMP is a separate global process that lowers all terrain above its selected target height. Height 1 is walkable, height 0 is a trench, and height 2+ is blocked terrain. Ctrl+Z or the Undo button restores the previous fabrication action, including the mask and its cost. The current eight-level progression teaches narrow etch openings, deposition bridges, multi-region masks, signal correctness, process choice, CMP, and a combined fabrication + NOT-gate puzzle.

- Start with a small playable loop: move the carrier, collect bits, deposit a signal, validate it against a target, and receive clear success or failure feedback.
- Add fabrication actions and circuit elements incrementally as the loop becomes playable. Level goals should be explicit and build on earlier mechanics.
- Track the costs that gameplay actually models (for example process steps, material/resources, chip area, energy, masks, or contamination risk). The player should be able to see how an action changes cost and compare solutions. Do not claim an unimplemented cost dimension is already scored.
- A level succeeds only when its signal requirement is met; optimize cost as an additional goal or score. Keep evaluation deterministic and separate from rendering.

## Later-phase features

- Introduce **Joe**, a cleanroom operator whom carriers can communicate with to request large-scale wafer, terrain, or fabrication operations.
- Joe's handling has consequences: taking or leaving the wafer outside the cleanroom, or exposing it improperly, can accumulate dust. Dust should create meaningful defects or obstacles that interfere with carrier movement or level objectives.
- Support multiplayer later: multiple players may control carriers, and another player may optionally control Joe. Design future state changes so actor and action ownership can be represented without requiring multiplayer infrastructure in the first playable version.

## Implementation guidance

- Replace the rotating-cube demo as needed. Keep the existing React/Three.js stack for the initial implementation unless there is a concrete reason to change it.
- Separate level definitions, gameplay rules/state transitions, input handling, Three.js rendering, and UI as the game grows. A rendered mesh must not be the sole source of truth for signal values, inventory, cost, or win conditions.
- Keep Three.js animation frames, event listeners, resize handlers, and GPU resources cleaned up when components unmount. Movement and interactions should behave predictably across frame rates.
- Make keyboard controls coexist with mouse interactions; do not let UI clicks accidentally trigger game actions, and do not capture movement keys while the player types into an input.
- Prefer small changes that yield a complete playable slice. Do not build Joe, multiplayer, or a detailed fabrication simulator before the core single-player signal loop works.
- For each implementation change, run the relevant build and directly check the affected gameplay interaction when possible. Do not add superficial tests that only repeat implementation details.
- Update this `AGENTS.md` when core controls, game rules, data structures, or major architecture decisions change. Keep it concise and factual, not a changelog.
