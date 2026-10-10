// Salão do Posto Zero: texturas procedurais (sem arquivos), pilares e os portais de 4 lugares.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { PORTALS, PORTAL_RADIUS, PORTAL_SLOTS } from '@backrooms/shared/lobby.js';

export const HALL = { halfX: 18, halfZ: 14, height: 3.4 };
export const PILLARS = [
  { x: -10, z: 2 },
  { x: 10, z: 2 },
  { x: -10, z: -4 },
  { x: 10, z: -4 },
];
export const PILLAR_RADIUS = 0.55;
const LEVEL_NAMES = { backrooms: 'NÍVEL 0 · BACKROOMS' };

// Textura de canvas com ruído determinístico, para não piscar entre recargas.
function canvasTexture(size, draw, repeatX, repeatY) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  draw(canvas.getContext('2d'), size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
function noise(ctx, size, amount, seed) {
  const image = ctx.getImageData(0, 0, size, size),
    d = image.data;
  let n = seed;
  for (let i = 0; i < d.length; i += 4) {
    n = (n * 1664525 + 1013904223) >>> 0;
    const v = ((n >>> 24) / 255 - 0.5) * amount;
    d[i] += v;
    d[i + 1] += v;
    d[i + 2] += v * 0.7;
  }
  ctx.putImageData(image, 0, 0);
}
export const carpet = () =>
  canvasTexture(
    256,
    (ctx, s) => {
      ctx.fillStyle = '#9a8a4e';
      ctx.fillRect(0, 0, s, s);
      noise(ctx, s, 46, 7);
      ctx.fillStyle = 'rgb(70 60 25 / 9%)';
      for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        ctx.ellipse((i * 97) % s, (i * 53) % s, 14 + i * 3, 9, i, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    9,
    7,
  );
export const wallpaper = () =>
  canvasTexture(
    256,
    (ctx, s) => {
      ctx.fillStyle = '#cdbb6a';
      ctx.fillRect(0, 0, s, s);
      ctx.strokeStyle = 'rgb(120 100 40 / 35%)';
      ctx.lineWidth = 2;
      for (let x = 0; x < s; x += 32) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, s);
        ctx.stroke();
        for (let y = 0; y < s; y += 32) {
          ctx.beginPath();
          ctx.moveTo(x + 8, y + 16);
          ctx.lineTo(x + 16, y + 8);
          ctx.lineTo(x + 24, y + 16);
          ctx.stroke();
        }
      }
      noise(ctx, s, 24, 3);
    },
    10,
    1.2,
  );
export const ceilingTiles = () =>
  canvasTexture(
    128,
    (ctx, s) => {
      ctx.fillStyle = '#d9d3b8';
      ctx.fillRect(0, 0, s, s);
      noise(ctx, s, 18, 11);
      ctx.strokeStyle = '#8f8a74';
      ctx.lineWidth = 3;
      ctx.strokeRect(0, 0, s, s);
    },
    18,
    14,
  );

function buildHall(scene) {
  const { halfX, halfZ, height } = HALL;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(halfX * 2, halfZ * 2),
    new THREE.MeshLambertMaterial({ map: carpet() }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(halfX * 2, halfZ * 2),
    new THREE.MeshLambertMaterial({ map: ceilingTiles() }),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = height;
  scene.add(ceiling);
  const wallMaterial = new THREE.MeshLambertMaterial({ map: wallpaper() });
  for (const [w, x, z, ry] of [
    [halfX * 2, 0, -halfZ, 0],
    [halfX * 2, 0, halfZ, Math.PI],
    [halfZ * 2, -halfX, 0, Math.PI / 2],
    [halfZ * 2, halfX, 0, -Math.PI / 2],
  ]) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(w, height), wallMaterial);
    wall.position.set(x, height / 2, z);
    wall.rotation.y = ry;
    scene.add(wall);
  }
  // Luminárias fluorescentes: painéis emissivos em grade (uma única malha instanciada).
  const panel = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1.2, 0.6),
    new THREE.MeshBasicMaterial({ color: 0xfff7d6 }),
    48,
  );
  const m = new THREE.Matrix4(),
    q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  let i = 0;
  for (let x = -15; x <= 15; x += 6)
    for (let z = -12; z <= 12; z += 4.8)
      if (i < 48)
        panel.setMatrixAt(
          i++,
          m.compose(new THREE.Vector3(x, height - 0.01, z), q, new THREE.Vector3(1, 1, 1)),
        );
  panel.count = i;
  scene.add(panel);
  const pillarGeo = new THREE.BoxGeometry(PILLAR_RADIUS * 2, height, PILLAR_RADIUS * 2);
  for (const p of PILLARS) {
    const pillar = new THREE.Mesh(pillarGeo, wallMaterial);
    pillar.position.set(p.x, height / 2, p.z);
    scene.add(pillar);
  }
  scene.add(new THREE.HemisphereLight(0xfff1c2, 0x5a4a1c, 2.4));
  scene.fog = new THREE.Fog(0xb8a866, 14, 42);
  scene.background = new THREE.Color(0xb8a866);
}

