// Cinematic post-processing chain (TSL): HDR scene -> motion blur -> sun shafts ->
// depth of field -> bloom -> grading (exposure/flash/saturation/vignette/grain) -> tonemap -> AA.
import * as THREE from 'three/webgpu';
import { sstep } from './tsl';
import {
  pass,
  mrt,
  output,
  velocity,
  uniform,
  vec2,
  vec3,
  vec4,
  float,
  Fn,
  uv,
  mix,
  smoothstep,
  saturate,
  dot,
  length,
  max,
  pow,
  renderOutput,
  convertToTexture,
  Loop,
  int,
  interleavedGradientNoise,
  screenCoordinate,
  fract,
  sin,
  clamp,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { motionBlur } from 'three/addons/tsl/display/MotionBlur.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import type { QualitySettings } from './quality';
import { U } from './env';

export class PostFX {
  readonly pipeline: THREE.RenderPipeline;
  readonly exposure = uniform(1.0);
  readonly flash = uniform(0.0); // additive white
  readonly whiteout = uniform(0.0); // full-screen white (final strike)
  readonly saturation = uniform(1.08);
  readonly contrast = uniform(1.06);
  readonly tint = uniform(new THREE.Color(1, 1, 1));
  readonly vignette = uniform(0.22);
  readonly ca = uniform(0.0);
  readonly grain = uniform(0.035);
  readonly bloomStrength = uniform(0.4);
  readonly dofFocus = uniform(12.0);
  readonly dofRange = uniform(18.0);
  readonly dofBokeh = uniform(2.0);
  readonly dofMix = uniform(0.0);
  readonly mbStrength = uniform(0.6);
  readonly shaftStrength = uniform(0.35);
  readonly shaftCenter = uniform(new THREE.Vector2(0.5, 0.3));
  readonly shaftColor = uniform(new THREE.Color(1.0, 0.85, 0.6));
  readonly desat = uniform(0.0); // hit-stop / dramatic desaturation
  readonly radialBlur = uniform(0.0);
  readonly radialCenter = uniform(new THREE.Vector2(0.5, 0.5));

  constructor(
    renderer: THREE.WebGPURenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    q: QualitySettings,
  ) {
    const pipeline = new THREE.RenderPipeline(renderer);
    this.pipeline = pipeline;
    const scenePass = pass(scene, camera, { samples: q.msaa } as any);
    if (q.motionBlur) scenePass.setMRT(mrt({ output, velocity }));
    const sceneColor = scenePass.getTextureNode('output');
    const depth = scenePass.getTextureNode('depth');
    const viewZ = scenePass.getViewZNode();

    let color: any = sceneColor;
    if (q.motionBlur) {
      const vel = scenePass.getTextureNode('velocity').mul(this.mbStrength);
      color = motionBlur(sceneColor, vel, int(10));
    }

    // Sun / portal light shafts: radial blur of a sky-only brightness mask.
    if (q.shafts) {
      const mask = Fn(() => {
        const d = depth.sample(uv()).x;
        const isSky = smoothstep(0.99995, 1.0, d);
        const c = sceneColor.sample(uv()).rgb;
        const lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
        const aspect = float(16 / 9);
        const off = uv().sub(this.shaftCenter).mul(vec2(aspect, 1));
        const near = sstep(0.55, 0.0, length(off));
        return vec4(c.mul(isSky).mul(smoothstep(0.6, 3.0, lum)).mul(near), 1);
      })();
      const maskTex = convertToTexture(mask);
      (maskTex as any).setResolutionScale?.(0.5);
      const shafts = Fn(() => {
        const suv = uv().toVar();
        const center = this.shaftCenter;
        const count = 40;
        const delta = center.sub(suv).div(count).mul(0.92);
        const acc = vec3(0).toVar();
        const w = float(1).toVar();
        const noise = interleavedGradientNoise(screenCoordinate);
        suv.addAssign(delta.mul(noise));
        Loop({ start: int(0), end: int(count), type: 'int', condition: '<' }, () => {
          suv.addAssign(delta);
          acc.addAssign(maskTex.sample(suv).rgb.mul(w));
          w.mulAssign(0.965);
        });
        return acc.div(count).mul(this.shaftStrength).mul(this.shaftColor).mul(3.0);
      })();
      color = color.add(vec4(shafts, 0));
    }

    if (q.dof) {
      const focal = this.dofRange;
      const sharp = color;
      const blurred: any = dof(color, viewZ, this.dofFocus, focal, this.dofBokeh);
      color = mix(sharp, blurred, this.dofMix);
    }

    if (q.bloom) {
      const b = bloom(sceneColor, 1, 0.45, 2.2);
      b.strength = this.bloomStrength as any;
      color = color.add(b);
    }

    const graded = Fn(() => {
      const c0 = color.toVar();
      let c: any = c0.rgb.mul(this.exposure);
      c = c.add(vec3(this.flash).mul(U.flashColor));
      // Saturation / contrast in log-ish space.
      const l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, this.saturation.mul(float(1).sub(this.desat)));
      c = c.mul(this.tint);
      const mid = float(0.18);
      c = pow(max(c.div(mid), vec3(0.0)), vec3(this.contrast)).mul(mid);
      return vec4(c, 1);
    })();

    let out: any = renderOutput(graded);

    const dbgF = new URLSearchParams(location.search).get('pf');
    const src: any = convertToTexture(out);
    const finalFn = Fn(() => {
      const p = uv();
      const cen = p.sub(0.5);
      const r = length(cen);
      // Chromatic aberration + radial blur (impacts, speed).
      const caOff = cen.mul(this.ca.mul(r).mul(0.04));
      const cR = src.sample(p.add(caOff)).r;
      const cG = src.sample(p).g;
      const cB = src.sample(p.sub(caOff)).b;
      const c: any = vec3(cR, cG, cB).toVar();
      const rb = this.radialBlur;
      const dir = p.sub(this.radialCenter);
      const acc = vec3(0).toVar();
      Loop({ start: int(1), end: int(9), type: 'int', condition: '<' }, ({ i }: any) => {
        const s = float(i).mul(rb).mul(0.012);
        acc.addAssign(src.sample(p.sub(dir.mul(s))).rgb);
      });
      if (dbgF !== 'a') c.assign(mix(c, acc.div(8.0), saturate(rb.mul(3.0))));
      // Vignette.
      const vig = float(1).sub(smoothstep(0.35, 0.95, r.mul(float(1).add(this.vignette))));
      if (dbgF !== 'b') c.mulAssign(mix(float(1), vig, this.vignette.mul(2.0).clamp(0, 1)));
      // Film grain.
      const gseed = dot(screenCoordinate.xy, vec2(12.9898, 78.233)).add(fract(U.time.mul(13.37)).mul(100.0));
      const g = fract(sin(gseed).mul(43758.5453)).sub(0.5);
      if (dbgF !== 'c') c.addAssign(vec3(g.mul(this.grain)));
      // Whiteout.
      c.assign(mix(c, vec3(1.0, 0.99, 0.97), clamp(this.whiteout, 0, 1)));
      return vec4(c, 1);
    });
    out = finalFn();
    if (q.msaa === 0) out = fxaa(out);

    const dbg = new URLSearchParams(location.search).get('pdbg');
    pipeline.outputColorTransform = false;
    pipeline.outputNode = out;
    if (dbg === '0') pipeline.outputNode = renderOutput(sceneColor);
    if (dbg === '1') pipeline.outputNode = renderOutput(color);
    if (dbg === '2') pipeline.outputNode = renderOutput(graded);
    void velocity;
  }

  render() {
    this.pipeline.render();
  }
}
