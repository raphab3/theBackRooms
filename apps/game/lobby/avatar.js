// Personagem do lobby: modelo Kenney Blocky Characters (CC0) com as animações do pacote,
// misturadas pela velocidade (idle ↔ walk ↔ sprint). Fica de frente para +Z; o braço direito
// (lado -X) leva o "canhão" do Braço-Arma na cor do jogador.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const HEIGHT = 1.8, // metros
  FADE = 0.2,
  WALK_CLIP_SPEED = 2.2, // m/s em que a animação walk do pacote não "patina"
  SPRINT_CLIP_SPEED = 5.5,
  EMOTE_CLIPS = { wave: 'interact-right', point: 'holding-right-shoot', dance: 'emote-yes' };
const loader = new GLTFLoader(),
  models = new Map(); // skin → Promise<{scene, animations, scale}>

function loadSkin(skin) {
  if (!models.has(skin))
    models.set(
      skin,
      loader.loadAsync(`/models/characters/character-${skin}.glb`).then(gltf => {
        const size = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3());
        return { scene: gltf.scene, animations: gltf.animations, scale: HEIGHT / size.y };
      }),
    );
  return models.get(skin);
}

export class Avatar {
  constructor({ name, color, skin = 'a', self = false }) {
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.color = color;
    this.actions = {};
    this.current = null;
    this.time = 0;
    this.bubbleUntil = 0;

    const tag = document.createElement('div');
    tag.className = 'tag';
    tag.style.borderBottom = `2px solid ${color}`;
    this.nameEl = document.createElement('span');
    this.nameEl.textContent = self ? `${name} (você)` : name;
    this.bubbleEl = document.createElement('span');
    this.bubbleEl.className = 'bubble';
    this.bubbleEl.hidden = true;
    tag.append(this.bubbleEl, this.nameEl);
    this.label = new CSS2DObject(tag);
    this.label.position.set(0, HEIGHT + 0.45, 0);
    this.root.add(this.label);

    this.ready = loadSkin(skin).then(model => this.attach(model));
  }

  attach({ scene, animations, scale }) {
    if (this.disposed) return;
    const model = scene.clone(true);
    model.scale.setScalar(scale);
    this.body.add(model);
    // Canhão do Braço-Arma na ponta do braço direito, brilhando na cor do jogador.
    const arm = model.getObjectByName('arm-right');
    if (arm) {
      this.glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(this.color) });
      const cannon = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.22), this.glow);
      cannon.position.set(0, -0.5, 0);
      arm.add(cannon);
    }
    // Partes clicáveis apontam para o boneco (convite para grupo).
    model.traverse(o => (o.userData.avatar = this));
    this.mixer = new THREE.AnimationMixer(model);
    for (const clip of animations) this.actions[clip.name] = this.mixer.clipAction(clip);
    // Cair toca uma vez e fica no chão.
    this.actions.die?.setLoop(THREE.LoopOnce, 1);
    if (this.actions.die) this.actions.die.clampWhenFinished = true;
    this.play('idle');
  }

  play(name, timeScale = 1) {
    const action = this.actions[name];
    if (!action) return;
    action.timeScale = timeScale;
    if (this.current === action) return;
    action.reset().fadeIn(FADE).play();
    this.current?.fadeOut(FADE);
    this.current = action;
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
    if (anim === 'down') this.play('die');
    else if (emote && EMOTE_CLIPS[emote]) this.play(EMOTE_CLIPS[emote]);
    else if (anim === 'run' || speed > 4.2)
      this.play('sprint', Math.max(0.6, speed / SPRINT_CLIP_SPEED));
    else if (speed > 0.2) this.play('walk', Math.max(0.6, speed / WALK_CLIP_SPEED));
    else this.play('idle');
    this.body.position.y = jumpY;
    this.mixer?.update(dt);
  }

  dispose() {
    this.disposed = true;
    this.label.element.remove();
    this.root.removeFromParent();
    this.glow?.dispose();
  }
}

/** Baixa os modelos antes de entrar, para os bonecos não aparecerem atrasados. */
export const preloadSkins = skins => Promise.all(skins.map(loadSkin));