class Portal {
  constructor(scene, def) {
    this.def = def;
    this.group = new THREE.Group();
    this.group.position.set(def.x, 0, def.z);
    scene.add(this.group);
    this.pad = new THREE.Mesh(
      new THREE.CylinderGeometry(PORTAL_RADIUS, PORTAL_RADIUS, 0.08, 40),
      new THREE.MeshBasicMaterial({ color: 0x2aa6b8, transparent: true, opacity: 0.55 }),
    );
    this.pad.position.y = 0.04;
    this.group.add(this.pad);
    // Arco atrás da plataforma, com o "véu" que gira mais rápido durante a contagem.
    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.25, 0.12, 12, 48),
      new THREE.MeshBasicMaterial({ color: 0x67e3f2 }),
    );
    this.ring.position.set(0, 1.55, -2.1);
    this.group.add(this.ring);
    this.veil = new THREE.Mesh(
      new THREE.CircleGeometry(1.15, 40),
      new THREE.MeshBasicMaterial({
        color: 0x67e3f2,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
      }),
    );
    this.veil.position.copy(this.ring.position);
    this.group.add(this.veil);
    this.slots = [];
    for (let i = 0; i < PORTAL_SLOTS; i++) {
      const a = (i / PORTAL_SLOTS) * Math.PI * 2 + Math.PI / 4,
        light = new THREE.Mesh(
          new THREE.BoxGeometry(0.22, 0.12, 0.22),
          new THREE.MeshBasicMaterial({ color: 0x3a3a3a }),
        );
      light.position.set(
        Math.cos(a) * (PORTAL_RADIUS - 0.2),
        0.12,
        Math.sin(a) * (PORTAL_RADIUS - 0.2),
      );
      this.group.add(light);
      this.slots.push(light);
    }
    const tag = document.createElement('div');
    tag.className = 'portalTag';
    this.tagEl = tag;
    this.label = new CSS2DObject(tag);
    this.label.position.set(0, 3.05, -2.1);
    this.group.add(this.label);
    this.state = { slots: Array(PORTAL_SLOTS).fill(null), endsAt: 0, owner: null, target: null };
    this.render(0);
  }

  set(state, serverOffset) {
    this.state = state;
    this.serverOffset = serverOffset;
  }

  render(now, selfId) {
    const { slots, endsAt, target } = this.state,
      count = slots.filter(Boolean).length,
      left = endsAt
        ? Math.max(0, Math.ceil((endsAt - (now + (this.serverOffset || 0))) / 1000))
        : 0;
    slots.forEach((id, i) =>
      this.slots[i].material.color.set(id === selfId ? 0xe8c547 : id ? 0x67e3f2 : 0x3a3a3a),
    );
    const status = left
      ? `parte em <b>${left}s</b>`
      : target && count
        ? `time de ${target} · falta${target - count > 1 ? 'm' : ''} <b>${target - count}</b>`
        : 'pise na plataforma';
    const html = `${LEVEL_NAMES[this.def.level] || this.def.level}<br><b>${count}/${PORTAL_SLOTS}</b> · ${status}`;
    if (html !== this.lastHtml) this.tagEl.innerHTML = this.lastHtml = html;
    const speed = endsAt ? 4 : 1;
    this.ring.rotation.z += 0.01 * speed;
    this.veil.material.opacity = 0.3 + Math.sin(now / (endsAt ? 120 : 600)) * 0.12;
  }
}

export function buildLobby(scene) {
  buildHall(scene);
  return PORTALS.map(def => new Portal(scene, def));
}
