import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function rngFrom(seed) {
  let value = Number(seed) >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) | 0;
    let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function colorFrom(value, fallback = 0x76f7ff) {
  try {
    return new THREE.Color(value || fallback);
  } catch {
    return new THREE.Color(fallback);
  }
}

function physical(color, options = {}) {
  const base = colorFrom(color);
  return new THREE.MeshPhysicalMaterial({
    color: base,
    emissive: options.emissive === false ? 0x000000 : base,
    emissiveIntensity: options.emissiveIntensity ?? 0.16,
    metalness: options.metalness ?? 0.82,
    roughness: options.roughness ?? 0.24,
    clearcoat: options.clearcoat ?? 0.72,
    clearcoatRoughness: 0.2,
    transparent: Boolean(options.transparent),
    opacity: options.opacity ?? 1,
    side: options.side ?? THREE.FrontSide,
  });
}

function emissive(color, intensity = 2.4, opacity = 1) {
  const tint = colorFrom(color);
  return new THREE.MeshBasicMaterial({
    color: tint,
    transparent: opacity < 1,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
}

function wedgeGeometry(width = 1, length = 2, height = 0.45, rearWidth = width * 0.72) {
  const w = width / 2;
  const rw = rearWidth / 2;
  const front = -length / 2;
  const rear = length / 2;
  const vertices = new Float32Array([
    0, height, front,
    -w, 0, front + length * 0.38,
    w, 0, front + length * 0.38,
    -rw, 0, rear,
    rw, 0, rear,
    0, -height * 0.45, front + length * 0.18,
    0, -height * 0.35, rear,
  ]);
  const indices = [
    0, 1, 2, 1, 3, 6, 1, 6, 5, 2, 5, 6, 2, 6, 4,
    3, 4, 6, 0, 5, 1, 0, 2, 5, 0, 4, 3, 0, 3, 1, 0, 2, 4,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function addMesh(parent, geometry, material, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1]) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.scale.set(...scale);
  parent.add(mesh);
  return mesh;
}

function addEngine(parent, x, z, color, size = 1) {
  const casing = addMesh(
    parent,
    new THREE.CylinderGeometry(0.22 * size, 0.3 * size, 0.72 * size, 12),
    physical(0x263957, { emissive: false, roughness: 0.34 }),
    [x, 0, z],
    [Math.PI / 2, 0, 0],
  );
  const glow = addMesh(
    parent,
    new THREE.ConeGeometry(0.23 * size, 1.3 * size, 12, 1, true),
    emissive(color, 3),
    [x, 0, z + 0.9 * size],
    [Math.PI / 2, 0, 0],
  );
  glow.userData.engineGlow = true;
  glow.userData.baseScale = glow.scale.clone();
  casing.castShadow = true;
  return glow;
}

function addWeaponPod(parent, x, z, color, length = 1.1) {
  addMesh(
    parent,
    new THREE.CylinderGeometry(0.12, 0.17, length, 10),
    physical(0x17243f, { emissive: false }),
    [x, 0.12, z],
    [Math.PI / 2, 0, 0],
  );
  addMesh(parent, new THREE.CylinderGeometry(0.065, 0.065, length * 1.08, 8), emissive(color, 1.8), [x, 0.13, z - 0.08], [Math.PI / 2, 0, 0]);
}

export function buildDetailedShip(ship = {}, remote = false) {
  const id = ship.id || "vanguarda";
  const accent = colorFrom(remote ? 0xff5bd7 : ship.color || 0x76f7ff);
  const group = new THREE.Group();
  group.name = `ship-${id}`;
  const dark = physical(remote ? 0x321c4b : 0x172947, { emissiveIntensity: 0.035, roughness: 0.28 });
  const hull = physical(remote ? 0x7b477f : 0x8cb6d8, { emissiveIntensity: 0.075, metalness: 0.92, roughness: 0.18 });
  const accentMat = physical(accent, { emissiveIntensity: 0.82, roughness: 0.16 });
  const glass = physical(remote ? 0xff9ee7 : 0x9ff8ff, {
    emissiveIntensity: 1.1,
    metalness: 0.15,
    roughness: 0.08,
    transparent: true,
    opacity: 0.88,
  });

  if (id === "colosso") {
    addMesh(group, wedgeGeometry(2.2, 3.2, 0.72, 2.05), hull);
    addMesh(group, new THREE.BoxGeometry(0.75, 0.55, 2.35), dark, [-1.15, -0.03, 0.25]);
    addMesh(group, new THREE.BoxGeometry(0.75, 0.55, 2.35), dark, [1.15, -0.03, 0.25]);
    addMesh(group, wedgeGeometry(4.7, 2.0, 0.28, 3.5), dark, [0, -0.18, 0.35]);
    for (const x of [-1.5, -0.72, 0.72, 1.5]) addWeaponPod(group, x, -0.05, accent, 1.35);
    for (const x of [-1.05, 1.05]) addEngine(group, x, 1.35, accent, 1.2);
  } else if (id === "espectro") {
    addMesh(group, wedgeGeometry(0.9, 4.5, 0.5, 0.55), hull);
    const leftWing = addMesh(group, wedgeGeometry(2.7, 2.15, 0.2, 0.4), dark, [-1.02, -0.12, 0.55], [0, 0.42, 0]);
    const rightWing = leftWing.clone();
    rightWing.position.x = 1.02;
    rightWing.rotation.y = -0.42;
    group.add(rightWing);
    addMesh(group, wedgeGeometry(0.26, 3.8, 0.16, 0.2), accentMat, [0, 0.44, -0.12]);
    addWeaponPod(group, -1.75, 0.55, accent, 0.9);
    addWeaponPod(group, 1.75, 0.55, accent, 0.9);
    addEngine(group, 0, 1.72, accent, 0.85);
  } else if (id === "tempestade") {
    addMesh(group, wedgeGeometry(1.35, 3.5, 0.58, 1.15), hull);
    addMesh(group, wedgeGeometry(4.05, 2.4, 0.22, 2.6), dark, [0, -0.13, 0.48]);
    for (const x of [-1.65, 1.65]) {
      addMesh(group, new THREE.BoxGeometry(0.62, 0.52, 1.8), dark, [x, 0.06, 0.47]);
      for (let i = -1; i <= 1; i++) {
        addMesh(group, new THREE.CylinderGeometry(0.095, 0.12, 1.05, 9), accentMat, [x + i * 0.18, 0.36, 0.28], [Math.PI / 2, 0, 0]);
      }
    }
    addEngine(group, -0.48, 1.35, accent, 0.9);
    addEngine(group, 0.48, 1.35, accent, 0.9);
  } else {
    addMesh(group, wedgeGeometry(1.35, 3.55, 0.62, 1.1), hull);
    addMesh(group, wedgeGeometry(4.2, 2.25, 0.23, 2.45), dark, [0, -0.13, 0.48]);
    addMesh(group, wedgeGeometry(2.7, 1.3, 0.18, 1.7), accentMat, [0, 0.05, 0.35]);
    addWeaponPod(group, -1.6, 0.48, accent, 1.05);
    addWeaponPod(group, 1.6, 0.48, accent, 1.05);
    addEngine(group, -0.47, 1.35, accent, 0.9);
    addEngine(group, 0.47, 1.35, accent, 0.9);
  }

  const cockpit = addMesh(group, new THREE.SphereGeometry(0.43, 20, 12), glass, [0, 0.48, -0.55], [0, 0, 0], [0.78, 0.58, 1.35]);
  cockpit.castShadow = true;
  for (const x of [-1, 1]) {
    const nav = addMesh(group, new THREE.SphereGeometry(0.07, 10, 8), emissive(x < 0 ? 0xff5268 : 0x78ffb4), [x * (id === "colosso" ? 1.65 : 1.35), 0.16, 0.42]);
    nav.userData.pulse = true;
  }
  group.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  group.userData.accent = accent;
  return group;
}

function buildShipEvolution(ship = {}, entity = {}, remote = false) {
  const group = new THREE.Group();
  group.name = "ship-evolution";
  const accent = colorFrom(remote ? 0xff5bd7 : ship.color || 0x76f7ff);
  const armor = physical(remote ? 0x663b75 : 0x426482, { emissiveIntensity: 0.08, metalness: 0.94, roughness: 0.2 });
  const dark = physical(remote ? 0x21102e : 0x0e1c33, { emissiveIntensity: 0.025, metalness: 0.88, roughness: 0.3 });
  const energy = physical(accent, { emissiveIntensity: 1.2, metalness: 0.35, roughness: 0.12 });
  const weaponLevel = clamp(Math.floor(Number(entity.weaponTier) || 0), 0, 6);
  const engineLevel = clamp(Math.floor(Number(entity.engineTier) || 0), 0, 6);
  const armorLevel = clamp(Math.floor(Number(entity.armorTier) || 0), 0, 6);
  const span = ship.id === "colosso" ? 2.05 : ship.id === "espectro" ? 1.72 : ship.id === "tempestade" ? 1.92 : 1.86;

  for (let level = 1; level <= weaponLevel; level++) {
    if (level <= 2) {
      const x = span + (level - 1) * 0.28;
      for (const side of [-1, 1]) addWeaponPod(group, side * x, 0.2 - level * 0.2, accent, 1.25 + level * 0.22);
    } else if (level === 3) {
      addMesh(group, new THREE.CylinderGeometry(0.1, 0.16, 3.15, 10), dark, [0, 0.62, -1.05], [Math.PI / 2, 0, 0]);
      addMesh(group, new THREE.CylinderGeometry(0.055, 0.075, 3.35, 8), energy, [0, 0.63, -1.18], [Math.PI / 2, 0, 0]);
    } else if (level === 4) {
      for (const side of [-1, 1]) {
        const x = side * (span + 0.16);
        for (let cell = -1; cell <= 1; cell++) addMesh(group, new THREE.CylinderGeometry(0.09, 0.12, 0.82, 8), energy, [x + cell * 0.17, 0.38, 0.12], [Math.PI / 2, 0, 0]);
      }
    } else if (level === 5) {
      for (const side of [-1, 1]) addMesh(group, wedgeGeometry(0.34, 2.35, 0.16, 0.2), armor, [side * (span + 0.52), 0.03, 0.1], [0, side * 0.12, 0]);
    } else {
      const crown = addMesh(group, new THREE.TorusGeometry(0.62, 0.055, 8, 36), emissive(accent, 2.8), [0, 0.83, -0.18], [Math.PI / 2, 0, 0]);
      crown.userData.rotateRate = 0.8;
      for (let i = 0; i < 3; i++) addMesh(group, new THREE.ConeGeometry(0.08, 0.78, 7), energy, [(i - 1) * 0.28, 0.88, -0.72], [Math.PI / 2, 0, 0]);
    }
  }

  for (let level = 1; level <= armorLevel; level++) {
    if (level <= 2) {
      const x = span * (0.56 + level * 0.12);
      for (const side of [-1, 1]) addMesh(group, new THREE.BoxGeometry(0.5 + level * 0.08, 0.22, 1.5 + level * 0.28), armor, [side * x, -0.02, 0.42 + level * 0.12], [0, side * 0.08, 0]);
    } else if (level === 3) {
      addMesh(group, wedgeGeometry(1.12, 2.2, 0.22, 0.9), armor, [0, -0.2, 0.68], [Math.PI, 0, 0]);
    } else if (level === 4) {
      for (const side of [-1, 1]) addMesh(group, new THREE.DodecahedronGeometry(0.28, 0), energy, [side * (span + 0.32), 0.34, 0.72]);
    } else if (level === 5) {
      const shieldRail = addMesh(group, new THREE.TorusGeometry(span + 0.62, 0.035, 8, 64), emissive(accent, 2.2, 0.7), [0, 0.02, 0.3], [Math.PI / 2, 0, 0]);
      shieldRail.userData.rotateRate = -0.34;
    } else {
      for (let i = 0; i < 6; i++) {
        const angle = (i * TAU) / 6;
        addMesh(group, new THREE.OctahedronGeometry(0.16, 0), i % 2 ? energy : armor, [Math.cos(angle) * (span + 0.75), 0.2, Math.sin(angle) * (span + 0.75)]);
      }
    }
  }

  for (let level = 1; level <= engineLevel; level++) {
    if (level <= 3) {
      const x = 0.38 + (level - 1) * 0.34;
      for (const side of [-1, 1]) addEngine(group, side * x, 1.55 + level * 0.12, accent, 0.54 + level * 0.1);
    } else if (level === 4) {
      for (const side of [-1, 1]) addEngine(group, side * (span * 0.72), 1.48, accent, 0.72);
    } else if (level === 5) {
      for (const side of [-1, 1]) addMesh(group, wedgeGeometry(0.28, 1.55, 0.1, 0.16), energy, [side * (span + 0.34), -0.08, 1.08], [0, side * 0.18, 0]);
    } else {
      const reactor = addMesh(group, new THREE.TorusGeometry(0.72, 0.06, 8, 48), emissive(accent, 3), [0, 0.18, 1.18], [Math.PI / 2, 0, 0]);
      reactor.userData.rotateRate = 1.15;
      addMesh(group, new THREE.SphereGeometry(0.25, 16, 10), energy, [0, 0.22, 1.18]);
    }
  }

  group.userData.levels = { weaponLevel, engineLevel, armorLevel };
  return group;
}

function buildEnemy(type, color, bossKind = 0, variant = 0) {
  const tint = colorFrom(color || 0xff5d6c);
  const group = new THREE.Group();
  const armor = physical(tint.clone().multiplyScalar(0.52), { emissiveIntensity: 0.22, roughness: 0.3 });
  const glow = physical(tint, { emissiveIntensity: 1.35, roughness: 0.12 });
  const black = physical(0x121522, { emissive: false, roughness: 0.4 });

  if (type === "boss") {
    const profile = ((Number(bossKind) % 10) + 10) % 10;
    const ascension = Math.floor(Math.max(0, Number(bossKind) || 0) / 10);
    const coreGeometry = profile === 2 || profile === 6
      ? new THREE.DodecahedronGeometry(1.3, 1)
      : profile === 5 || profile === 8
        ? new THREE.OctahedronGeometry(1.4, 1)
        : new THREE.IcosahedronGeometry(1.25, 2);
    const core = addMesh(group, coreGeometry, armor);
    core.scale.y = 0.58;
    for (let ringIndex = 0; ringIndex < 3; ringIndex++) {
      const ring = addMesh(
        group,
        new THREE.TorusGeometry(1.55 + ringIndex * 0.38, 0.075 + ringIndex * 0.018, 10, 64),
        ringIndex === 1 ? emissive(0xffffff, 3) : glow,
        [0, ringIndex * 0.12 - 0.12, 0],
        [Math.PI / 2 + ringIndex * 0.38, ringIndex * 0.22, 0],
      );
      ring.userData.rotateRate = (ringIndex % 2 ? -1 : 1) * (0.45 + ringIndex * 0.22);
    }
    const arms = 6 + (profile % 5);
    for (let i = 0; i < arms; i++) {
      const angle = (i * TAU) / arms;
      const arm = new THREE.Group();
      arm.rotation.y = angle;
      addMesh(arm, wedgeGeometry(0.42, 2.35, 0.28, 0.28), armor, [0, 0, -1.85]);
      addMesh(arm, new THREE.SphereGeometry(0.2, 12, 8), glow, [0, 0.08, -2.92]);
      group.add(arm);
    }
    addMesh(group, new THREE.SphereGeometry(0.58, 24, 16), emissive(0xffffff), [0, 0.2, 0]);
    if (profile === 1 || profile === 7) {
      for (const side of [-1, 1]) addMesh(group, wedgeGeometry(1.1, 4.8, 0.2, 0.25), armor, [side * 2.2, -0.1, 0.2], [0, side * 0.48, side * 0.16]);
    } else if (profile === 2) {
      for (let i = 0; i < 12; i++) {
        const angle = (i * TAU) / 12;
        addMesh(group, new THREE.ConeGeometry(0.16, 2.1, 8), glow, [Math.cos(angle) * 2.25, 0, Math.sin(angle) * 2.25], [0, -angle, Math.PI / 2]);
      }
    } else if (profile === 3) {
      for (let i = 0; i < 4; i++) {
        const clock = addMesh(group, new THREE.TorusGeometry(2.45 + i * 0.27, 0.035, 7, 72), i % 2 ? glow : emissive(0xffffff, 2.6), [0, i * 0.08, 0], [Math.PI / 2 + i * 0.22, i * 0.16, 0]);
        clock.userData.rotateRate = (i % 2 ? -1 : 1) * (0.7 + i * 0.18);
      }
    } else if (profile === 4) {
      for (let i = 0; i < 3; i++) addMesh(group, new THREE.TorusKnotGeometry(1.45 + i * 0.28, 0.08, 72, 8), i === 1 ? glow : armor, [0, i * 0.16 - 0.16, 0], [Math.PI / 2, i * 0.5, 0]);
    } else if (profile === 5) {
      for (let i = 0; i < 8; i++) {
        const angle = (i * TAU) / 8;
        addMesh(group, new THREE.OctahedronGeometry(0.42, 0), i % 2 ? glow : armor, [Math.cos(angle) * 2.7, Math.sin(i) * 0.25, Math.sin(angle) * 2.7], [angle, 0, angle]);
      }
    } else if (profile === 6) {
      for (const x of [-2.5, -1.55, 1.55, 2.5]) addMesh(group, new THREE.BoxGeometry(0.48, 1.3, 3.8), x < 0 ? armor : black, [x, 0, 0]);
    } else if (profile === 8) {
      for (let i = 0; i < 9; i++) {
        const angle = (i * TAU) / 9;
        addMesh(group, new THREE.SphereGeometry(0.35, 14, 10), glow, [Math.cos(angle) * 3, 0.2, Math.sin(angle) * 3]);
      }
    } else if (profile === 9) {
      for (let i = 0; i < 5; i++) {
        const omegaRing = addMesh(group, new THREE.TorusGeometry(2.1 + i * 0.34, 0.055, 8, 72), i % 2 ? glow : emissive(0xffffff, 2.4), [0, 0, 0], [Math.PI / 2 + i * 0.29, i * 0.37, 0]);
        omegaRing.userData.rotateRate = (i % 2 ? -1 : 1) * (0.8 + i * 0.16);
      }
    }
    for (let tier = 0; tier < Math.min(6, ascension); tier++) {
      const satellites = 3 + tier;
      for (let i = 0; i < satellites; i++) {
        const angle = (i * TAU) / satellites + tier * 0.37;
        addMesh(group, new THREE.TetrahedronGeometry(0.2 + tier * 0.035, 0), tier % 2 ? glow : emissive(0xffffff, 2.4), [Math.cos(angle) * (3.4 + tier * 0.38), tier * 0.15 - 0.25, Math.sin(angle) * (3.4 + tier * 0.38)], [angle, tier, -angle]);
      }
    }
  } else if (type === "tank") {
    addMesh(group, new THREE.DodecahedronGeometry(1.12, 0), armor, [0, 0, 0], [0, Math.PI / 4, 0], [1.25, 0.62, 1.15]);
    for (const x of [-0.78, 0.78]) addWeaponPod(group, x, -0.45, tint, 1.35);
    addMesh(group, new THREE.SphereGeometry(0.34, 16, 10), glow, [0, 0.5, -0.2]);
  } else if (type === "shooter") {
    addMesh(group, new THREE.CylinderGeometry(0.92, 0.7, 0.48, 8), armor, [0, 0, 0], [0, Math.PI / 8, 0]);
    addMesh(group, new THREE.TorusGeometry(0.92, 0.08, 8, 32), glow, [0, 0.12, 0], [Math.PI / 2, 0, 0]);
    addMesh(group, new THREE.CylinderGeometry(0.18, 0.24, 1.55, 10), black, [0, 0.28, -0.76], [Math.PI / 2, 0, 0]);
    addMesh(group, new THREE.SphereGeometry(0.3, 16, 10), glow, [0, 0.38, 0]);
  } else if (type === "splitter" || type === "shard") {
    const points = type === "shard" ? 0 : 1;
    addMesh(group, new THREE.OctahedronGeometry(type === "shard" ? 0.82 : 1.1, points), armor, [0, 0, 0], [0.28, 0, 0], [0.72, 1.1, 0.72]);
    addMesh(group, new THREE.OctahedronGeometry(type === "shard" ? 0.42 : 0.58, 0), glow, [0, 0.1, 0]);
  } else if (type === "charger") {
    addMesh(group, wedgeGeometry(1.25, 3.25, 0.52, 0.5), armor);
    addMesh(group, new THREE.ConeGeometry(0.24, 2.1, 10), glow, [0, 0.08, -1.68], [Math.PI / 2, 0, 0]);
    for (const x of [-0.72, 0.72]) addMesh(group, wedgeGeometry(0.58, 1.5, 0.18, 0.34), black, [x, -0.08, 0.4], [0, x * 0.28, 0]);
  } else if (type === "zigzag") {
    addMesh(group, wedgeGeometry(1.05, 2.5, 0.45, 0.55), armor);
    for (const x of [-0.9, 0.9]) addMesh(group, wedgeGeometry(1.4, 1.25, 0.18, 0.35), black, [x, -0.08, 0.35], [0, x * 0.5, 0]);
    addMesh(group, new THREE.SphereGeometry(0.25, 14, 9), glow, [0, 0.38, -0.35]);
  } else if (type === "sniper") {
    addMesh(group, wedgeGeometry(0.72, 3.6, 0.38, 0.42), armor);
    addMesh(group, new THREE.CylinderGeometry(0.1, 0.15, 3.5, 9), black, [0, 0.24, -1.3], [Math.PI / 2, 0, 0]);
    addMesh(group, new THREE.SphereGeometry(0.28, 16, 10), glow, [0, 0.4, 0.25]);
    for (const side of [-1, 1]) addMesh(group, wedgeGeometry(0.7, 1.8, 0.14, 0.24), black, [side * 0.82, -0.08, 0.45], [0, side * 0.38, 0]);
  } else if (type === "minelayer") {
    addMesh(group, new THREE.DodecahedronGeometry(0.88, 0), armor, [0, 0, 0], [0.2, 0.3, 0], [1.25, 0.68, 1.25]);
    addMesh(group, new THREE.TorusGeometry(1.18, 0.12, 8, 36), glow, [0, 0.1, 0], [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 4; i++) {
      const angle = (i * TAU) / 4;
      addMesh(group, new THREE.SphereGeometry(0.25, 12, 8), black, [Math.cos(angle) * 1.15, 0, Math.sin(angle) * 1.15]);
    }
  } else if (type === "leech") {
    addMesh(group, new THREE.SphereGeometry(0.92, 18, 12), armor, [0, 0, 0], [0, 0, 0], [0.75, 0.62, 1.5]);
    addMesh(group, new THREE.TorusGeometry(0.52, 0.12, 8, 28), glow, [0, 0.08, -1.18], [Math.PI / 2, 0, 0]);
    for (const side of [-1, 1]) addMesh(group, new THREE.ConeGeometry(0.18, 1.4, 8), black, [side * 0.7, 0, 0.25], [0, 0, side * 0.55]);
  } else if (type === "sentinel") {
    addMesh(group, new THREE.CylinderGeometry(1, 1, 0.46, 6), armor, [0, 0, 0], [0, Math.PI / 6, 0]);
    addMesh(group, new THREE.TorusGeometry(1.22, 0.1, 8, 6), glow, [0, 0.15, 0], [Math.PI / 2, 0, 0]);
    addMesh(group, new THREE.SphereGeometry(0.38, 18, 12), glow, [0, 0.42, 0]);
    for (let i = 0; i < 3; i++) addWeaponPod(group, (i - 1) * 0.62, -0.45, tint, 1.1);
  } else {
    addMesh(group, wedgeGeometry(1.35, 2.55, 0.5, 0.72), armor);
    addMesh(group, wedgeGeometry(2.5, 1.2, 0.16, 1.25), black, [0, -0.12, 0.42]);
    addMesh(group, new THREE.SphereGeometry(0.24, 14, 9), glow, [0, 0.38, -0.35]);
  }
  if (type !== "boss" && variant > 0) {
    for (let i = 0; i < variant; i++) {
      const ring = addMesh(group, new THREE.TorusGeometry(1.08 + i * 0.16, 0.035 + i * 0.008, 7, 32), i % 2 ? glow : emissive(tint, 2.1), [0, 0.08 + i * 0.05, 0], [Math.PI / 2 + i * 0.18, i * 0.23, 0]);
      ring.userData.rotateRate = (i % 2 ? -1 : 1) * (0.6 + i * 0.15);
    }
    if (variant >= 2) {
      for (const side of [-1, 1]) addMesh(group, new THREE.BoxGeometry(0.3, 0.2, 1.35 + variant * 0.18), armor, [side * (1.05 + variant * 0.08), 0, 0.15]);
    }
    if (variant >= 4) {
      for (let i = 0; i < 5; i++) {
        const angle = (i * TAU) / 5;
        addMesh(group, new THREE.ConeGeometry(0.11, 0.72, 7), glow, [Math.cos(angle) * 1.55, 0.18, Math.sin(angle) * 1.55], [0, -angle, Math.PI / 2]);
      }
    }
  }
  group.userData.tint = tint;
  return group;
}

function radialTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.12, "rgba(255,255,255,.9)");
  gradient.addColorStop(0.38, "rgba(255,255,255,.24)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function textSprite(text, color = "#ffffff", subtext = "") {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = subtext ? 112 : 72;
  const context = canvas.getContext("2d");
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.shadowBlur = 14;
  context.shadowColor = color;
  context.fillStyle = color;
  context.font = "900 28px system-ui";
  context.fillText(String(text).slice(0, 34), 256, subtext ? 38 : 36, 486);
  if (subtext) {
    context.shadowBlur = 6;
    context.fillStyle = "#d9e8ff";
    context.font = "800 17px system-ui";
    context.fillText(String(subtext).slice(0, 46), 256, 76, 486);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  }));
  sprite.scale.set(subtext ? 92 : 62, subtext ? 20 : 10, 1);
  sprite.userData.texture = texture;
  return sprite;
}

