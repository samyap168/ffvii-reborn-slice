// Water: lake (refraction + depth absorption + shore foam + PBR reflections),
// flowing river ribbons (flow-aligned normals, rapids foam) and the waterfall sheet.
import * as THREE from 'three/webgpu';
import {
  Fn,
  vec2,
  vec3,
  vec4,
  float,
  positionWorld,
  positionView,
  cameraPosition,
  cameraViewMatrix,
  cameraNear,
  cameraFar,
  viewportSharedTexture,
  viewportDepthTexture,
  perspectiveDepthToViewZ,
  screenUV,
  attribute,
  uv,
  mix,
  smoothstep,
  saturate,
  normalize,
  exp,
  dot,
  pow,
  max,
  length,
  mx_noise_float,
  mx_fractal_noise_float,
  sin,
  abs,
  clamp,
} from 'three/tsl';
import { U } from '../core/env';
import { LAKE, STREAM, UPPER_RIVER, streamBedAt, upperBedAt, WATERFALL } from './layout';
import { waterfallSheetY } from './heightfield';
import type { Spline2 } from '../core/math';
import { sstep } from '../core/tsl';

/** Sum of scrolling noise layers -> world-space normal. */
const waveNormal = (p: any, flow: any, strength: any) => {
  const e = 0.35;
  const layer = (scale: number, speed: number, dir: any, amp: number) => {
    const q = p.mul(scale).add(dir.mul(U.time.mul(speed)));
    const n0 = mx_noise_float(vec3(q.x, q.y, U.time.mul(0.08)));
    const nx = mx_noise_float(vec3(q.x.add(e), q.y, U.time.mul(0.08)));
    const nz = mx_noise_float(vec3(q.x, q.y.add(e), U.time.mul(0.08)));
    return vec2(nx.sub(n0), nz.sub(n0)).mul(amp / e);
  };
  const g: any = layer(0.07, 0.3, flow, 0.5)
    .add(layer(0.29, 0.8, flow.mul(0.8).add(vec2(0.3, -0.2)), 0.3))
    .add(layer(1.1, 1.5, flow.mul(0.6).add(vec2(-0.2, 0.25)), 0.16));
  const camDist = length(positionWorld.sub(cameraPosition));
  const s = strength.mul(sstep(700.0, 60.0, camDist).mul(0.8).add(0.2));
  return normalize(vec3(g.x.mul(s).negate(), 1.0, g.y.mul(s).negate()));
};

function waterMaterial(opts: { flowAttr: boolean; deepColor: THREE.Color; foamBoost: number }) {
  const m = new THREE.MeshStandardNodeMaterial({ transparent: true, depthWrite: true });
  m.fog = true;
  const wp = positionWorld;
  const flow: any = opts.flowAttr ? attribute('flow', 'vec2') : U.windDir.mul(0.4);
  const speed = opts.flowAttr ? attribute('speed', 'float') : float(0.4);
  const flowP = opts.flowAttr ? vec2(uv().x.mul(18.0), uv().y.sub(U.time.mul(speed.mul(2.2)))) : wp.xz;
  const nW = waveNormal(flowP, opts.flowAttr ? vec2(0, 0) : flow, opts.flowAttr ? float(0.55).add(speed.mul(0.4)) : float(0.22).add(U.windStrength.mul(0.2)).add(U.storm.mul(0.6)));
  m.normalNode = normalize(cameraViewMatrix.mul(vec4(nW, 0)).xyz);

  // Scene depth behind the water surface.
  const sceneDepth = viewportDepthTexture(screenUV).x;
  const sceneViewZ = perspectiveDepthToViewZ(sceneDepth, cameraNear, cameraFar);
  const thickness = max(positionView.z.sub(sceneViewZ), 0.0);

  const distort = nW.xz.mul(0.035).mul(saturate(thickness.mul(0.4)));
  const refr = viewportSharedTexture(screenUV.add(distort)).rgb;
  const absorb = exp(thickness.mul(vec3(-0.75, -0.26, -0.19)).mul(opts.flowAttr ? 1.6 : 1.0));
  const deep = vec3(opts.deepColor.r, opts.deepColor.g, opts.deepColor.b).mul(U.sunIntensity.mul(0.12).add(0.05));
  const transmitted = mix(deep, refr, absorb);

  // Foam: shore line, rapids, storm chop.
  const foamNoise = mx_fractal_noise_float(vec3(flowP.x.mul(0.8), flowP.y.mul(0.8), U.time.mul(0.3)), 3, 2.0, 0.5).mul(0.5).add(0.5);
  const shore = sstep(0.7, 0.0, thickness).mul(smoothstep(0.35, 0.75, foamNoise.add(sin(thickness.mul(8.0).sub(U.time.mul(2.0))).mul(0.15))));
  const rapids = opts.flowAttr ? smoothstep(0.55, 1.4, speed).mul(smoothstep(0.5, 0.8, foamNoise)) : float(0);
  const chop = U.storm.mul(smoothstep(0.62, 0.8, foamNoise)).mul(0.6);
  const foam = saturate(shore.add(rapids.mul(opts.foamBoost)).add(chop));

  const V = normalize(cameraPosition.sub(wp));
  const fres = pow(float(1).sub(saturate(dot(nW, V))), 5.0).mul(0.95).add(0.02);
  m.colorNode = mix(vec3(0.0, 0.0, 0.0), vec3(0.85, 0.88, 0.9), foam);
  m.roughnessNode = mix(float(0.035), float(0.6), foam);
  m.metalnessNode = float(0);
  m.emissiveNode = transmitted.mul(float(1).sub(fres)).mul(float(1).sub(foam));
  // Fade the ribbon edges into the banks.
  m.opacityNode = float(1);
  if (new URLSearchParams(location.search).has('wdbg')) {
    m.colorNode = vec3(0);
    m.emissiveNode = vec3(thickness.div(10.0).fract(), sceneDepth.mul(1.0), saturate(thickness.div(30.0)));
    m.roughnessNode = float(1);
  }
  void length;
  void abs;
  void clamp;
  return m;
}

