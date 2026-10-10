// Boneco em blocos (estilo Roblox R6) com animação procedural: andar, correr, pular e emotes.
// Fica de frente para +Z; o braço direito (lado -X) já tem o "canhão" do Braço-Arma.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const SKIN = 0xe8c39e,
  PANTS = 0x2f3340,
  METAL = 0x7d848c,
  box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const geometry = {
  leg: box(0.32, 0.8, 0.32).translate(0, -0.4, 0),
  arm: box(0.28, 0.72, 0.28).translate(0, -0.36, 0),
  torso: box(0.72, 0.75, 0.38),
  head: box(0.5, 0.5, 0.5),
  eye: box(0.07, 0.1, 0.02),
  cannon: box(0.34, 0.26, 0.34).translate(0, -0.78, 0),
};
const shared = {
  skin: new THREE.MeshLambertMaterial({ color: SKIN }),
  pants: new THREE.MeshLambertMaterial({ color: PANTS }),
  metal: new THREE.MeshLambertMaterial({ color: METAL }),
  eye: new THREE.MeshBasicMaterial({ color: 0x1b1b1b }),
};

export class Avatar {
  constructor({ name, color, self = false }) {
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    const shirt = new THREE.MeshLambertMaterial({ color: new THREE.Color(color) }),
      glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(color) });
    this.shirt = shirt;
    const part = (geo, mat, x, y, z, parent = this.body) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = false;
      parent.add(mesh);
      return mesh;
    };
    this.torso = part(geometry.torso, shirt, 0, 1.175, 0);
    this.head = part(geometry.head, shared.skin, 0, 1.8, 0);
    part(geometry.eye, shared.eye, 0.11, 0.05, 0.26, this.head);
    part(geometry.eye, shared.eye, -0.11, 0.05, 0.26, this.head);
    this.legL = part(geometry.leg, shared.pants, 0.17, 0.8, 0);
    this.legR = part(geometry.leg, shared.pants, -0.17, 0.8, 0);
    this.armL = part(geometry.arm, shared.skin, 0.5, 1.5, 0);
    this.armR = part(geometry.arm, shared.metal, -0.5, 1.5, 0);
    part(geometry.cannon, glow, 0, 0, 0, this.armR);
    // Partes clicáveis apontam para o boneco (convite para grupo).
    this.root.traverse(o => (o.userData.avatar = this));

    const tag = document.createElement('div');
    tag.className = 'tag';
    this.nameEl = document.createElement('span');
    this.nameEl.textContent = self ? `${name} (você)` : name;
    this.bubbleEl = document.createElement('span');
    this.bubbleEl.className = 'bubble';
    this.bubbleEl.hidden = true;
    tag.append(this.bubbleEl, this.nameEl);
    this.label = new CSS2DObject(tag);
    this.label.position.set(0, 2.35, 0);
    this.root.add(this.label);

    this.phase = 0;
    this.time = 0;
    this.airY = 0;
    this.bubbleUntil = 0;
  }

  setColor(color) {
    this.shirt.color.set(color);
  }

  setParty(inParty) {
    this.nameEl.style.color = inParty ? '#e8c547' : '';
  }

  say(text, now) {
    this.bubbleEl.textContent = text;
    this.bubbleEl.hidden = false;
    this.bubbleUntil = now + 5000;
  }

  /** speed em m/s no chão; anim do servidor ou local; emote ativo ou null; jumpY altura do pulo. */
  update(dt, { speed, anim, emote, jumpY = 0 }, now) {
    this.time += dt;
    if (this.bubbleUntil && now > this.bubbleUntil) {
      this.bubbleEl.hidden = true;
      this.bubbleUntil = 0;
    }
    const t = this.time,
      moving = speed > 0.2,
      swing = Math.min(1, speed / 4) * (anim === 'run' ? 1.1 : 0.8);
    this.phase += speed * dt * 2.4;
    const s = Math.sin(this.phase);
    // Pernas e braços em oposição; parado, respiração leve.
    let legL = s * swing,
      armL = -s * swing * 0.9,
      armR = s * swing * 0.9,
      armLz = 0,
      armRz = 0,
      bob = moving ? Math.abs(Math.cos(this.phase)) * 0.06 * swing : Math.sin(t * 2) * 0.012,
      sway = 0;
    if (!moving) {
      legL = 0;
      armL = Math.sin(t * 2) * 0.04;
      armR = -armL;
    }
    if (anim === 'jump' || jumpY > 0.05) {
      legL = 0.5;
      armLz = 0.5;
      armRz = -0.5;
      armL = armR = -0.3;
    }
    if (emote === 'wave') {
      armRz = -2.7 + Math.sin(t * 12) * 0.35;
      armR = 0;
    } else if (emote === 'point') {
      armR = -Math.PI / 2;
      armRz = 0;
    } else if (emote === 'dance') {
      const d = Math.sin(t * 8);
      armLz = 1.4 + d * 0.8;
      armRz = -1.4 + d * 0.8;
      armL = armR = 0;
      bob = Math.abs(d) * 0.12;
      sway = d * 0.25;
      legL = d * 0.3;
    }
    this.legL.rotation.x = legL;
    this.legR.rotation.x = anim === 'jump' || jumpY > 0.05 ? -0.2 : -legL;
    this.armL.rotation.set(armL, 0, armLz);
    this.armR.rotation.set(armR, 0, armRz);
    this.body.position.y = bob + jumpY;
    this.body.rotation.y = sway;
  }

  dispose() {
    this.label.element.remove();
    this.root.removeFromParent();
    this.shirt.dispose();
  }
}