function makeBar() {
  const group = new THREE.Group();
  const background = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x07101f, opacity: 0.86, transparent: true, depthTest: false }));
  background.scale.set(34, 4.8, 1);
  const hp = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xff6378, toneMapped: false, depthTest: false }));
  hp.position.z = 0.1;
  hp.scale.set(32, 2.25, 1);
  const shield = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x76f7ff, toneMapped: false, depthTest: false }));
  shield.position.y = 3.4;
  shield.position.z = 0.15;
  shield.scale.set(32, 1.2, 1);
  group.add(background, hp, shield);
  group.userData.hp = hp;
  group.userData.shield = shield;
  return group;
}

export class StarforgeThreeRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ready = false;
    this.width = 1;
    this.height = 1;
    this.lastTime = performance.now();
    this.currentBiome = -1;
    this.currentSeed = 0;
    this.environmentTransition = null;
    this.frame = null;
    this.entityRecords = new Map();
    this.pickupRecords = new Map();
    this.shockRecords = new Map();
    this.textRecords = new Map();
    this.previewRecords = new WeakMap();
    this.bulletColorCache = new Map();
    this.tempHsl = { h: 0, s: 0, l: 0 };
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.hitPoint = new THREE.Vector3();
    this.scalePointA = new THREE.Vector3();
    this.scalePointB = new THREE.Vector3();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.dummy = new THREE.Object3D();
    this.glowTexture = radialTexture();

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.82;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x02040d);
    this.scene.fog = new THREE.FogExp2(0x050817, 0.00042);
    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 4000);
    this.camera.position.set(0, 570, 620);
    this.camera.lookAt(0, 0, 0);

    this.environment = new THREE.Group();
    this.world = new THREE.Group();
    this.effects = new THREE.Group();
    this.scene.add(this.environment, this.world, this.effects);

    const hemi = new THREE.HemisphereLight(0x9fdcff, 0x08030f, 0.68);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xc4ecff, 1.85);
    key.position.set(-180, 360, 160);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xff62d6, 1.15);
    rim.position.set(280, 120, -280);
    this.scene.add(rim);

    this.renderPass = new RenderPass(this.scene, this.camera);
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.82, 0.45, 0.72);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    this.playerBullets = this.makeBulletInstances(900);
    this.enemyBullets = this.makeBulletInstances(1000);
    this.particlePoints = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({
        size: 3.4,
        map: this.glowTexture,
        transparent: true,
        vertexColors: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.effects.add(this.particlePoints);
    this.resize();
    this.ready = true;
  }

  makeBulletInstances(capacity) {
    const mesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.55, 8, 6),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        toneMapped: false,
        transparent: true,
        opacity: 0.96,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
      capacity,
    );
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    this.effects.add(mesh);
    return mesh;
  }

  bulletTint(value, hostile) {
    const source = value || (hostile ? "#ff3f91" : "#32e6ff");
    const key = String(source);
    let tint = this.bulletColorCache.get(key);
    if (tint) return tint;
    tint = colorFrom(source);
    tint.getHSL(this.tempHsl);
    tint.setHSL(this.tempHsl.h, Math.max(0.78, this.tempHsl.s), clamp(this.tempHsl.l, 0.5, 0.68));
    this.bulletColorCache.set(key, tint);
    return tint;
  }

  resize() {
    const width = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const height = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.camera.aspect = width / height;
    this.camera.fov = width < 760 ? 54 : 46;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
  }

  screenToWorld(x, y, elevation = 0, target = this.hitPoint) {
    this.pointer.set((x / this.width) * 2 - 1, -(y / this.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    this.plane.constant = -elevation;
    this.raycaster.ray.intersectPlane(this.plane, target);
    return target;
  }

  scaleAt(x, y, pixels = 20) {
    this.screenToWorld(x, y, 0, this.scalePointA);
    this.screenToWorld(x + pixels, y, 0, this.scalePointB);
    return this.scalePointA.distanceTo(this.scalePointB) / pixels;
  }

  buildEnvironment(frame, target) {
    const random = rngFrom((frame.worldSeed || 1) ^ Math.imul((frame.biomeIndex || 0) + 1, 0x45d9f3b));
    const glow = frame.biome?.glow || [80, 120, 255];
    const top = frame.biome?.top || [10, 18, 44];
    const glowColor = new THREE.Color(glow[0] / 255, glow[1] / 255, glow[2] / 255);
    const bgColor = new THREE.Color(top[0] / 1020, top[1] / 1020, top[2] / 1020);

    const firstSector = Number(frame.biomeIndex || 0) === 0;
    const starCount = this.width < 760 ? 850 : 1900;
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const point = this.screenToWorld(random() * this.width, random() * this.height, -80 - random() * 220);
      positions[i * 3] = point.x;
      positions[i * 3 + 1] = point.y;
      positions[i * 3 + 2] = point.z;
      const brightness = 0.32 + random() * 0.68;
      const star = random() > 0.78 ? glowColor : new THREE.Color(0xb9d8ff);
      colors[i * 3] = star.r * brightness;
      colors[i * 3 + 1] = star.g * brightness;
      colors[i * 3 + 2] = star.b * brightness;
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    starGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({
      size: firstSector ? 2.15 : 1.85,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      toneMapped: false,
    }));
    stars.userData.stars = true;
    target.add(stars);

    for (let i = 0; i < 9; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.glowTexture,
        color: glowColor,
        transparent: true,
        opacity: (firstSector ? 0.13 : 0.085) + random() * (firstSector ? 0.13 : 0.1),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }));
      const fixedNebulae = [[0.16, 0.25], [0.52, 0.68], [0.84, 0.38]];
      const placement = fixedNebulae[i];
      const point = this.screenToWorld(
        this.width * (placement ? placement[0] : random()),
        this.height * (placement ? placement[1] : random()),
        -72 - random() * 105,
      );
      sprite.position.copy(point);
      const size = (firstSector ? 280 : 210) + random() * (firstSector ? 480 : 420);
      sprite.scale.set(size, size, 1);
      sprite.userData.drift = (random() - 0.5) * 0.18;
      target.add(sprite);
    }

    const propType = frame.biome?.props?.type || "asteroid";
    const propCount = clamp(Math.round((frame.biome?.props?.count || 10) * 1.7), 12, 28);
    for (let i = 0; i < propCount; i++) {
      const radius = 6 + random() * 18;
      if (propType === "cloud") {
        const cloudColor = frame.biome?.props?.color || glow;
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
          map: this.glowTexture,
          color: new THREE.Color(cloudColor[0] / 255, cloudColor[1] / 255, cloudColor[2] / 255),
          transparent: true,
          opacity: (firstSector ? 0.11 : 0.065) + random() * 0.1,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          fog: false,
        }));
        sprite.position.copy(this.screenToWorld(random() * this.width, random() * this.height, -30 - random() * 75));
        sprite.scale.set(radius * (7 + random() * 5), radius * (4 + random() * 4), 1);
        sprite.material.rotation = random() * TAU;
        sprite.userData.drift = (random() - 0.5) * 0.1;
        target.add(sprite);
        continue;
      }
      let geometry;
      if (propType === "crystal") geometry = new THREE.OctahedronGeometry(radius, 0);
      else geometry = new THREE.DodecahedronGeometry(radius, 0);
      const propColor = frame.biome?.props?.color || glow;
      const propTint = new THREE.Color(propColor[0] / 255, propColor[1] / 255, propColor[2] / 255).lerp(new THREE.Color(0x8fa8c6), 0.28);
      const propMaterial = propType === "crystal"
        ? physical(propTint, { emissiveIntensity: 0.48, roughness: 0.5, metalness: 0.42 })
        : new THREE.MeshBasicMaterial({ color: propTint, fog: false });
      const mesh = new THREE.Mesh(geometry, propMaterial);
      mesh.material.fog = false;
      const point = this.screenToWorld(random() * this.width, random() * this.height, -24 - random() * 70);
      mesh.position.copy(point);
      mesh.rotation.set(random() * TAU, random() * TAU, random() * TAU);
      mesh.scale.y = 0.65 + random() * 0.75;
      mesh.userData.spin = new THREE.Vector3((random() - 0.5) * 0.18, (random() - 0.5) * 0.22, (random() - 0.5) * 0.14);
      target.add(mesh);
    }

    {
      const planetColor = frame.biome?.planet || glow;
      const planetTint = new THREE.Color(planetColor[0] / 255, planetColor[1] / 255, planetColor[2] / 255)
        .lerp(new THREE.Color(0xb9dcff), firstSector ? 0.22 : 0.08)
        .multiplyScalar(firstSector ? 0.86 : 0.75);
      const planet = new THREE.Mesh(
        new THREE.SphereGeometry(firstSector ? 76 : 64, 48, 28),
        new THREE.MeshBasicMaterial({ color: planetTint, toneMapped: true, fog: false }),
      );
      const planetOnRight = random() > 0.5;
      const planetX = this.width * (planetOnRight ? 0.82 + random() * 0.07 : 0.11 + random() * 0.07);
      const point = this.screenToWorld(planetX, this.height * (0.22 + random() * 0.1), -220);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.glowTexture,
        color: glowColor,
        transparent: true,
        opacity: 0.24,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        fog: false,
      }));
      halo.position.copy(point);
      halo.scale.set(235, 235, 1);
      target.add(halo);
      planet.position.copy(point);
      target.add(planet);
      const atmosphere = new THREE.Mesh(
        new THREE.SphereGeometry(firstSector ? 82 : 69, 40, 24),
        new THREE.MeshBasicMaterial({ color: glowColor, transparent: true, opacity: 0.1, side: THREE.FrontSide, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
      );
      atmosphere.position.copy(point);
      target.add(atmosphere);
      const longitudeLines = new THREE.Mesh(
        new THREE.SphereGeometry(firstSector ? 77 : 65, 24, 12),
        new THREE.MeshBasicMaterial({ color: glowColor, wireframe: true, transparent: true, opacity: 0.12, depthWrite: false, fog: false }),
      );
      longitudeLines.position.copy(point);
      longitudeLines.rotation.y = random() * TAU;
      longitudeLines.userData.spin = new THREE.Vector3(0, 0.025, 0);
      target.add(longitudeLines);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(firstSector ? 96 : 82, firstSector ? 132 : 112, 96),
        new THREE.MeshBasicMaterial({ color: glowColor, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false, fog: false }),
      );
      ring.position.copy(point);
      ring.rotation.set(Math.PI / 2.65, 0.15, -0.28);
      target.add(ring);
    }
    for (const object of target.children) {
      const projected = object.position.clone().project(this.camera);
      const celestial = !object.userData.stars && object.position.y < -175;
      const nearby = object.geometry?.type === "DodecahedronGeometry" || object.geometry?.type === "OctahedronGeometry";
      object.userData.transitionZ = object.position.z;
      object.userData.flowX = clamp((projected.x + 1) * this.width * 0.5, 0, this.width);
      object.userData.flowY = clamp((1 - projected.y) * this.height * 0.5, -180, this.height + 180);
      object.userData.flowElevation = object.position.y;
      object.userData.flowOffset = 0;
      object.userData.parallaxFactor = object.userData.stars ? 0.72 : nearby ? 1.12 : celestial ? 0.82 : 0.9;
      object.userData.flowSpeed = object.userData.stars ? 3.5 : nearby ? 15 : celestial ? 5.5 : 8.5;
    }
    return bgColor;
  }

  disposeEnvironment(group) {
    if (!group) return;
    group.traverse((object) => {
      object.geometry?.dispose?.();
      if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
      else object.material?.dispose?.();
    });
    group.removeFromParent();
  }

  changeEnvironment(frame) {
    const incoming = new THREE.Group();
    const incomingColor = this.buildEnvironment(frame, incoming);
    if (this.currentBiome < 0 || !this.environment.children.length) {
      this.disposeEnvironment(this.environment);
      this.environment = incoming;
      this.scene.add(this.environment);
      this.scene.background = incomingColor;
      this.scene.fog.color.copy(incomingColor);
      return;
    }

    if (this.environmentTransition) this.disposeEnvironment(this.environmentTransition.outgoing);
    const outgoing = this.environment;
    const distance = this.scaleAt(this.width * 0.5, this.height * 0.5) * this.height * 1.38;
    for (const object of outgoing.children) object.userData.transitionZ = object.position.z;
    for (const object of incoming.children) {
      object.position.z = object.userData.transitionZ - distance * object.userData.parallaxFactor;
    }
    this.environment = incoming;
    this.scene.add(incoming);
    this.environmentTransition = {
      outgoing,
      incoming,
      elapsed: 0,
      duration: 1.65,
      distance,
      fromColor: this.scene.background.clone(),
      toColor: incomingColor,
    };
  }

  createEntityRecord(entity, kind, frame) {
    const root = new THREE.Group();
    const isPlayer = kind === "player" || kind === "remote";
    const model = isPlayer
      ? buildDetailedShip(entity.ship || { id: entity.shipId, color: kind === "remote" ? "#ff5bd7" : "#76f7ff" }, kind === "remote")
      : buildEnemy(entity.boss ? "boss" : (entity.family || entity.type), entity.color, entity.kind || 0, entity.variant || 0);
    root.add(model);
    const evolution = isPlayer
      ? buildShipEvolution(entity.ship || { id: entity.shipId, color: kind === "remote" ? "#ff5bd7" : "#76f7ff" }, entity, kind === "remote")
      : null;
    if (evolution) model.add(evolution);
    const bar = makeBar();
    bar.visible = !isPlayer;
    root.add(bar);
    const shield = new THREE.Mesh(
      new THREE.SphereGeometry(1.55, 24, 16),
      new THREE.MeshBasicMaterial({ color: kind === "remote" ? 0xff5bd7 : 0x76f7ff, transparent: true, opacity: 0, side: THREE.BackSide, depthWrite: false, toneMapped: true }),
    );
    model.add(shield);
    const upgrade = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.7 + i * 0.42, 0.045, 8, 48),
        emissive(entity.ship?.color || entity.color || 0x76f7ff, 3),
      );
      ring.rotation.x = Math.PI / 2;
      ring.visible = false;
      upgrade.add(ring);
    }
    model.add(upgrade);
    const record = {
      root,
      model,
      bar,
      shield,
      upgrade,
      evolution,
      evolutionKey: isPlayer ? this.shipEvolutionKey(entity) : "",
      label: null,
      upgradeKey: "",
      kind,
      entity,
    };
    if (isPlayer) {
      const name = kind === "remote" ? frame.remoteName : frame.localName;
      record.label = textSprite(name || "PILOTO", kind === "remote" ? "#ff9fe5" : entity.ship?.color || "#76f7ff");
      record.label.position.set(0, 2.5, 0);
      root.add(record.label);
    }
    this.world.add(root);
    return record;
  }

  disposeRecord(record) {
    record.root.removeFromParent();
    if (record.label?.userData.texture) record.label.userData.texture.dispose();
  }

  shipEvolutionKey(entity) {
    return [
      clamp(Math.floor(Number(entity.weaponTier) || 0), 0, 6),
      clamp(Math.floor(Number(entity.engineTier) || 0), 0, 6),
      clamp(Math.floor(Number(entity.armorTier) || 0), 0, 6),
      entity.ship?.id || entity.shipId || "vanguarda",
    ].join(":");
  }

  disposeDynamicGroup(group) {
    if (!group) return;
    group.traverse((object) => {
      object.geometry?.dispose?.();
      if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
      else object.material?.dispose?.();
    });
    group.removeFromParent();
  }

  syncShipEvolution(record, entity) {
    if (record.kind !== "player" && record.kind !== "remote") return;
    const key = this.shipEvolutionKey(entity);
    if (key === record.evolutionKey) return;
    this.disposeDynamicGroup(record.evolution);
    record.evolution = buildShipEvolution(
      entity.ship || { id: entity.shipId, color: record.kind === "remote" ? "#ff5bd7" : "#76f7ff" },
      entity,
      record.kind === "remote",
    );
    record.model.add(record.evolution);
    record.evolutionKey = key;
  }

  syncEntity(entity, kind, frame, present) {
    if (!entity || entity.dead) return;
    present.add(entity);
    let record = this.entityRecords.get(entity);
    if (!record || record.kind !== kind) {
      if (record) this.disposeRecord(record);
      record = this.createEntityRecord(entity, kind, frame);
      this.entityRecords.set(entity, record);
    }
    this.syncShipEvolution(record, entity);
    const point = this.screenToWorld(entity.x, entity.y, kind === "player" || kind === "remote" ? 9 : 5);
    record.root.position.lerp(point, kind === "remote" ? 0.72 : 1);
    const pixelScale = this.scaleAt(entity.x, entity.y);
    const baseRadius = entity.boss ? 1.7 : kind === "player" || kind === "remote" ? 2.7 : 1.15;
    const targetSize = (entity.r || (entity.boss ? 66 : 16)) * pixelScale / baseRadius;
    const pulse = entity.upgradeFx ? 1 + Math.sin(frame.gameTime * 22) * 0.06 * clamp(entity.upgradeFx.life, 0, 1) : 1;
    const entitySize = kind === "player" || kind === "remote" ? (entity.size || 1) : 1;
    const displayBoost = entity.boss ? 1.12 : kind === "player" || kind === "remote" ? (this.width < 760 ? 2.05 : 2.3) : 1.55;
    const renderSize = targetSize * displayBoost;
    record.model.scale.setScalar(renderSize * entitySize * pulse);
    record.model.rotation.y = -(Number(entity.angle ?? entity.rot ?? 0) + Math.PI / 2);
    record.model.rotation.z = clamp(-(entity.vx || 0) * 0.0012, -0.3, 0.3);
    record.model.rotation.x = clamp((entity.vy || 0) * 0.00065, -0.18, 0.18);
    record.model.traverse((child) => {
      if (child.userData.engineGlow) {
        const thrust = 0.88 + Math.sin(frame.time * 31 + child.position.x) * 0.18 + (entity.afterburn ? 0.65 : 0);
        child.scale.copy(child.userData.baseScale).multiplyScalar(thrust);
      }
      if (child.userData.rotateRate) child.rotation.z += child.userData.rotateRate * 0.016;
      if (child.userData.pulse) child.scale.setScalar(0.86 + Math.sin(frame.time * 5 + child.position.x) * 0.18);
    });
    record.model.visible = !(entity.invuln > 0 && Math.floor(entity.invuln * 16) % 2 === 0);
    record.shield.material.opacity = entity.maxShield > 0 && entity.shield > 0
      ? 0.035 + 0.075 * clamp(entity.shield / entity.maxShield, 0, 1) + (entity.shieldFlash ? 0.15 : 0)
      : 0;
    if (!record.bar.visible && kind !== "player" && kind !== "remote") record.bar.visible = true;
    if (record.bar.visible) {
      record.bar.position.set(0, renderSize * 1.55 + 5, 0);
      const hpRatio = clamp((entity.hp || 0) / Math.max(1, entity.maxHp || 1), 0, 1);
      const shieldRatio = clamp((entity.shield || 0) / Math.max(1, entity.maxShield || 1), 0, 1);
      record.bar.userData.hp.scale.x = 32 * hpRatio;
      record.bar.userData.hp.position.x = -16 * (1 - hpRatio);
      record.bar.userData.shield.scale.x = 32 * shieldRatio;
      record.bar.userData.shield.position.x = -16 * (1 - shieldRatio);
      record.bar.userData.shield.visible = shieldRatio > 0;
    }
    if (record.label) record.label.position.y = renderSize * 1.5 + 9;
    this.syncUpgrade(record, entity, frame);
    if (kind === "player" || kind === "remote") this.syncDrones(record, entity, frame);
  }

  syncDrones(record, entity, frame) {
    if (!record.drones) {
      record.drones = new THREE.Group();
      record.root.add(record.drones);
    }
    const wanted = Math.max(0, Math.floor(entity.drones || 0));
    while (record.drones.children.length < wanted) {
      const drone = buildEnemy("scout", record.kind === "remote" ? "#ff5bd7" : "#b46cff");
      drone.scale.setScalar(0.18);
      record.drones.add(drone);
    }
    while (record.drones.children.length > wanted) record.drones.remove(record.drones.children.at(-1));
    record.drones.children.forEach((drone, index) => {
      const angle = frame.gameTime * 1.35 + (index * TAU) / Math.max(1, wanted);
      drone.position.set(Math.cos(angle) * 31, 8 + Math.sin(angle * 2) * 3, Math.sin(angle) * 31);
      drone.rotation.y = -angle;
    });
  }

  syncUpgrade(record, entity, frame) {
    const fx = entity.upgradeFx;
    const active = fx && fx.life > 0;
    record.upgrade.visible = Boolean(active);
    record.upgrade.children.forEach((ring, index) => {
      ring.visible = Boolean(active);
      if (!active) return;
      ring.material.transparent = true;
      const progress = 1 - fx.life / fx.maxLife;
      ring.rotation.z = frame.time * (0.8 + index * 0.35) * (index % 2 ? -1 : 1);
      const scale = 0.55 + ((progress + index * 0.18) % 1) * 1.2;
      ring.scale.setScalar(scale);
      ring.material.opacity = clamp(fx.life / 0.4, 0, 1) * (1 - ((progress + index * 0.18) % 1));
    });
    const key = active ? `${fx.name}|${fx.level}|${fx.playerName}` : "";
    if (key !== record.upgradeKey) {
      if (record.upgradeLabel) {
        record.upgradeLabel.removeFromParent();
        record.upgradeLabel.userData.texture?.dispose();
        record.upgradeLabel = null;
      }
      record.upgradeKey = key;
      if (active) {
        record.upgradeLabel = textSprite(`UPGRADE · ${fx.name}`, fx.color || "#76f7ff", `${fx.playerName} · NV.${fx.level}`);
        record.upgradeLabel.position.set(0, 22, 0);
        record.root.add(record.upgradeLabel);
      }
    }
    if (record.upgradeLabel) {
      record.upgradeLabel.material.opacity = clamp(fx.life / 0.35, 0, 1);
      record.upgradeLabel.position.y = 20 + Math.sin((1 - fx.life / fx.maxLife) * Math.PI) * 8;
    }
  }

  syncEntityCollection(frame) {
    const present = new Set();
    this.syncEntity(frame.player, "player", frame, present);
    this.syncEntity(frame.remotePlayer, "remote", frame, present);
    for (const enemy of frame.enemies || []) this.syncEntity(enemy, "enemy", frame, present);
    for (const [entity, record] of this.entityRecords) {
      if (!present.has(entity)) {
        this.disposeRecord(record);
        this.entityRecords.delete(entity);
      }
    }
  }

  syncPickups(frame) {
    const present = new Set();
    for (const pickup of frame.pickups || []) {
      present.add(pickup);
      let mesh = this.pickupRecords.get(pickup);
      if (!mesh) {
        const color = pickup.bossDrop ? 0xfff0a0 : 0xffd36b;
        mesh = new THREE.Group();
        addMesh(mesh, new THREE.OctahedronGeometry(0.75, 1), physical(color, { emissiveIntensity: 1.8, roughness: 0.12 }));
        addMesh(mesh, new THREE.TorusGeometry(1.12, 0.055, 8, 32), emissive(0xb46cff), [0, 0, 0], [Math.PI / 2, 0, 0]);
        this.effects.add(mesh);
        this.pickupRecords.set(pickup, mesh);
      }
      mesh.position.copy(this.screenToWorld(pickup.x, pickup.y, 7));
      const scale = this.scaleAt(pickup.x, pickup.y) * (pickup.r || 4) * 1.1;
      mesh.scale.setScalar(scale);
      mesh.rotation.y = frame.time * 2.8 + (pickup.phase || 0);
      mesh.rotation.x = Math.sin(frame.time * 2.1 + (pickup.phase || 0)) * 0.45;
    }
    for (const [pickup, mesh] of this.pickupRecords) {
      if (!present.has(pickup)) {
        mesh.removeFromParent();
        this.pickupRecords.delete(pickup);
      }
    }
  }

  syncBulletInstances(mesh, bullets, frame, hostile = false) {
    const count = Math.min(mesh.instanceMatrix.count, bullets?.length || 0);
    const needsColorShader = !mesh.instanceColor && count > 0;
    for (let i = 0; i < count; i++) {
      const bullet = bullets[i];
      const point = this.screenToWorld(bullet.x, bullet.y, hostile ? 8 : 10);
      const scale = this.scaleAt(bullet.x, bullet.y);
      this.dummy.position.copy(point);
      this.dummy.rotation.set(0, -Math.atan2(bullet.vy || 0, bullet.vx || 1) + Math.PI / 2, 0);
      this.dummy.scale.set((bullet.r || 3) * scale * 0.82, (bullet.r || 3) * scale * 0.82, (bullet.isMissile ? 15 : 9) * scale);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
      mesh.setColorAt(i, this.bulletTint(bullet.color, hostile));
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
      if (needsColorShader) mesh.material.needsUpdate = true;
    }
  }

  syncParticles(frame) {
    const source = (frame.particles || []).slice(-850);
    const positions = new Float32Array(source.length * 3);
    const colors = new Float32Array(source.length * 3);
    source.forEach((particle, index) => {
      const point = this.screenToWorld(particle.x, particle.y, 7 + (index % 5) * 0.55);
      positions[index * 3] = point.x;
      positions[index * 3 + 1] = point.y;
      positions[index * 3 + 2] = point.z;
      const color = colorFrom(particle.color || 0xffffff).multiplyScalar(clamp(particle.life / Math.max(0.01, particle.maxLife || 1), 0, 1));
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
    });
    this.particlePoints.geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.particlePoints.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.particlePoints.geometry.computeBoundingSphere();
  }

  syncShockwaves(frame) {
    const present = new Set();
    for (const shockwave of frame.shockwaves || []) {
      present.add(shockwave);
      let ring = this.shockRecords.get(shockwave);
      if (!ring) {
        ring = new THREE.Mesh(
          new THREE.RingGeometry(0.92, 1, 64),
          new THREE.MeshBasicMaterial({ color: colorFrom(shockwave.color), transparent: true, opacity: 0.8, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
        );
        ring.rotation.x = -Math.PI / 2;
        this.effects.add(ring);
        this.shockRecords.set(shockwave, ring);
      }
      ring.position.copy(this.screenToWorld(shockwave.x, shockwave.y, 3));
      const scale = this.scaleAt(shockwave.x, shockwave.y) * shockwave.r;
      ring.scale.setScalar(scale);
      ring.material.opacity = clamp(shockwave.life / Math.max(0.01, shockwave.maxLife), 0, 1) * 0.82;
    }
    for (const [shockwave, ring] of this.shockRecords) {
      if (!present.has(shockwave)) {
        ring.removeFromParent();
        this.shockRecords.delete(shockwave);
      }
    }
  }

  syncTexts(frame) {
    const present = new Set();
    for (const item of frame.texts || []) {
      present.add(item);
      let sprite = this.textRecords.get(item);
      if (!sprite) {
        sprite = textSprite(item.text, item.color || "#ffffff");
        this.effects.add(sprite);
        this.textRecords.set(item, sprite);
      }
      sprite.position.copy(this.screenToWorld(item.x, item.y, 18));
      sprite.material.opacity = clamp(item.life / Math.max(0.01, item.maxLife), 0, 1);
      const scale = clamp((item.size || 14) / 14, 0.7, 1.7);
      sprite.scale.set(58 * scale, 10 * scale, 1);
    }
    for (const [item, sprite] of this.textRecords) {
      if (!present.has(item)) {
        sprite.removeFromParent();
        sprite.userData.texture?.dispose();
        this.textRecords.delete(item);
      }
    }
  }

  animateEnvironment(frame, dt) {
    for (const object of this.environment.children) {
      if (object.userData.stars) object.rotation.y = frame.time * 0.004;
      object.traverse((child) => {
        if (!child.userData.spin) return;
        child.rotation.x += child.userData.spin.x * dt;
        child.rotation.y += child.userData.spin.y * dt;
        child.rotation.z += child.userData.spin.z * dt;
      });
    }
    const transition = this.environmentTransition;
    if (!transition) {
      const worldPerPixel = this.scaleAt(this.width * 0.5, this.height * 0.5);
      for (const object of this.environment.children) {
        if (object.userData.stars) {
          object.userData.flowOffset = (object.userData.flowOffset + object.userData.flowSpeed * dt) % (this.height + 240);
          object.position.z = worldPerPixel * object.userData.flowOffset;
          continue;
        }
        object.userData.flowY += object.userData.flowSpeed * dt;
        if (object.userData.flowY > this.height + 180) object.userData.flowY = -180;
        if (object.userData.drift) {
          object.userData.flowX = (object.userData.flowX + object.userData.drift * dt * 5 + this.width) % this.width;
        }
        object.position.copy(this.screenToWorld(
          object.userData.flowX,
          object.userData.flowY,
          object.userData.flowElevation,
        ));
      }
      return;
    }
    transition.elapsed += dt;
    const progress = clamp(transition.elapsed / transition.duration, 0, 1);
    const eased = progress * progress * (3 - 2 * progress);
    for (const object of transition.outgoing.children) {
      object.position.z = object.userData.transitionZ + transition.distance * eased * object.userData.parallaxFactor;
    }
    for (const object of transition.incoming.children) {
      object.position.z = object.userData.transitionZ - transition.distance * (1 - eased) * object.userData.parallaxFactor;
    }
    this.scene.background.lerpColors(transition.fromColor, transition.toColor, eased);
    this.scene.fog.color.copy(this.scene.background);
    if (progress >= 1) {
      for (const object of transition.incoming.children) object.position.z = object.userData.transitionZ;
      this.disposeEnvironment(transition.outgoing);
      this.environmentTransition = null;
    }
  }

  renderFrame(frame) {
    if (!this.ready) return;
    this.resize();
    this.frame = frame;
    if (frame.biomeIndex !== this.currentBiome || frame.worldSeed !== this.currentSeed) {
      this.changeEnvironment(frame);
      this.currentBiome = frame.biomeIndex;
      this.currentSeed = frame.worldSeed;
    }
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0, (now - this.lastTime) / 1000));
    this.lastTime = now;
    this.syncEntityCollection(frame);
    this.syncPickups(frame);
    this.syncBulletInstances(this.playerBullets, frame.bullets, frame, false);
    this.syncBulletInstances(this.enemyBullets, frame.enemyBullets, frame, true);
    this.syncParticles(frame);
    this.syncShockwaves(frame);
    this.syncTexts(frame);
    this.animateEnvironment(frame, dt);

    const shake = clamp(Number(frame.state?.shake) || 0, 0, 24);
    this.camera.position.x = Math.sin(frame.time * 79) * shake * 0.18;
    this.camera.position.y = 570 + Math.cos(frame.time * 61) * shake * 0.1;
    this.camera.position.z = 620 + Math.sin(frame.time * 53) * shake * 0.12;
    this.camera.lookAt(0, 0, 0);
    this.bloomPass.strength = frame.state?.bossActive ? 1.02 : 0.78;
    this.renderer.toneMappingExposure = 0.82 + clamp(Number(frame.state?.flash) || 0, 0, 0.28);
    this.composer.render();
  }

  mountShipPreview(canvas, ship) {
    const existing = this.previewRecords.get(canvas);
    if (existing) existing.stopped = true;
    const record = { stopped: false };
    this.previewRecords.set(canvas, record);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 5.2, 7.5);
    camera.lookAt(0, 0, 0);
    scene.add(new THREE.HemisphereLight(0xbdefff, 0x190820, 2.3));
    const key = new THREE.DirectionalLight(0xffffff, 4);
    key.position.set(-4, 7, 5);
    scene.add(key);
    const rim = new THREE.PointLight(colorFrom(ship.color), 18, 20);
    rim.position.set(4, 2, -3);
    scene.add(rim);
    const model = buildDetailedShip(ship, false);
    model.rotation.x = -0.12;
    scene.add(model);
    const platform = new THREE.Mesh(
      new THREE.TorusGeometry(2.7, 0.035, 8, 96),
      emissive(ship.color, 2.5, 0.6),
    );
    platform.rotation.x = Math.PI / 2;
    platform.position.y = -1.15;
    scene.add(platform);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTexture, color: colorFrom(ship.color), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.position.set(0, -0.7, 0);
    glow.scale.set(7, 7, 1);
    scene.add(glow);

    const paint = (now) => {
      if (record.stopped || !canvas.isConnected) {
        renderer.dispose();
        return;
      }
      const width = Math.max(1, canvas.clientWidth || 320);
      const height = Math.max(1, canvas.clientHeight || 240);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      model.rotation.y = now * 0.00052;
      platform.rotation.z = -now * 0.00022;
      model.traverse((child) => {
        if (child.userData.engineGlow) {
          const pulse = 0.9 + Math.sin(now * 0.009 + child.position.x) * 0.16;
          child.scale.copy(child.userData.baseScale).multiplyScalar(pulse);
        }
      });
      renderer.render(scene, camera);
      requestAnimationFrame(paint);
    };
    requestAnimationFrame(paint);
  }
}