function riverRibbon(spline: Spline2, bedAt: (t: number) => number, depth: number, halfWidth: number) {
  const pos: number[] = [];
  const uvs: number[] = [];
  const flow: number[] = [];
  const speed: number[] = [];
  const idx: number[] = [];
  const n = Math.ceil(spline.length / 3);
  let prevY = bedAt(0) + depth;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = spline.at(t);
    const tan = spline.tangent(t);
    const side = { x: -tan.z, z: tan.x };
    const y = bedAt(t) + depth;
    const slope = Math.abs(prevY - y) / 3;
    prevY = y;
    for (const s of [-1, 1]) {
      pos.push(p.x + side.x * halfWidth * s, y, p.z + side.z * halfWidth * s);
      uvs.push((s + 1) / 2, (t * spline.length) / 18);
      flow.push(tan.x, tan.z);
      speed.push(0.35 + Math.min(1.6, slope * 9));
    }
    if (i < n) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('flow', new THREE.Float32BufferAttribute(flow, 2));
  g.setAttribute('speed', new THREE.Float32BufferAttribute(speed, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function waterfallGeometry() {
  const rows = 48,
    cols = 14;
  const pos: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  const zStart = WATERFALL.z - 4;
  const zEnd = WATERFALL.baseZ + 2;
  for (let j = 0; j <= rows; j++) {
    const v = j / rows;
    const z = zStart + (zEnd - zStart) * Math.pow(v, 0.8);
    const y = waterfallSheetY(z) ?? WATERFALL.bottom;
    const width = 11 + 9 * v;
    for (let i = 0; i <= cols; i++) {
      const u = i / cols;
      const x = WATERFALL.x + (u - 0.5) * width;
      // Slight bulge so the sheet is not perfectly flat.
      const bulge = Math.sin(u * Math.PI) * 1.2;
      pos.push(x, y, z + bulge);
      uvs.push(u, v);
    }
  }
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i,
        b = a + 1,
        c = a + cols + 1,
        d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function waterfallMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false });
  const u = uv();
  const streaks = mx_fractal_noise_float(vec3(u.x.mul(26.0), u.y.mul(3.0).sub(U.time.mul(2.4)), U.time.mul(0.2)), 4, 2.0, 0.55).mul(0.5).add(0.5);
  const fine = mx_noise_float(vec3(u.x.mul(80.0), u.y.mul(10.0).sub(U.time.mul(5.0)), 1.0)).mul(0.5).add(0.5);
  const edge = smoothstep(0.0, 0.12, u.x).mul(sstep(1.0, 0.88, u.x));
  const density = saturate(streaks.mul(1.3).add(fine.mul(0.3)).sub(0.25)).mul(edge);
  const foamBottom = smoothstep(0.75, 1.0, u.y);
  m.colorNode = mix(vec3(0.55, 0.66, 0.7), vec3(0.95, 0.97, 1.0), saturate(density.add(foamBottom)));
  m.opacityNode = saturate(density.mul(0.85).add(0.12).add(foamBottom.mul(0.5))).mul(edge);
  m.roughnessNode = float(0.3);
  m.emissiveNode = vec3(0.06, 0.07, 0.08).mul(density).mul(U.sunIntensity);
  return m;
}

export class Water {
  readonly group = new THREE.Group();
  readonly lake: THREE.Mesh;

  constructor(lakeRadius: (angle: number) => number) {
    const shape = new THREE.Shape();
    const segs = 220;
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const r = lakeRadius(a) + 34;
      const x = Math.cos(a) * r,
        z = Math.sin(a) * r;
      if (i === 0) shape.moveTo(x, -z);
      else shape.lineTo(x, -z);
    }
    const lakeGeo = new THREE.ShapeGeometry(shape, 1);
    lakeGeo.rotateX(-Math.PI / 2);
    this.lake = new THREE.Mesh(lakeGeo, waterMaterial({ flowAttr: false, deepColor: new THREE.Color(0.012, 0.05, 0.065), foamBoost: 0 }));
    this.lake.position.set(LAKE.x, LAKE.level, LAKE.z);
    this.lake.receiveShadow = true;
    this.lake.renderOrder = 1;
    this.lake.name = 'lake';
    this.group.add(this.lake);

    const riverMat = waterMaterial({ flowAttr: true, deepColor: new THREE.Color(0.03, 0.1, 0.09), foamBoost: 1 });
    const stream = new THREE.Mesh(riverRibbon(STREAM, streamBedAt, 1.3, 16), riverMat);
    stream.renderOrder = 1;
    this.group.add(stream);
    const upper = new THREE.Mesh(riverRibbon(UPPER_RIVER, upperBedAt, 1.0, 10), riverMat);
    upper.renderOrder = 1;
    this.group.add(upper);

    const fall = new THREE.Mesh(waterfallGeometry(), waterfallMaterial());
    fall.renderOrder = 2;
    fall.name = 'waterfall';
    this.group.add(fall);
    void Fn;
  }
}
