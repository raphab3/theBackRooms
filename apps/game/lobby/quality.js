// Qualidade gráfica: presets (baixo/médio/alto) escolhidos pelo FPS medido, resolução dinâmica e
// pós-processamento (brilho nas luminárias, vinheta, granulado VHS). Usado pelo lobby e pela expedição.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const KEY = 'backrooms.quality',
  MEASURE_MS = 5000,
  SLOW_FRAME_MS = 20,
  FAST_FRAME_MS = 12,
  RESIZE_COOLDOWN_MS = 10000; // recriar os alvos do pós-processamento também custa um quadro
export const PRESETS = {
  low: { label: 'Baixa', ratio: 0.75, bloom: false, film: false },
  medium: { label: 'Média', ratio: 1, bloom: false, film: true },
  high: { label: 'Alta', ratio: 1.75, bloom: true, film: true },
};

// Vinheta e granulado de fita VHS num único passe.
const FilmShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, grain: { value: 0.06 } },
  vertexShader: `varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float time; uniform float grain; varying vec2 vUv;
    float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      float noise = rand(vUv * vec2(1920.0, 1080.0) + time) - 0.5;
      float vignette = smoothstep(0.85, 0.25, distance(vUv, vec2(0.5)));
      color.rgb = (color.rgb + noise * grain) * mix(0.55, 1.0, vignette);
      gl_FragColor = color;
    }`,
};

export function readQualityChoice() {
  try {
    const saved = localStorage.getItem(KEY);
    return saved in PRESETS ? saved : 'auto';
  } catch {
    return 'auto';
  }
}

export function createPipeline(renderer, scene, camera) {
  const composer = new EffectComposer(renderer),
    bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.4, 0.82),
    film = new ShaderPass(FilmShader);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(bloom);
  composer.addPass(film);
  composer.addPass(new OutputPass());

  const choice = readQualityChoice();
  let preset = choice === 'auto' ? 'medium' : choice,
    ratio = 1,
    measuring = choice === 'auto',
    measureStart = 0,
    frames = 0,
    slowFor = 0,
    fastFor = 0,
    resizedAt = 0;

  function apply(name) {
    preset = name;
    const p = PRESETS[name];
    ratio = Math.min(devicePixelRatio, p.ratio);
    bloom.enabled = p.bloom;
    film.enabled = p.film;
    resize();
  }
  function resize() {
    renderer.setPixelRatio(ratio);
    renderer.setSize(innerWidth, innerHeight);
    composer.setPixelRatio(ratio);
    composer.setSize(innerWidth, innerHeight);
  }
  apply(preset);

  return {
    get preset() {
      return preset;
    },
    get ratio() {
      return ratio;
    },
    resize,
    /**
     * Compila agora os shaders da cena e de todos os passes, para a primeira aparição de algo (ou a
     * troca automática de qualidade) não travar um quadro inteiro no meio do jogo.
     */
    warm({ passes = true } = {}) {
      renderer.compile(scene, camera);
      if (!passes) return;
      const was = [bloom.enabled, film.enabled];
      bloom.enabled = film.enabled = true;
      composer.render();
      [bloom.enabled, film.enabled] = was;
    },
    /** Troca manual (ou volta para "auto") e lembra no aparelho. */
    choose(name) {
      try {
        localStorage.setItem(KEY, name);
      } catch {}
      measuring = name === 'auto';
      measureStart = 0;
      apply(name === 'auto' ? 'medium' : name);
    },
    render(dtMs, now) {
      // Nos primeiros 5 s mede o FPS e escolhe o preset que o aparelho aguenta.
      if (measuring) {
        // Aba oculta pausa os quadros: uma pausa longa recomeça a medição em vez de derrubar o preset.
        if (!measureStart || dtMs > 250) {
          measureStart = now;
          frames = 0;
        }
        frames++;
        if (now - measureStart >= MEASURE_MS) {
          const fps = (frames * 1000) / (now - measureStart);
          measuring = false;
          apply(fps >= 55 ? 'high' : fps >= 40 ? 'medium' : 'low');
          console.info(`[qualidade] ${fps.toFixed(0)} fps medidos → ${preset}`);
        }
      } else {
        // Resolução dinâmica: quadro lento por 2 s baixa 10%; folga por 5 s sobe de volta.
        slowFor = dtMs > SLOW_FRAME_MS ? slowFor + dtMs : 0;
        fastFor = dtMs < FAST_FRAME_MS ? fastFor + dtMs : 0;
        const max = Math.min(devicePixelRatio, PRESETS[preset].ratio);
        const canResize = now - resizedAt > RESIZE_COOLDOWN_MS;
        if (canResize && slowFor > 2000 && ratio > 0.5) {
          ratio = Math.max(0.5, ratio * 0.9);
          slowFor = 0;
          resizedAt = now;
          resize();
        } else if (canResize && fastFor > 5000 && ratio < max) {
          ratio = Math.min(max, ratio / 0.9);
          fastFor = 0;
          resizedAt = now;
          resize();
        }
      }
      film.uniforms.time.value = now / 1000;
      if (bloom.enabled || film.enabled) composer.render();
      else renderer.render(scene, camera);
    },
  };
}

/** Seletor de qualidade (Auto/Baixa/Média/Alta) num <select> já existente na página. */
export function bindQualitySelect(select, pipeline) {
  select.value = readQualityChoice();
  select.onchange = () => pipeline.choose(select.value);
}
