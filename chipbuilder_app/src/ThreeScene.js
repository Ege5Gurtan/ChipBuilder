import React, { useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { TERRAIN_COLUMNS, TERRAIN_ROWS, TILE_WIDTH, TILE_DEPTH } from './terrain.js';
import { GATE_INPUT_INTERACTION_RADIUS, gateFootprint, gateInputPosition, gateOutputPosition } from './gameRules.js';

const MOVE_SPEED = 3.15;
const DEST_COLOR = new THREE.Color(0xffd16c);
const GATE_PULSE_COLOR = new THREE.Color(0xffd16c);
const PULSE_COLORS = { accept: new THREE.Color(0x6ee37a), partial: new THREE.Color(0x6ee37a), reject: new THREE.Color(0xf07162) };
const PULSE_SECONDS = 0.6;
const tileColors = { silicon: 0x318b9d, oxide: 0xb7a1d9, trench: 0x203143, rough: 0xad6635, metal: 0xe5ae50 };

function label(text, color = '#ffffff') {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 38px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = color; ctx.fillText(text, 64, 32);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true }));
  sprite.scale.set(0.8, 0.4, 1);
  return sprite;
}

function orb(color, radius = 0.22) {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 12), new THREE.MeshBasicMaterial({ color })));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.5, 0.028, 6, 28), new THREE.MeshBasicMaterial({ color }));
  ring.rotation.x = Math.PI / 2; group.add(ring);
  return group;
}

export function editable(target) {
  const tag = target?.tagName?.toLowerCase();
  return target?.isContentEditable || ['input', 'textarea', 'select'].includes(tag);
}

