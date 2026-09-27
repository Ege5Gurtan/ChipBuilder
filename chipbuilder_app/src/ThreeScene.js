import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

const MOVE_SPEED = 3.15;

function makeLabel(text, color = '#f4f0df', size = 54) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = color;
  context.font = `700 ${size}px Bahnschrift, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, 128, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.45, 0.72, 1);
  return sprite;
}

function addTrace(scene, points, color = 0xb7673c) {
  const curve = new THREE.CatmullRomCurve3(
    points.map(([x, y]) => new THREE.Vector3(x, y, 0.035))
  );
  const geometry = new THREE.TubeGeometry(curve, 24, 0.035, 6, false);
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55 });
  scene.add(new THREE.Mesh(geometry, material));
}

function inputOwnsKeyboard(target) {
  const tag = target?.tagName?.toLowerCase();
  return target?.isContentEditable || ['input', 'textarea', 'select'].includes(tag);
}

const ThreeScene = ({ level, game, onMove }) => {
  const mountRef = useRef(null);
  const onMoveRef = useRef(onMove);
  const visualRefs = useRef(null);

  useEffect(() => {
    onMoveRef.current = onMove;
  }, [onMove]);

  useEffect(() => {
    const mount = mountRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x101416);
    const camera = new THREE.OrthographicCamera(-6.8, 6.8, 5, -5, 0.1, 40);
    camera.position.set(0, 0, 12);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    const wafer = new THREE.Mesh(
      new THREE.CircleGeometry(6, 96),
      new THREE.MeshStandardMaterial({ color: 0x263032, roughness: 0.72, metalness: 0.3 })
    );
    wafer.scale.y = 0.75;
    scene.add(wafer);

    const waferEdge = new THREE.Mesh(
      new THREE.RingGeometry(5.86, 6.02, 96),
      new THREE.MeshBasicMaterial({ color: 0x7b8e8c, transparent: true, opacity: 0.55 })
    );
    waferEdge.scale.y = 0.75;
    waferEdge.position.z = 0.018;
    scene.add(waferEdge);

    const grid = new THREE.GridHelper(11, 18, 0x57706d, 0x394744);
    grid.rotation.x = Math.PI / 2;
    grid.scale.y = 0.75;
    grid.position.z = 0.025;
    grid.material.transparent = true;
    grid.material.opacity = 0.22;
    scene.add(grid);

    addTrace(scene, [[-5.2, -3.5], [-2.8, -1.7], [0, -1.5], [2.4, 1.8], [5.1, 3.5]]);
    addTrace(scene, [[-4.8, 2.8], [-2.2, 1.8], [0.4, 2.4], [4.6, 1.1]], 0x4b9496);
    addTrace(scene, [[-4.3, -0.1], [-2.3, 0.8], [0.4, 0.5], [3.8, -2.1]], 0xd2a649);

    scene.add(new THREE.AmbientLight(0xdde7e1, 1.8));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
    keyLight.position.set(-3, 5, 9);
    scene.add(keyLight);

    const player = new THREE.Group();
    const playerCore = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.3, 0.18, 24),
      new THREE.MeshStandardMaterial({ color: 0xe7f6f3, emissive: 0x55d8d1, emissiveIntensity: 1.5 })
    );
    playerCore.rotation.x = Math.PI / 2;
    player.add(playerCore);
    const playerRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.43, 0.065, 8, 28),
      new THREE.MeshBasicMaterial({ color: 0x62ded4 })
    );
    player.add(playerRing);
    const pointer = new THREE.Mesh(
      new THREE.ConeGeometry(0.12, 0.32, 3),
      new THREE.MeshBasicMaterial({ color: 0xffcf67 })
    );
    pointer.position.set(0, 0.46, 0.02);
    player.add(pointer);
    player.position.z = 0.28;
    scene.add(player);

    const destination = new THREE.Group();
    const destinationPad = new THREE.Mesh(
      new THREE.RingGeometry(0.52, 0.78, 32),
      new THREE.MeshBasicMaterial({ color: 0xf0b94f, transparent: true, opacity: 0.9 })
    );
    destination.add(destinationPad);
    const destinationLabel = makeLabel('DEST', '#ffd77d', 42);
    destinationLabel.position.y = 1;
    destination.add(destinationLabel);
    destination.position.set(level.destination.x, level.destination.y, 0.1);
    scene.add(destination);

    const pickupMeshes = new Map();
    level.pickups.forEach((pickup) => {
      const group = new THREE.Group();
      const disc = new THREE.Mesh(
        new THREE.CylinderGeometry(0.34, 0.34, 0.12, 24),
        new THREE.MeshStandardMaterial({
          color: pickup.value ? 0xe6ab45 : 0x438c91,
          emissive: pickup.value ? 0x6e3e0f : 0x163d40,
          emissiveIntensity: 0.75,
        })
      );
      disc.rotation.x = Math.PI / 2;
      group.add(disc);
      const label = makeLabel(String(pickup.value), '#ffffff', 72);
      label.scale.set(0.72, 0.36, 1);
      label.position.z = 0.13;
      group.add(label);
      group.position.set(pickup.x, pickup.y, 0.16);
      scene.add(group);
      pickupMeshes.set(pickup.id, group);
    });

    const obstacleMeshes = new Map();
    level.obstacles.forEach((obstacle) => {
      const material = new THREE.MeshStandardMaterial({
        color: obstacle.fabricationTarget ? 0xc75d43 : 0x596362,
        emissive: obstacle.fabricationTarget ? 0x4a160d : 0x000000,
        emissiveIntensity: 0.7,
        roughness: 0.55,
      });
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(obstacle.width, obstacle.height, 0.28),
        material
      );
      mesh.position.set(obstacle.x, obstacle.y, 0.16);
      scene.add(mesh);
      obstacleMeshes.set(obstacle.id, mesh);
    });

    level.gates.forEach((gate) => {
      const group = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(gate.type === 'AND' ? 2.15 : 1.75, 1.35, 0.22),
        new THREE.MeshStandardMaterial({ color: 0x3d5556, emissive: 0x152728, emissiveIntensity: 0.5 })
      );
      group.add(body);
      const label = makeLabel(gate.type, '#f2d078', 48);
      label.position.z = 0.18;
      group.add(label);
      group.position.set(gate.x, gate.y, 0.18);
      scene.add(group);
    });

    visualRefs.current = { player, playerRing, destinationPad, pickupMeshes, obstacleMeshes };

    const keys = new Set();
    const movementKeys = new Set(['w', 'a', 's', 'd']);
    const keyDown = (event) => {
      if (inputOwnsKeyboard(event.target)) return;
      const key = event.key.toLowerCase();
      if (movementKeys.has(key)) {
        event.preventDefault();
        keys.add(key);
      }
    };
    const keyUp = (event) => keys.delete(event.key.toLowerCase());
    const clearKeys = () => keys.clear();
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', clearKeys);

    const resize = () => {
      const width = Math.max(1, mount.clientWidth);
      const height = Math.max(1, mount.clientHeight);
      const aspect = width / height;
      const viewHeight = aspect < 1.25 ? 13.6 / aspect : 10;
      const viewWidth = viewHeight * aspect;
      camera.left = -viewWidth / 2;
      camera.right = viewWidth / 2;
      camera.top = viewHeight / 2;
      camera.bottom = -viewHeight / 2;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    resize();

    const clock = new THREE.Clock();
    let animationFrame;
    const animate = () => {
      animationFrame = requestAnimationFrame(animate);
      const delta = Math.min(clock.getDelta(), 0.05);
      let horizontal = Number(keys.has('d')) - Number(keys.has('a'));
      let vertical = Number(keys.has('w')) - Number(keys.has('s'));
      if (horizontal || vertical) {
        const length = Math.hypot(horizontal, vertical);
        horizontal /= length;
        vertical /= length;
        onMoveRef.current({
          x: horizontal * MOVE_SPEED * delta,
          y: vertical * MOVE_SPEED * delta,
        });
      }
      const time = clock.elapsedTime;
      playerRing.scale.setScalar(1 + Math.sin(time * 4) * 0.08);
      destinationPad.material.opacity = 0.68 + Math.sin(time * 3) * 0.25;
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', clearKeys);
      visualRefs.current = null;
      scene.traverse((object) => {
        object.geometry?.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.filter(Boolean).forEach((material) => {
          material.map?.dispose();
          material.dispose();
        });
      });
      renderer.dispose();
      renderer.forceContextLoss();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [level]);

  useEffect(() => {
    const refs = visualRefs.current;
    if (!refs) return;
    refs.player.position.x = game.player.x;
    refs.player.position.y = game.player.y;
    refs.pickupMeshes.forEach((mesh, id) => {
      mesh.visible = !game.collectedIds.includes(id);
    });
    refs.obstacleMeshes.forEach((mesh, id) => {
      const obstacle = level.obstacles.find((item) => item.id === id);
      mesh.visible = obstacle?.permanent || !game.fabrication.etched;
      if (obstacle?.fabricationTarget && game.fabrication.patterned) {
        mesh.material.color.setHex(0xe3bd4e);
        mesh.material.emissive.setHex(0x775710);
      }
    });
  }, [game, level]);

  return (
    <div className="wafer-stage" ref={mountRef} aria-label="Top-down semiconductor wafer play field">
      <div className="wafer-legend" aria-hidden="true">
        <span><i className="legend-carrier" /> Carrier</span>
        <span><i className="legend-destination" /> Destination</span>
      </div>
    </div>
  );
};

export default ThreeScene;
