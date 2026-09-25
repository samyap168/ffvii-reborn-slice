// Combat HUD: FFVII-style party window, materia command bar, enemy panel,
// lock-on reticle and bouncing damage numbers.
import * as THREE from 'three/webgpu';

export interface HudState {
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  limit: number; // 0..1
  atb: number; // 0..2
  visible: boolean;
}

export interface EnemyHud {
  name: string;
  hp: number;
  maxHp: number;
  stagger: number; // 0..1
  staggered: boolean;
  weak?: string;
}

export interface MateriaSlot {
  key: string;
  name: string;
  color: string;
  mp: number;
}

interface Num {
  el: HTMLElement;
  pos: THREE.Vector3;
  age: number;
  life: number;
  vx: number;
}

export class HUD {
  private el: HTMLElement;
  private hpBar: HTMLElement;
  private hpTxt: HTMLElement;
  private mpBar: HTMLElement;
  private mpTxt: HTMLElement;
  private limitBar: HTMLElement;
  private limitBox: HTMLElement;
  private atbSeg: HTMLElement[];
  private enemyBox: HTMLElement;
  private enemyName: HTMLElement;
  private enemyHp: HTMLElement;
  private enemyHpLag: HTMLElement;
  private enemyStagger: HTMLElement;
  private enemyTag: HTMLElement;
  private reticle: HTMLElement;
  private cmd: HTMLElement;
  private slots: HTMLElement[] = [];
  private nums: Num[] = [];
  private numLayer: HTMLElement;
  private lagHp = 1;
  private shown = 0;
  private vis = false;

