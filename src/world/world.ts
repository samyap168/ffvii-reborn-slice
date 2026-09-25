// Assembles the open world: heightfield, terrain, sky, lights, fog and all dressing.
import * as THREE from 'three/webgpu';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import { Heightfield } from './heightfield';
import { Terrain, makeTerrainTextures, makeFarMountains, type TerrainTextures } from './terrain';
import { makeSky, makeFogNode } from './sky';
import { GrassField } from './grass';
import { Vegetation } from './vegetation';
import { Water } from './water';
import { Ruins } from './ruins';
import { U, PRESET_DAY, type SkyPreset } from '../core/env';
import type { QualitySettings } from '../core/quality';

export class World {
  readonly hf = new Heightfield();
  readonly group = new THREE.Group();
  terrain!: Terrain;
  tex!: TerrainTextures;
  sun!: THREE.DirectionalLight;
  hemi!: THREE.HemisphereLight;
  csm: CSMShadowNode | null = null;
  sky!: THREE.Mesh;
  grass!: GrassField;
  veg!: Vegetation;
  water!: Water;
  ruins!: Ruins;
  preset: SkyPreset = { ...PRESET_DAY };
  readonly updaters: ((dt: number, t: number, cam: THREE.Camera) => void)[] = [];
  private envDirty = true;
  private envTimer = 0;
  private pmrem: THREE.PMREMGenerator | null = null;
  private envScene = new THREE.Scene();
  private envRT: THREE.RenderTarget | null = null;

  constructor(
    public scene: THREE.Scene,
    public q: QualitySettings,
  ) {}

  async build(renderer: THREE.WebGPURenderer, camera: THREE.PerspectiveCamera, progress: (p: number, label: string) => void) {
    progress(0.02, 'Shaping the land');
    await tick();
    this.hf.generate((p) => progress(0.02 + p * 0.3, 'Shaping the land'));
    await tick();
    this.tex = makeTerrainTextures(this.hf);
    this.terrain = new Terrain(this.hf, this.tex, { n: this.q.terrainN, rings: this.q.terrainRings });
    this.group.add(this.terrain.mesh);
    this.group.add(makeFarMountains(this.hf.noise));

    this.grass = new GrassField(this.terrain, this.q.grassDensity, this.q.grassRadius);
    this.group.add(this.grass.group);

    progress(0.36, 'Growing the wilds');
    await tick();
    this.veg = new Vegetation(this.hf, this.q.treeCount);
    this.group.add(this.veg.group);
    this.veg.update(0, camera.position, true);

    this.water = new Water((a) => this.hf.lakeRadius(a));
    this.ruins = new Ruins(this.hf);
    this.group.add(this.ruins.group);
    this.group.add(this.water.group);

    this.sky = makeSky();
    this.group.add(this.sky);
    this.scene.fogNode = makeFogNode();

    // Lights.
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(this.q.shadowMapSize, this.q.shadowMapSize);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    const cam = this.sun.shadow.camera as THREE.OrthographicCamera;
    cam.near = 1;
    cam.far = 2000;
    const csm = new CSMShadowNode(this.sun, {
      cascades: this.q.shadowCascades,
      maxFar: this.q.shadowFar,
      mode: 'practical',
      lightMargin: 300,
    } as any);
    csm.fade = true;
    this.sun.shadow.shadowNode = csm as any;
    this.csm = csm;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0x9ec3ff, 0x5a4a32, 0.6);
    this.scene.add(this.hemi);

    this.scene.add(this.group);
    this.applyPreset(this.preset);

    // Environment map from a sky-only scene.
    this.pmrem = new THREE.PMREMGenerator(renderer);
    const envSky = makeSky();
    envSky.onBeforeRender = () => {};
    envSky.scale.setScalar(0.01);
    this.envScene.add(envSky);
    this.updateEnvironment();
    progress(0.4, 'Growing the wilds');
    void camera;
  }

  applyPreset(p: SkyPreset) {
    this.preset = p;
    const dir = new THREE.Vector3(Math.cos(p.sunAzim) * Math.cos(p.sunElev), Math.sin(p.sunElev), Math.sin(p.sunAzim) * Math.cos(p.sunElev));
    U.sunDir.value.copy(dir);
    U.sunColor.value.setRGB(...p.sunColor);
    U.sunIntensity.value = p.sunIntensity;
    U.zenith.value.setRGB(...p.zenith);
    U.horizon.value.setRGB(...p.horizon);
    U.fogColor.value.setRGB(...p.fog);
    U.fogDensity.value = p.fogDensity;
    U.cloudCover.value = p.cloudCover;
    this.sun.color.setRGB(...p.sunColor);
    this.sun.intensity = p.sunIntensity;
    this.hemi.color.setRGB(p.zenith[0] * 0.6 + p.horizon[0] * 0.4, p.zenith[1] * 0.6 + p.horizon[1] * 0.4, p.zenith[2] * 0.6 + p.horizon[2] * 0.4);
    this.hemi.groundColor.setRGB(0.3 * p.ambient, 0.25 * p.ambient, 0.17 * p.ambient);
    this.hemi.intensity = 0.9 * p.ambient;
    this.scene.environmentIntensity = 0.55 * p.ambient;
  }

  markEnvDirty() {
    this.envDirty = true;
  }

  updateEnvironment() {
    if (!this.pmrem) return;
    const prev = this.envRT;
    this.envRT = this.pmrem.fromScene(this.envScene, 0.02, 0.1, 1000) as any;
    this.scene.environment = this.envRT!.texture;
    prev?.dispose();
    this.envDirty = false;
  }

  update(dt: number, t: number, camera: THREE.PerspectiveCamera) {
    this.terrain.update(camera.position);
    this.grass.update(camera.position);
    this.veg.update(dt, camera.position);
    this.ruins.update(dt, t);
    // Sun follows the camera so shadow cascades are always centered.
    const d = U.sunDir.value;
    this.sun.position.copy(camera.position).addScaledVector(d, 600);
    this.sun.target.position.copy(camera.position);
    this.sun.target.updateMatrixWorld();
    for (const u of this.updaters) u(dt, t, camera);
    this.envTimer -= dt;
    if (this.envDirty && this.envTimer <= 0) {
      this.updateEnvironment();
      this.envTimer = 0.35;
    }
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));
