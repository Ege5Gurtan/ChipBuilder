# SemiConGame — project instructions

## Repository and current state

- Repository: `Ege5Gurtan/ChipBuilder`.
- The web app lives in `chipbuilder_app/`. It uses React, JavaScript, Create React App, and Three.js. `levels.js` defines four missions; `gameRules.js` owns gameplay state and `terrain.js` defines the first mission's tile materials and process costs. `ThreeScene.js` renders a tilted 3D wafer and handles mouse painting and WASD movement; `App.js` renders the HUD and tool controls.
- Read the current repository before changing code. Keep this file aligned with the implementation as the project evolves; distinguish intended features from features that actually exist.

## Game vision

Build an interactive semiconductor game in which the player controls a small electron/carrier on a chip or wafer and uses fabrication actions to change the environment. The central objective of each level is to deliver the **correct signal** to a destination while keeping fabrication and operating cost low. Merely reaching the destination does not complete a level if the signal is wrong.

Teach semiconductor and digital-logic ideas through playable cause and effect. Prefer a legible, simplified model over a physically exact simulation. Where game rules simplify real device physics, make the simplification consistent and avoid presenting it as a literal semiconductor process.

## Core interaction rules

- There is **no switch between fabrication mode and carrier mode**. WASD controls the carrier continuously during gameplay. Mouse and on-screen fabrication controls operate alongside movement.
- Clicking a fabrication action such as lithography or etching should perform that action in the appropriate context (or let the player target the wafer as needed); it must not require entering a separate mode. Give immediate visual and cost feedback.
- The carrier picks up encountered bits into a visible, ordered cargo inventory (`cargo: [{ id, value }]`, stable IDs). Cargo can be drag-reordered in the right panel (pointer events); the order determines submission order. Clicking a bit selects it; dragging a bit onto a gate socket (or select + click socket) feeds that gate.
- **Enter** attempts signal delivery only while the carrier is within `DESTINATION_RADIUS` of DEST. `attemptSignalDelivery()` pairs cargo[i] with the i-th undelivered target slot (`targetSlots: [{ value, delivered }]`), computing all matches before mutating. Matching bits are deposited and removed from cargo; mismatching bits stay in cargo. Partial delivery persists. Reaching DEST alone never completes a level.
- Target Signal shows each slot's delivered state individually (green = delivered); Current Signal shows delivered slots and `_` for open ones. DEST pulses green/red on delivery feedback.
- **K** drops the selected cargo bit (fallback: rightmost) onto the wafer next to the carrier as a normal `worldBits` entry. A dropped bit is unarmed until the carrier leaves pickup range, then it can be collected again.
- Enter/K are ignored in editable fields and on keyboard-focused (Tab-navigated) controls.
- Introduce logic gradually: later gates can flip or otherwise transform carried bits; gates with multiple inputs require the player to place the appropriate bits at their distinct inputs. Eventually let players construct gates through simplified fabrication steps rather than only using premade gates.
- Make signal state, cargo, gate inputs and outputs, destination requirement, and costs understandable on screen. Explain failed signal checks so a player can learn and retry.

## Levels and scoring

- Current level 01 has a full wafer grid with oxide and trench barriers. Lithography, etch, copper deposition and CMP are selected in the sidebar and painted on the wafer with the mouse. Each valid stroke and affected tile contributes to manufacturing cost. The other three levels retain their existing gate and fixed-channel rules. All levels deliver signals via Enter at DEST.

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