  constructor(root: HTMLElement, private camera: THREE.PerspectiveCamera, materia: MateriaSlot[]) {
    root.insertAdjacentHTML(
      'beforeend',
      `<style>
      .hud { position:absolute; inset:0; opacity:0; transition:opacity .5s; }
      .hud.on { opacity:1; }
      .party { position:absolute; right:3vw; bottom:4vh; width:min(420px,38vw); min-width:330px; padding:12px 16px 12px; font-size:16px; }
      .party .row { display:flex; align-items:center; gap:10px; margin:3px 0; }
      .party .name { font-family:'Cinzel',serif; font-weight:700; letter-spacing:.14em; font-size:19px; margin-bottom:4px; display:flex; justify-content:space-between; }
      .party .lbl { width:36px; font-weight:700; color:#9fc1ff; letter-spacing:.08em; font-size:14px; }
      .party .val { width:120px; white-space:nowrap; text-align:right; font-weight:700; font-variant-numeric:tabular-nums; letter-spacing:.04em; }
      .bar { flex:1; height:7px; border-radius:4px; background:rgba(0,0,20,.55); overflow:hidden; box-shadow: inset 0 0 0 1px rgba(255,255,255,.18); position:relative; }
      .bar i { position:absolute; left:0; top:0; bottom:0; width:100%; border-radius:4px; transition:width .12s linear; }
      .hpb i { background:linear-gradient(90deg,#3ce0a0,#aef7d3); box-shadow:0 0 8px #3ce0a088; }
      .hpb.low i { background:linear-gradient(90deg,#ff5c5c,#ffb0a0); }
      .mpb i { background:linear-gradient(90deg,#3a7cff,#9cc4ff); }
      .limit { margin-top:6px; }
      .limit .bar { height:9px; }
      .limit .bar i { background:linear-gradient(90deg,#b0246c,#ff6db4); }
      .limit.full .bar i { background:linear-gradient(90deg,#ff2d8b,#ffd1ea,#ff2d8b); background-size:200% 100%; animation:limitflow .6s linear infinite; box-shadow:0 0 14px #ff4fa0; }
      .limit.full .lbl { color:#ff9ad0; text-shadow:0 0 8px #ff4fa0; animation:blinkL .5s ease-in-out infinite; }
      @keyframes limitflow { to { background-position:-200% 0; } }
      @keyframes blinkL { 50% { opacity:.4; } }
      .atb { display:flex; gap:5px; flex:1; }
      .atb span { flex:1; height:9px; border-radius:3px; background:rgba(0,0,20,.55); box-shadow: inset 0 0 0 1px rgba(255,255,255,.18); position:relative; overflow:hidden; }
      .atb span i { position:absolute; inset:0; width:0; background:linear-gradient(90deg,#ffe07a,#fff5c4); }
      .atb span.full i { box-shadow:0 0 10px #ffe07a; }
      .cmd { position:absolute; left:3vw; bottom:4vh; display:flex; flex-direction:column; gap:6px; }
      .slot { display:flex; align-items:center; gap:10px; padding:6px 14px 6px 8px; min-width:190px; font-size:16px; letter-spacing:.06em; transition: opacity .2s, filter .2s; }
      .slot .orb { width:18px; height:18px; border-radius:50%; box-shadow:0 0 10px currentColor, inset -3px -3px 6px rgba(0,0,0,.45), inset 2px 2px 5px rgba(255,255,255,.7); }
      .slot kbd { font-family:inherit; font-weight:700; border:1px solid rgba(255,255,255,.6); border-radius:4px; padding:0 6px; font-size:13px; }
      .slot .mp { margin-left:auto; color:#9fc1ff; font-size:13px; }
      .slot.off { opacity:.45; filter:grayscale(.6); }
      .enemy { position:absolute; left:50%; top:4vh; transform:translateX(-50%); width:min(560px,48vw); padding:8px 16px 10px; opacity:0; transition:opacity .3s; }
      .enemy.on { opacity:1; }
      .enemy .en { display:flex; justify-content:space-between; font-family:'Cinzel',serif; font-weight:700; letter-spacing:.14em; font-size:17px; margin-bottom:6px; }
      .enemy .tag { font-family:'Rajdhani'; font-size:14px; color:#ffcf6a; letter-spacing:.2em; }
      .enemy .bar { height:9px; }
      .enemy .ehp i { background:linear-gradient(90deg,#ff5a3c,#ffb08c); z-index:2; }
      .enemy .ehp b { position:absolute; left:0; top:0; bottom:0; background:#fff3; border-radius:4px; transition: width .6s ease .25s; }
      .enemy .stg { margin-top:5px; height:5px; }
      .enemy .stg i { background:linear-gradient(90deg,#ffb23c,#ffe28a); }
      .enemy.staggered .stg i { background:linear-gradient(90deg,#ff3cc8,#ffd0f5); box-shadow:0 0 10px #ff3cc8; }
      .reticle { position:absolute; width:44px; height:44px; margin:-22px 0 0 -22px; border:2px solid rgba(255,220,120,.9); border-radius:50%; box-shadow:0 0 10px rgba(255,200,80,.8); opacity:0; transition:opacity .2s; animation: spinR 3s linear infinite; }
      .reticle::before, .reticle::after { content:''; position:absolute; left:50%; top:-8px; width:2px; height:10px; background:#ffd772; }
      .reticle::after { top:auto; bottom:-8px; }
      @keyframes spinR { to { transform: rotate(360deg); } }
      .num { position:absolute; font-family:'Rajdhani'; font-weight:700; font-size:30px; color:#fff; text-shadow:0 2px 0 #000, 0 0 8px rgba(0,0,0,.8); transform:translate(-50%,-50%); white-space:nowrap; letter-spacing:.02em; }
      .num.crit { color:#ffe066; font-size:40px; text-shadow:0 2px 0 #000, 0 0 12px #ff9d00; }
      .num.heal { color:#7dffae; }
      .num.miss { color:#cfd8ff; font-size:26px; font-style:italic; }
      .num.player { color:#ff8a8a; font-size:26px; }
      .num.tag { color:#ffcf6a; font-size:20px; letter-spacing:.2em; }
      </style>
      <div class="hud" id="hudRoot">
        <div class="numlayer" id="numLayer"></div>
        <div class="reticle" id="reticle"></div>
        <div class="enemy ffwin" id="enemyBox"><div class="en"><span id="enemyName"></span><span class="tag" id="enemyTag"></span></div>
          <div class="bar ehp"><b id="enemyHpLag"></b><i id="enemyHp"></i></div><div class="bar stg"><i id="enemyStagger"></i></div></div>
        <div class="cmd" id="cmd"></div>
        <div class="party ffwin">
          <div class="name"><span>CLOUD</span><span style="font-family:Rajdhani;font-size:13px;color:#9fc1ff;letter-spacing:.2em">LV 25</span></div>
          <div class="row"><span class="lbl">HP</span><div class="bar hpb" id="hpBarBox"><i id="hpBar"></i></div><span class="val" id="hpTxt"></span></div>
          <div class="row"><span class="lbl">MP</span><div class="bar mpb"><i id="mpBar"></i></div><span class="val" id="mpTxt"></span></div>
          <div class="row"><span class="lbl">ATB</span><div class="atb"><span><i></i></span><span><i></i></span></div></div>
          <div class="row limit" id="limitBox"><span class="lbl">LIMIT</span><div class="bar"><i id="limitBar"></i></div></div>
        </div>
      </div>`,
    );
    const $ = (id: string) => document.getElementById(id)!;
    this.el = $('hudRoot');
    this.hpBar = $('hpBar');
    this.hpTxt = $('hpTxt');
    this.mpBar = $('mpBar');
    this.mpTxt = $('mpTxt');
    this.limitBar = $('limitBar');
    this.limitBox = $('limitBox');
    this.atbSeg = Array.from(this.el.querySelectorAll('.atb span')) as HTMLElement[];
    this.enemyBox = $('enemyBox');
    this.enemyName = $('enemyName');
    this.enemyHp = $('enemyHp');
    this.enemyHpLag = $('enemyHpLag');
    this.enemyStagger = $('enemyStagger');
    this.enemyTag = $('enemyTag');
    this.reticle = $('reticle');
    this.numLayer = $('numLayer');
    this.cmd = $('cmd');
    for (const m of materia) {
      this.cmd.insertAdjacentHTML('beforeend', `<div class="slot ffwin"><kbd>${m.key}</kbd><span class="orb" style="color:${m.color};background:radial-gradient(circle at 35% 30%,#fff,${m.color} 45%,#000 120%)"></span><span>${m.name}</span><span class="mp">${m.mp} MP</span></div>`);
    }
    this.slots = Array.from(this.cmd.querySelectorAll('.slot')) as HTMLElement[];
  }