const ThreeScene = React.forwardRef(function ThreeScene({ level, game, onMove, onPaint, onGateSocketClick, hoveredSocket, tool }, ref) {
  const mountRef = useRef(null);
  const moveRef = useRef(onMove);
  const paintRef = useRef(onPaint);
  const gateSocketClickRef = useRef(onGateSocketClick);
  const toolRef = useRef(tool);
  const gameRef = useRef(game);
  const visuals = useRef(null);
  useEffect(() => {
    moveRef.current = onMove;
    paintRef.current = onPaint;
    gateSocketClickRef.current = onGateSocketClick;
    toolRef.current = tool;
    gameRef.current = game;
  });

  useImperativeHandle(ref, () => ({
    gateSocketAtClientPoint(clientX, clientY) {
      const refs = visuals.current;
      if (!refs?.gateHitTargets?.length) return null;
      const bounds = refs.renderer.domElement.getBoundingClientRect();
      if (clientX < bounds.left || clientX > bounds.right || clientY < bounds.top || clientY > bounds.bottom) return null;
      const pointer = new THREE.Vector2(
        (clientX - bounds.left) / bounds.width * 2 - 1,
        -(clientY - bounds.top) / bounds.height * 2 + 1
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(pointer, refs.camera);
      const hit = raycaster.intersectObjects(refs.gateHitTargets, true)[0];
      let object = hit?.object;
      while (object && !object.userData.socket) object = object.parent;
      const socket = object?.userData.socket || null;
      if (!socket) return null;
      const [gateId, inputId] = socket.split(':');
      if (gameRef.current.gateState[gateId]?.inputs?.[inputId] !== undefined) return null;
      if (gameRef.current.gateState[gateId]?.pendingOutput) return null;
      return socket;
    },
  }), []);

  useEffect(() => {
    const mount = mountRef.current;
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x081422);
    const camera = new THREE.OrthographicCamera(-10, 10, 7, -7, 0.1, 100);
    camera.position.set(10, 18, 18); camera.lookAt(0, 0, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.prepend(renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xbdeaff, 0x183345, 2.3));
    const sun = new THREE.DirectionalLight(0xffffff, 2.1); sun.position.set(-5, 13, 7); scene.add(sun);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(13, 0.35, 10), new THREE.MeshStandardMaterial({ color: 0x102b3d }));
    floor.position.y = -0.35; scene.add(floor);

    const tileMeshes = [];
    const tiles = [];
    const tileGeometry = new THREE.BoxGeometry(TILE_WIDTH * 0.97, 1, TILE_DEPTH * 0.97);
    const materials = Object.fromEntries(Object.entries(tileColors).map(([name, color]) => [name, new THREE.MeshStandardMaterial({ color, roughness: name === 'metal' ? 0.3 : 0.68, metalness: name === 'metal' ? 0.6 : 0.12 })]));
    const maskMaterial = new THREE.MeshBasicMaterial({ color: 0xffd56a, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
    for (let row = 0; row < TERRAIN_ROWS; row++) for (let col = 0; col < TERRAIN_COLUMNS; col++) {
      const mesh = new THREE.Mesh(tileGeometry, materials.silicon);
      mesh.position.set(-6 + (col + 0.5) * TILE_WIDTH, 0, 4.5 - (row + 0.5) * TILE_DEPTH);
      mesh.userData = { col, row }; scene.add(mesh); tileMeshes.push(mesh);
      const mask = new THREE.Mesh(new THREE.PlaneGeometry(TILE_WIDTH * 0.7, TILE_DEPTH * 0.7), maskMaterial);
      mask.rotation.x = -Math.PI / 2; mask.position.y = 0.52; mesh.add(mask);
      tiles.push({ mesh, mask });
    }
    const source = orb(0x5ae9ff, 0.28);
    source.position.set(level.start.x, 0.9, -level.start.y); scene.add(source);
    const destination = orb(0xffd16c, 0.36);
    destination.position.set(level.destination.x, 0.9, -level.destination.y); scene.add(destination);
    const destLabel = label('DEST', '#ffd77d'); destLabel.position.y = 0.75; destination.add(destLabel);
    const player = orb(0x88eeff, 0.25); scene.add(player);
    const destinationMaterials = destination.children.filter((child) => child.isMesh).map((child) => child.material);
    const pulse = { color: null, start: 0 };
    const bits = new Map();
    const bitMesh = (bit) => {
      if (bits.has(bit.id)) return bits.get(bit.id);
      const mesh = orb(bit.value ? 0xffc87a : 0x72e2d4, 0.22);
      const text = label(String(bit.value)); text.position.y = 0.53; mesh.add(text);
      scene.add(mesh); bits.set(bit.id, mesh);
      return mesh;
    };
    const obstacles = new Map();
    level.obstacles.forEach((obstacle) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(obstacle.width, 0.8, obstacle.height), new THREE.MeshStandardMaterial({ color: obstacle.fabricationTarget ? 0xc75d43 : 0x596362 }));
      mesh.position.set(obstacle.x, 0.53, -obstacle.y); scene.add(mesh); obstacles.set(obstacle.id, mesh);
    });
    const gateMeshes = new Map();
    const gatePorts = new Map();
    const outputPorts = new Map();
    const gateHitTargets = [];
    level.gates.forEach((gate) => {
      const { width, height } = gateFootprint(gate);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, 0.55, height), new THREE.MeshStandardMaterial({ color: 0x3d5556 }));
      mesh.position.set(gate.x, 0.5, -gate.y); scene.add(mesh);
      gateMeshes.set(gate.id, mesh);
      const text = label(gate.type, '#f2d078'); text.position.set(gate.x, 1.12, -gate.y); scene.add(text);

      gate.inputs?.forEach((input) => {
        const key = `${gate.id}:${input.id}`;
        const position = gateInputPosition(gate, input.id);
        const group = new THREE.Group();
        group.position.set(position.x, 0.72, -position.y);
        group.userData.socket = key;

        const ringMaterial = new THREE.MeshStandardMaterial({ color: 0x6b7d7c, emissive: 0x000000, metalness: 0.35, roughness: 0.45 });
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.37, 0.075, 8, 32), ringMaterial);
        ring.rotation.x = Math.PI / 2; ring.userData.socket = key; group.add(ring);

        const pad = new THREE.Mesh(
          new THREE.CylinderGeometry(0.27, 0.27, 0.09, 24),
          new THREE.MeshStandardMaterial({ color: 0x182829, metalness: 0.2, roughness: 0.6 })
        );
        pad.userData.socket = key; group.add(pad);

        const hitTarget = new THREE.Mesh(
          new THREE.CylinderGeometry(0.49, 0.49, 0.08, 20),
          new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
        );
        hitTarget.userData.socket = key; group.add(hitTarget);

        const inputLabel = label(input.label, '#d7dfdc'); inputLabel.position.y = 0.62; group.add(inputLabel);
        const loadedZero = orb(0x72e2d4, 0.2); loadedZero.position.y = 0.13; loadedZero.visible = false; group.add(loadedZero);
        const zeroLabel = label('0'); zeroLabel.position.y = 0.48; loadedZero.add(zeroLabel);
        const loadedOne = orb(0xffc87a, 0.2); loadedOne.position.y = 0.13; loadedOne.visible = false; group.add(loadedOne);
        const oneLabel = label('1'); oneLabel.position.y = 0.48; loadedOne.add(oneLabel);

        const trace = new THREE.Mesh(
          new THREE.BoxGeometry(0.44, 0.07, 0.07),
          new THREE.MeshStandardMaterial({ color: 0x849493, metalness: 0.45, roughness: 0.4 })
        );
        trace.position.set(gate.x - width / 2 - 0.2, 0.68, -position.y); scene.add(trace);

        scene.add(group);
        gatePorts.set(key, { group, ring, loadedZero, loadedOne });
        gateHitTargets.push(group);
      });

      if (gate.inputs?.length) {
        const position = gateOutputPosition(gate);
        const group = new THREE.Group();
        group.position.set(position.x, 0.72, -position.y);
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(0.39, 0.075, 8, 32),
          new THREE.MeshStandardMaterial({ color: 0x9a7a39, emissive: 0x000000, metalness: 0.35, roughness: 0.4 })
        );
        ring.rotation.x = Math.PI / 2; group.add(ring);
        const outputLabel = label('OUT', '#ffd77d'); outputLabel.position.y = 0.58; group.add(outputLabel);
        const outputZero = orb(0x72e2d4, 0.27); outputZero.position.y = 0.18; outputZero.visible = false; group.add(outputZero);
        const outputZeroLabel = label('0'); outputZeroLabel.position.y = 0.57; outputZero.add(outputZeroLabel);
        const outputOne = orb(0xffc87a, 0.27); outputOne.position.y = 0.18; outputOne.visible = false; group.add(outputOne);
        const outputOneLabel = label('1'); outputOneLabel.position.y = 0.57; outputOne.add(outputOneLabel);
        const trace = new THREE.Mesh(
          new THREE.BoxGeometry(0.5, 0.07, 0.07),
          new THREE.MeshStandardMaterial({ color: 0xb08b45, metalness: 0.45, roughness: 0.4 })
        );
        trace.position.set(gate.x + width / 2 + 0.23, 0.68, -position.y); scene.add(trace);
        scene.add(group);
        outputPorts.set(gate.id, { group, ring, outputZero, outputOne });
      }
    });
    const gatePulse = { mesh: null, start: 0 };
    visuals.current = {
      renderer, camera, player, bits, bitMesh, obstacles, tiles, materials, pulse,
      gateMeshes, gatePorts, outputPorts, gateHitTargets, gatePulse,
      clock: null, feedbackSeq: 0, gateSeq: 0,
    };

    const keys = new Set();
    const keyDown = (event) => {
      if (editable(event.target)) return;
      const key = event.key.toLowerCase();
      if ('wasd'.includes(key)) { event.preventDefault(); keys.add(key); }
    };
    const keyUp = (event) => keys.delete(event.key.toLowerCase());
    const clearKeys = () => keys.clear();
    window.addEventListener('keydown', keyDown); window.addEventListener('keyup', keyUp); window.addEventListener('blur', clearKeys);

    const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
    let painting = false, strokeStarted = false;
    const touched = new Set();
    const paint = (event) => {
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(tileMeshes, false)[0];
      if (!hit || !gameRef.current.terrain) return;
      const { col, row } = hit.object.userData;
      const id = `${col}:${row}`;
      if (touched.has(id)) return;
      touched.add(id);
      const cell = gameRef.current.terrain[row]?.[col];
      const action = toolRef.current;
      const valid = action === 'lithography' ? cell?.type === 'oxide' && !cell.masked
        : action === 'etch' ? cell?.type === 'oxide' && cell.masked
        : action === 'deposit' ? cell?.type === 'trench'
        : cell?.type === 'rough';
      paintRef.current(col, row, !strokeStarted);
      if (valid) strokeStarted = true;
    };
    const down = (event) => {
      if (!gameRef.current.terrain || event.button !== 0) return;
      painting = true; strokeStarted = false; touched.clear();
      renderer.domElement.setPointerCapture(event.pointerId); paint(event);
    };
    const move = (event) => { if (painting) paint(event); };
    const up = () => { painting = false; touched.clear(); };
    const gateClick = (event) => {
      if (event.button !== 0 || !gateHitTargets.length) return;
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(gateHitTargets, true)[0];
      let object = hit?.object;
      while (object && !object.userData.socket) object = object.parent;
      const socket = object?.userData.socket;
      if (!socket) return;
      const [gateId, inputId] = socket.split(':');
      gateSocketClickRef.current?.(gateId, inputId);
    };
    renderer.domElement.addEventListener('pointerdown', down);
    renderer.domElement.addEventListener('pointermove', move);
    renderer.domElement.addEventListener('pointerup', up);
    renderer.domElement.addEventListener('pointercancel', up);
    renderer.domElement.addEventListener('click', gateClick);

    const resize = () => {
      const width = Math.max(1, mount.clientWidth), height = Math.max(1, mount.clientHeight);
      const aspect = width / height, span = 6.2;
      camera.left = -span * aspect; camera.right = span * aspect;
      camera.top = span; camera.bottom = -span; camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const observer = new ResizeObserver(resize); observer.observe(mount); resize();
    const clock = new THREE.Clock(); let animationFrame;
    visuals.current.clock = clock;
    const animate = () => {
      animationFrame = requestAnimationFrame(animate);
      const delta = Math.min(clock.getDelta(), 0.05);
      let x = Number(keys.has('d')) - Number(keys.has('a'));
      let y = Number(keys.has('w')) - Number(keys.has('s'));
      if (x || y) { const length = Math.hypot(x, y); moveRef.current({ x: x / length * MOVE_SPEED * delta, y: y / length * MOVE_SPEED * delta }); }
      player.rotation.y += delta * 0.7;
      destination.rotation.y -= delta * 0.5;
      if (pulse.color) {
        const t = Math.min(1, (clock.elapsedTime - pulse.start) / PULSE_SECONDS);
        destinationMaterials.forEach((material) => material.color.copy(pulse.color).lerp(DEST_COLOR, t));
        destination.scale.setScalar(1 + 0.35 * Math.sin(t * Math.PI));
        if (t >= 1) pulse.color = null;
      }
      if (gatePulse.mesh) {
        const t = Math.min(1, (clock.elapsedTime - gatePulse.start) / PULSE_SECONDS);
        gatePulse.mesh.material.emissive.copy(GATE_PULSE_COLOR).multiplyScalar(0.85 * (1 - t));
        gatePulse.mesh.scale.y = 1 + 0.3 * Math.sin(t * Math.PI);
        if (t >= 1) {
          gatePulse.mesh.material.emissive.setScalar(0);
          gatePulse.mesh.scale.y = 1;
          gatePulse.mesh = null;
        }
      }
      outputPorts.forEach(({ outputZero, outputOne }) => {
        [outputZero, outputOne].forEach((outputBit) => {
          if (!outputBit.visible) return;
          outputBit.rotation.y += delta * 1.8;
          const pulseScale = 1 + 0.08 * Math.sin(clock.elapsedTime * 6);
          outputBit.scale.setScalar(pulseScale);
        });
      });
      renderer.render(scene, camera);
    };
    animate();
    return () => {
      cancelAnimationFrame(animationFrame); observer.disconnect();
      window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp); window.removeEventListener('blur', clearKeys);
      renderer.domElement.removeEventListener('pointerdown', down); renderer.domElement.removeEventListener('pointermove', move);
      renderer.domElement.removeEventListener('pointerup', up); renderer.domElement.removeEventListener('pointercancel', up);
      renderer.domElement.removeEventListener('click', gateClick);
      visuals.current = null;
      const geometries = new Set(), ownedMaterials = new Set();
      scene.traverse((object) => {
        if (object.geometry) geometries.add(object.geometry);
        const list = Array.isArray(object.material) ? object.material : [object.material];
        list.filter(Boolean).forEach((material) => ownedMaterials.add(material));
      });
      geometries.forEach((geometry) => geometry.dispose());
      ownedMaterials.forEach((material) => { material.map?.dispose(); material.dispose(); });
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    };
  }, [level]);

  useEffect(() => {
    const refs = visuals.current;
    if (!refs) return;
    refs.player.position.set(game.player.x, 1.08, -game.player.y);
    const present = new Set();
    game.worldBits.forEach((bit) => {
      const mesh = refs.bitMesh(bit);
      mesh.visible = true; mesh.position.set(bit.x, 1.02, -bit.y);
      mesh.scale.setScalar(bit.armed ? 1 : 0.8);
      present.add(bit.id);
    });
    refs.bits.forEach((mesh, id) => { if (!present.has(id)) mesh.visible = false; });
    refs.gatePorts.forEach((port, socket) => {
      const [gateId, inputId] = socket.split(':');
      const loaded = game.gateState[gateId]?.inputs?.[inputId];
      port.loadedZero.visible = loaded?.value === 0;
      port.loadedOne.visible = loaded?.value === 1;
      const gate = level.gates.find((item) => item.id === gateId);
      const position = gate ? gateInputPosition(gate, inputId) : null;
      const nearCarrier = position
        ? Math.hypot(game.player.x - position.x, game.player.y - position.y) <= GATE_INPUT_INTERACTION_RADIUS
        : false;
      const highlighted = (hoveredSocket === socket || nearCarrier) && !loaded;
      port.ring.material.color.setHex(highlighted ? 0xefbd55 : loaded ? 0x63d9d0 : 0x6b7d7c);
      port.ring.material.emissive.setHex(highlighted ? 0x6b4700 : loaded ? 0x123b38 : 0x000000);
      port.ring.material.emissiveIntensity = highlighted ? 1.35 : 1;
    });
    refs.outputPorts.forEach((port, gateId) => {
      const pending = game.gateState[gateId]?.pendingOutput;
      const ready = Boolean(pending);
      port.outputZero.visible = pending?.value === 0;
      port.outputOne.visible = pending?.value === 1;
      port.ring.material.color.setHex(ready ? 0xffd16c : 0x9a7a39);
      port.ring.material.emissive.setHex(ready ? 0x7a5100 : 0x000000);
      port.ring.material.emissiveIntensity = ready ? 1.3 : 1;
    });
    const seq = game.feedback?.seq || 0;
    if (seq !== refs.feedbackSeq) {
      refs.feedbackSeq = seq;
      if (game.feedback) { refs.pulse.color = PULSE_COLORS[game.feedback.kind]; refs.pulse.start = refs.clock.elapsedTime; }
    }
    const gateSeq = game.gateEvent?.seq || 0;
    if (gateSeq !== refs.gateSeq) {
      refs.gateSeq = gateSeq;
      const mesh = refs.gateMeshes.get(game.gateEvent?.gateId);
      if (mesh) { refs.gatePulse.mesh = mesh; refs.gatePulse.start = refs.clock.elapsedTime; }
    }
    refs.obstacles.forEach((mesh, id) => {
      const obstacle = level.obstacles.find((item) => item.id === id);
      mesh.visible = obstacle?.permanent || !game.fabrication.etched;
      if (obstacle?.fabricationTarget && game.fabrication.patterned) mesh.material.color.setHex(0xe3bd4e);
    });
    refs.tiles.forEach(({ mesh, mask }, index) => {
      const row = Math.floor(index / TERRAIN_COLUMNS), col = index % TERRAIN_COLUMNS;
      const cell = game.terrain?.[row]?.[col] || { type: 'silicon', masked: false };
      mesh.material = refs.materials[cell.type]; mask.visible = cell.masked;
      const heights = { silicon: 0.48, oxide: 1.13, trench: 0.13, rough: 0.81, metal: 0.59 };
      mesh.scale.y = heights[cell.type]; mesh.position.y = heights[cell.type] / 2;
    });
  }, [game, hoveredSocket, level]);

  return <div className="wafer-stage" ref={mountRef} aria-label="Tilted 3D semiconductor wafer play field" />;
});

export default ThreeScene;