  setVisible(v: boolean) {
    this.vis = v;
    this.el.classList.toggle('on', v);
  }

  update(dt: number, s: HudState, enemy: EnemyHud | null, lockWorld: THREE.Vector3 | null, slotEnabled: boolean[]) {
    const hpF = s.hp / s.maxHp;
    this.hpBar.style.width = `${(hpF * 100).toFixed(1)}%`;
    document.getElementById('hpBarBox')!.classList.toggle('low', hpF < 0.25);
    this.hpTxt.textContent = `${Math.ceil(s.hp)} / ${s.maxHp}`;
    this.mpBar.style.width = `${((s.mp / s.maxMp) * 100).toFixed(1)}%`;
    this.mpTxt.textContent = `${Math.floor(s.mp)} / ${s.maxMp}`;
    this.limitBar.style.width = `${(s.limit * 100).toFixed(1)}%`;
    this.limitBox.classList.toggle('full', s.limit >= 1);
    this.atbSeg.forEach((seg, i) => {
      const f = Math.max(0, Math.min(1, s.atb - i));
      (seg.firstChild as HTMLElement).style.width = `${f * 100}%`;
      seg.classList.toggle('full', f >= 1);
    });
    this.slots.forEach((sl, i) => sl.classList.toggle('off', !slotEnabled[i]));
    // Enemy panel.
    this.enemyBox.classList.toggle('on', !!enemy && this.vis);
    if (enemy) {
      const f = Math.max(0, enemy.hp / enemy.maxHp);
      this.enemyName.textContent = enemy.name;
      this.enemyHp.style.width = `${f * 100}%`;
      this.lagHp = Math.max(f, this.lagHp - dt * 0.4);
      if (this.lagHp < f) this.lagHp = f;
      this.enemyHpLag.style.width = `${this.lagHp * 100}%`;
      this.enemyStagger.style.width = `${(enemy.staggered ? 1 : enemy.stagger) * 100}%`;
      this.enemyBox.classList.toggle('staggered', enemy.staggered);
      this.enemyTag.textContent = enemy.staggered ? 'STAGGERED' : enemy.stagger > 0.6 ? 'PRESSURED' : enemy.weak ? `WEAK · ${enemy.weak}` : '';
    }
    // Reticle.
    if (lockWorld && this.vis) {
      const p = lockWorld.clone().project(this.camera);
      const on = p.z < 1 && Math.abs(p.x) < 1.2 && Math.abs(p.y) < 1.2;
      this.reticle.style.opacity = on ? '1' : '0';
      this.reticle.style.left = `${(p.x * 0.5 + 0.5) * 100}vw`;
      this.reticle.style.top = `${(-p.y * 0.5 + 0.5) * 100}vh`;
    } else this.reticle.style.opacity = '0';
    // Damage numbers.
    for (const n of this.nums) {
      n.age += dt;
      const t = n.age / n.life;
      const p = n.pos.clone();
      p.y += Math.min(1, n.age * 3) * 0.6 + t * 0.5;
      p.project(this.camera);
      const bounce = n.age < 0.25 ? Math.sin((n.age / 0.25) * Math.PI) * 18 : 0;
      n.el.style.left = `${(p.x * 0.5 + 0.5) * 100 + n.vx * n.age * 4}vw`;
      n.el.style.top = `calc(${(-p.y * 0.5 + 0.5) * 100}vh - ${bounce}px)`;
      n.el.style.opacity = String(t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25);
      n.el.style.display = p.z < 1 ? 'block' : 'none';
    }
    for (const n of this.nums.filter((n) => n.age >= n.life)) n.el.remove();
    this.nums = this.nums.filter((n) => n.age < n.life);
    this.shown += dt;
  }

  number(pos: THREE.Vector3, text: string, cls = '') {
    const el = document.createElement('div');
    el.className = 'num ' + cls;
    el.textContent = text;
    this.numLayer.appendChild(el);
    this.nums.push({ el, pos: pos.clone(), age: 0, life: cls.includes('crit') ? 1.4 : 1.1, vx: (Math.random() - 0.5) * 0.8 });
  }
}
