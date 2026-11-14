import { buildEyeMarkup, buildKitsuneSvgMarkup, populateSvgParticles } from '/kitsune-svg.js';

const EYE_LIST = ['normal', 'wide', 'happy', 'wink', 'closed', 'line', 'x', 'star', 'heart', 'spiral'];
const MOOD_TO_EYE = {
  idle: 'normal',
  routing: 'line',
  celebrating: 'happy',
  warning: 'wide',
  blocked: 'line',
  exhausted: 'spiral',
  dizzy: 'spiral',
  sleeping: 'closed',
  startle: 'wide'
};
const CELEB_VEC = [[2.35, 19], [0.82, 18], [3.05, 16], [0.05, 17], [1.95, 22], [1.22, 21]];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class KitsuneMascot {
  constructor(host, bubble, island, options = {}) {
    this.host = host; this.bubble = bubble; this.island = island;
    this.uid = options.uid || 'k'; this.compact = Boolean(options.compact);
    host.innerHTML = buildKitsuneSvgMarkup(this.uid);
    this.svg = host.querySelector('svg');
    this.eyes = [...host.querySelectorAll('.k-eye')];
    this.eyes.forEach((g) => { g.innerHTML = buildEyeMarkup(this.uid); });
    this.q = (sel) => host.querySelector(sel);
    this.qa = (sel) => [...host.querySelectorAll(sel)];
    populateSvgParticles(this.q('.k-stars'), this.q('.k-celeb'), this.q('.k-zzz'));

    this.cursor = { x: 0, y: 0, dx: 0, dy: 0, dist: 999, inside: false, lastX: 0, lastY: 0 };
    this.pupil = { x: 0, y: 0, yaw: 0, pitch: 0, lastYaw: 0, inertiaX: 0, tilt: 0 };
    this.mood = 'idle'; this.beret = false; this.paused = false;
    this.beretAnim = { mode: '', sec: 0, dur: 0.42 };
    this.t = 0; this.lastNow = performance.now(); this.idleSec = 0;
    this.stateTimer = 0; this.wakeTimer = 0; this.celebSec = -1; this.dizzySec = 0; this.startleSec = -1;
    this.move = { name: '', sec: 0, dur: 0 };
    this.sniffT = 3.5; this.sniffP = 0; this.lookT = 4; this.lookDur = 0; this.lookYaw = 0;
    this.petSec = 0; this.blinkUntil = 0; this.nextBlink = this.lastNow + 3200;
    this.clicks = [];

    window.addEventListener('pointermove', (e) => this.onPointer(e), { passive: true });
    if (!this.compact) this.svg.addEventListener('click', () => this.onClick());
    requestAnimationFrame((n) => this.tick(n));
  }

  setBeret(on, animate = true) {
    const next = Boolean(on);
    const el = this.q('.k-beret');
    if (!el) return;
    if (!animate || next === this.beret) {
      this.beret = next;
      this.beretAnim.mode = '';
      el.style.display = next ? '' : 'none';
      el.style.opacity = '1';
      return;
    }
    this.beret = next;
    el.style.display = '';
    el.style.opacity = '1';
    this.beretAnim = { mode: next ? 'in' : 'out', sec: 0, dur: next ? 0.44 : 0.36 };
  }

  setPaused(p) { this.paused = Boolean(p); if (p) this.resetPose(); }

  setMood(mood, text, holdMs = 3400, force = false) {
    clearTimeout(this.wakeTimer);
    if (mood === 'vault_save' || mood === 'key_trash') {
      this.playMove(mood, text);
      return;
    }
    const isWakeJob = this.mood === 'sleeping' && (mood === 'routing' || mood === 'celebrating');
    if (isWakeJob && !force) {
      this.applyMoodNow('startle', 'Opa! Nova requisicao!', 600);
      this.wakeTimer = setTimeout(() => this.applyMoodNow(mood, text, holdMs), 440);
      return;
    }
    const urgent = force || mood === 'blocked' || mood === 'exhausted' || mood === 'dizzy' || mood === 'warning';
    if ((this.move.name === 'vault_save' || this.move.name === 'key_trash') && !urgent) {
      if (text) this.say(text);
      return;
    }
    if (urgent) {
      this.move.name = '';
      this.clearPropsMove();
    }
    this.applyMoodNow(mood, text, holdMs);
  }

  applyMoodNow(mood, text, holdMs) {
    const m = MOOD_TO_EYE[mood] ? mood : 'idle';
    this.mood = m;
    this.svg.dataset.mood = m;
    if (this.island) this.island.dataset.mood = m;
    this.celebSec = m === 'celebrating' ? 0 : -1;
    this.dizzySec = m === 'dizzy' || m === 'exhausted' ? 3.8 : 0;
    this.startleSec = m === 'startle' ? 0 : -1;
    if (m !== 'sleeping') this.idleSec = 0;
    this.applyEyeShape(MOOD_TO_EYE[m]);
    this.updatePropsVisibility();
    if (text) this.say(text);
    clearTimeout(this.stateTimer);
    if (m !== 'idle' && m !== 'exhausted' && m !== 'sleeping' && holdMs > 0) {
      this.stateTimer = setTimeout(() => this.applyMoodNow('idle', '', 0), holdMs);
    }
  }

  playMove(name, customMsg = '') {
    this.move.name = '';
    this.clearPropsMove();
    clearTimeout(this.stateTimer);
    if (name !== 'vault_save' && name !== 'key_trash') return;
    this.mood = 'idle';
    this.svg.dataset.mood = name === 'key_trash' ? 'warning' : 'celebrating';
    if (this.island) this.island.dataset.mood = this.svg.dataset.mood;
    this.move = { name, sec: 0, dur: 2.4 };
    this.q('.k-hands')?.setAttribute('opacity', '1');
    this.applyEyeShape(name === 'vault_save' ? 'star' : 'wide');
    const fallback = name === 'vault_save' ? 'Chave validada e guardada no cofre!' : 'Chave invalida! Foi pro lixo.';
    this.say(customMsg || fallback);
  }

  say(text) {
    if (!this.bubble) return;
    this.bubble.textContent = text;
    this.bubble.hidden = false;
    clearTimeout(this.bubbleTimer);
    this.bubbleTimer = setTimeout(() => { this.bubble.hidden = true; }, 3600);
  }

  onPointer(e) {
    const r = this.svg.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const moved = Math.hypot(e.clientX - this.cursor.lastX, e.clientY - this.cursor.lastY);
    this.cursor = { x: e.clientX, y: e.clientY, dx, dy, dist: Math.hypot(dx, dy), inside: moved > 0.4, lastX: e.clientX, lastY: e.clientY };
    if (!this.compact && this.cursor.dist < 85 && this.mood === 'sleeping') {
      this.applyMoodNow('startle', 'Opa! Acordei.', 900);
    }
  }

  onClick() {
    if (this.mood === 'dizzy' || this.mood === 'exhausted') {
      this.say('Ainda tonta! Aguardando estabilizar.');
      return;
    }
    this.move.name = '';
    this.clearPropsMove();
    const now = performance.now();
    this.clicks = this.clicks.filter((t) => now - t < 1200);
    this.clicks.push(now);
    if (this.clicks.length >= 4) {
      this.clicks = [];
      this.setMood('dizzy', 'Chacoalhou demais!', 3800, true);
      return;
    }
    this.setMood('celebrating', 'Kitsune ativa e pronta!', 1600, true);
  }

  applyEyeShape(shape) {
    this.eyes.forEach((g, idx) => {
      const target = shape === 'wink' && idx === 0 ? 'happy' : shape;
      EYE_LIST.forEach((k) => {
        const el = g.querySelector(`.eye-${k}`);
        if (el) el.style.display = k === target ? '' : 'none';
      });
    });
    const dizzy = shape === 'spiral';
    const okEl = this.q('.k-mouth-ok');
    const dzEl = this.q('.k-mouth-dizzy');
    if (okEl) okEl.style.display = dizzy ? 'none' : '';
    if (dzEl) dzEl.style.display = dizzy ? '' : 'none';
  }

  updatePropsVisibility() {
    const isDizzy = this.mood === 'dizzy' || this.mood === 'exhausted';
    const hands = ['celebrating', 'dizzy', 'exhausted', 'startle', 'routing'].includes(this.mood);
    this.q('.k-hands')?.setAttribute('opacity', hands ? '1' : '0');
    this.q('.k-loupe')?.setAttribute('opacity', this.mood === 'routing' || this.mood === 'blocked' ? '1' : '0');
    this.q('.k-stars')?.setAttribute('opacity', isDizzy ? '1' : '0');
    this.q('.k-celeb')?.setAttribute('opacity', this.mood === 'celebrating' ? '1' : '0');
    this.q('.k-zzz')?.setAttribute('opacity', this.mood === 'sleeping' ? '1' : '0');
    this.q('.k-sweat')?.setAttribute('opacity', this.mood === 'warning' ? '1' : '0');
    this.q('.k-halo')?.setAttribute('opacity', '0');
    this.q('.k-ghost')?.setAttribute('opacity', '0');
  }

  resetPose() {
    ['.k-root', '.k-body', '.k-tail', '.k-earL', '.k-earR', '.k-face', '.k-snout', '.k-beret'].forEach((s) => this.q(s)?.setAttribute('transform', ''));
    this.q('.k-shadow')?.setAttribute('transform', '');
    this.qa('.lid').forEach((l) => l.setAttribute('transform', ''));
  }

  tick(now) {
    requestAnimationFrame((n) => this.tick(n));
    const dt = Math.min(0.05, Math.max(0.004, (now - this.lastNow) / 1000));
    this.lastNow = now;
    this.t += dt;
    this.updateGaze(dt);
    if (this.paused) return;

    const anim = this.computeSpecialPose(dt) || this.computeIdlePose(dt);
    this.applyBodyPose(anim);
    this.updateBeretMotion(dt);
    this.updateFidgetsAndBlink(now, dt);
    this.updateParticles();
  }

  updateGaze(dt) {
    const w = Math.max(320, window.innerWidth / 2);
    const h = Math.max(320, window.innerHeight / 2);
    let targetYaw = clamp(this.cursor.dx / w, -1, 1) * 0.62;
    const targetPitch = clamp(this.cursor.dy / h, -1, 1) * 0.50;

    if (this.mood === 'idle' && this.idleSec > 3.0) {
      if (this.lookDur > 0) {
        this.lookDur -= dt;
        targetYaw = clamp(targetYaw + this.lookYaw, -0.75, 0.75);
      } else if ((this.lookT -= dt) <= 0) {
        this.lookDur = 1.15;
        this.lookYaw = (Math.random() > 0.5 ? 1 : -1) * 0.36;
        this.lookT = 6 + Math.random() * 5;
      }
    }
    this.pupil.yaw += (targetYaw - this.pupil.yaw) * 0.18;
    this.pupil.pitch += (targetPitch - this.pupil.pitch) * 0.18;
    this.faceShiftX = Math.sin(this.pupil.yaw) * 3.2;
    this.faceShiftY = -Math.sin(this.pupil.pitch) * 2.2;
    this.q('.k-face')?.setAttribute('transform', `translate(${this.faceShiftX.toFixed(2)} ${this.faceShiftY.toFixed(2)})`);

    const accel = this.pupil.yaw - this.pupil.lastYaw;
    this.pupil.inertiaX += (-accel * 14 - this.pupil.inertiaX) * 0.2;
    this.pupil.lastYaw = this.pupil.yaw;
    this.updatePupils();
    this.handlePetting(dt);
  }

  updatePupils() {
    const ang = Math.atan2(this.cursor.dy, this.cursor.dx);
    const tx = Math.cos(ang) * Math.min(1.15, this.cursor.dist / 90);
    const ty = Math.sin(ang) * Math.min(1.05, this.cursor.dist / 95);
    this.pupil.x = clamp(this.pupil.x + (tx - this.pupil.x) * 0.22, -1.15, 1.15);
    this.pupil.y = clamp(this.pupil.y + (ty - this.pupil.y) * 0.22, -1.05, 1.05);
    const jx = this.mood === 'routing' ? (Math.random() - 0.5) * 0.6 : 0;
    this.qa('.pupil, .pupil-w').forEach((p) => {
      p.setAttribute('transform', `translate(${(this.pupil.x + jx).toFixed(3)} ${this.pupil.y.toFixed(3)})`);
    });
  }

  updateBeretMotion(dt) {
    const el = this.q('.k-beret');
    if (!el) return;
    const fx = (this.faceShiftX || 0) * 0.55 + this.pupil.inertiaX;
    const fy = (this.faceShiftY || 0) * 0.55;

    if (!this.beretAnim.mode) {
      if (this.beret) {
        el.setAttribute('transform', `translate(${fx.toFixed(2)} ${fy.toFixed(2)})`);
      }
      return;
    }

    this.beretAnim.sec += dt;
    const p = clamp(this.beretAnim.sec / this.beretAnim.dur, 0, 1);
    if (this.beretAnim.mode === 'in') {
      const ease = 1 - Math.pow(1 - p, 3);
      const dropY = -17 * (1 - ease) + Math.sin(p * Math.PI) * 1.4;
      const rot = -18 * (1 - ease);
      const sc = 1.15 - 0.15 * ease;
      el.setAttribute('opacity', Math.min(1, p * 2.2).toFixed(2));
      el.setAttribute('transform', `translate(${fx.toFixed(2)} ${(fy + dropY).toFixed(2)}) rotate(${rot.toFixed(1)} 42 20) scale(${sc.toFixed(3)})`);
      if (p >= 1) {
        this.beretAnim.mode = '';
        el.setAttribute('opacity', '1');
      }
      return;
    }

    const liftY = -18 * p * p;
    const rot = 22 * p;
    const sc = 1 - 0.25 * p;
    el.setAttribute('opacity', Math.max(0, 1 - p).toFixed(2));
    el.setAttribute('transform', `translate(${fx.toFixed(2)} ${(fy + liftY).toFixed(2)}) rotate(${rot.toFixed(1)} 42 20) scale(${sc.toFixed(3)})`);
    if (p >= 1) {
      this.beretAnim.mode = '';
      el.style.display = 'none';
      el.setAttribute('opacity', '1');
    }
  }

  handlePetting(dt) {
    if (!this.compact && this.cursor.dist < 42 && this.cursor.inside && this.mood === 'idle' && !this.move.name) {
      this.petSec += dt;
      if (this.petSec > 0.35) this.applyEyeShape('heart');
    } else if (this.petSec > 0) {
      this.petSec = 0;
      if (this.mood === 'idle') this.applyEyeShape('normal');
    }
  }

  computeSpecialPose(dt) {
    if (this.move.name) return this.tickMove(dt);
    if (this.mood === 'dizzy' || this.mood === 'exhausted') return this.tickDizzy(dt);
    if (this.mood === 'celebrating' && this.celebSec >= 0) return this.tickCelebration(dt);
    if (this.mood === 'startle' && this.startleSec >= 0) return this.tickStartle(dt);
    if (this.mood === 'warning') {
      const decay = Math.max(0, 1 - this.t * 0.1);
      return { jx: 0, jy: -2 * Math.abs(Math.sin(this.t * 9)), tilt: Math.sin(this.t * 28) * 6 * (0.4 + decay), sx: 1, sy: 1 };
    }
    return null;
  }

  clearPropsMove() {
    ['.k-vault', '.k-trash', '.k-key'].forEach((s) => this.q(s)?.setAttribute('opacity', '0'));
    this.q('.k-vault-door')?.setAttribute('transform', '');
    this.q('.k-trash-lid')?.setAttribute('transform', '');
  }

  tickMove(dt) {
    this.move.sec += dt;
    const p = this.move.sec / this.move.dur;
    if (p >= 1) {
      this.move.name = '';
      this.clearPropsMove();
      this.applyMoodNow('idle', '', 0);
      return null;
    }
    if (this.move.name === 'vault_save') return this.tickVaultSave(p);
    return this.tickKeyTrash(p);
  }

  tickVaultSave(p) {
    const fade = p < 0.1 ? p / 0.1 : p > 0.9 ? (1 - p) / 0.1 : 1;
    this.q('.k-vault')?.setAttribute('opacity', fade.toFixed(2));
    const doorOpen = p < 0.18 ? p / 0.18 : p < 0.62 ? 1 : p < 0.76 ? 1 - (p - 0.62) / 0.14 : 0;
    this.q('.k-vault-door')?.setAttribute('transform', `translate(10 0) scale(${(1 - 0.82 * doorOpen).toFixed(3)} 1) translate(-10 0)`);
    this.q('.k-vault-glow')?.setAttribute('opacity', (p >= 0.76 ? 0.65 : 0.25 + 0.4 * doorOpen).toFixed(2));
    this.q('.k-key')?.setAttribute('opacity', (p < 0.66 ? fade : 0).toFixed(2));
    const run = p < 0.4 ? Math.sin((p / 0.4) * Math.PI / 2) : p > 0.72 ? clamp(1 - (p - 0.72) / 0.28, 0, 1) : 1;
    const jx = -8 + run * 14;
    const kx = p < 0.45 ? 42 + jx + 17 : 62 + ((p - 0.45) / 0.21) * 23;
    const ky = p < 0.45 ? 45 - Math.abs(Math.sin(p * 18)) * 2 : 45;
    this.q('.k-key')?.setAttribute('transform', `translate(${kx.toFixed(1)} ${ky.toFixed(1)}) rotate(${p < 0.45 ? -18 : 0})`);
    const hop = p > 0.74 ? Math.abs(Math.sin(((p - 0.74) / 0.26) * Math.PI * 2)) : Math.abs(Math.sin(p * Math.PI * 6));
    if (p > 0.74) this.applyEyeShape('happy');
    return { jx, jy: -hop * (p > 0.74 ? 5 : 2.5), tilt: run * 5, sx: 1, sy: 1 };
  }

  tickKeyTrash(p) {
    const fade = p < 0.1 ? p / 0.1 : p > 0.9 ? (1 - p) / 0.1 : 1;
    const shake = p > 0.66 && p < 0.84 ? Math.sin((p - 0.66) * 90) * 6 * (1 - (p - 0.66) / 0.18) : 0;
    this.q('.k-trash')?.setAttribute('opacity', fade.toFixed(2));
    this.q('.k-trash')?.setAttribute('transform', `translate(81 35) rotate(${shake.toFixed(1)} 9 22)`);
    const lid = p < 0.22 ? 0 : p < 0.35 ? (p - 0.22) / 0.13 : p < 0.68 ? 1 : p < 0.76 ? 1 - (p - 0.68) / 0.08 : 0;
    this.q('.k-trash-lid')?.setAttribute('transform', `rotate(${(lid * 66).toFixed(1)} 10 2)`);
    this.q('.k-key')?.setAttribute('opacity', (p < 0.67 ? fade : 0).toFixed(2));
    const u = clamp((p - 0.34) / 0.32, 0, 1);
    const kx = p < 0.34 ? 38 - p * 28 : 28 + u * 61;
    const ky = p < 0.34 ? 44 : 44 - Math.sin(u * Math.PI) * 24 - u * 4;
    this.q('.k-key')?.setAttribute('transform', `translate(${kx.toFixed(1)} ${ky.toFixed(1)}) rotate(${(u * 540 - 25).toFixed(1)})`);
    const back = p < 0.34 ? Math.sin((p / 0.34) * Math.PI / 2) : 1 - clamp((p - 0.34) / 0.2, 0, 1);
    const tilt = p < 0.34 ? -15 * back : p < 0.52 ? 14 * (1 - (p - 0.34) / 0.18) : 0;
    if (p > 0.68) this.applyEyeShape('line');
    return { jx: -10 - back * 4 + (p > 0.68 ? clamp((p - 0.68) / 0.32, 0, 1) * 10 : 0), jy: p > 0.34 && p < 0.48 ? -3 : 0, tilt, sx: 1, sy: 1 };
  }

  tickDizzy(dt) {
    this.dizzySec = Math.max(0.35, this.dizzySec - dt);
    const d = this.t * 360;
    this.qa('.spiral-spin').forEach((s, i) => s.setAttribute('transform', `rotate(${((i ? -d : d) * 1.4).toFixed(1)})`));
    const damp = Math.min(1, this.dizzySec / 0.8);
    return { jx: Math.sin(this.t * 9.5) * 2.8 * damp, jy: Math.abs(Math.cos(this.t * 9.5)) * 1.5 * damp, tilt: Math.sin(this.t * 9.5) * 9 * damp, sx: 1 + Math.sin(this.t * 12) * 0.05 * damp, sy: 1 - Math.sin(this.t * 12) * 0.05 * damp };
  }

  tickCelebration(dt) {
    this.celebSec += dt;
    const s = this.celebSec;
    if (s < 0.42) {
      const u = s / 0.42;
      const ease = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      this.applyEyeShape('star');
      return { jx: 0, jy: -7.5 * Math.sin(u * Math.PI), tilt: ease * 360, sx: 0.93, sy: 1.07, cx: 42, cy: 36 };
    }
    const v = Math.min(1, (s - 0.42) / 1.05);
    const hop = Math.abs(Math.sin(v * Math.PI * 3));
    const land = Math.pow(1 - hop, 4);
    this.applyEyeShape(v > 0.35 && v < 0.68 ? 'wink' : 'happy');
    return { jx: Math.sin(v * Math.PI * 6) * 2.2, jy: -5.5 * hop, tilt: Math.sin(v * Math.PI * 6) * 6, sx: 1 + 0.1 * land, sy: 1 - 0.1 * land };
  }

  tickStartle(dt) {
    this.startleSec += dt;
    const s = this.startleSec;
    if (s < 0.24) {
      const u = s / 0.24;
      return { jx: Math.sin(u * Math.PI * 6) * 2, jy: -6 * Math.sin(u * Math.PI), tilt: Math.sin(u * Math.PI * 4) * 7, sx: 0.9, sy: 1.12 };
    }
    return { jx: Math.sin(s * 2) * 0.6, jy: 4 + Math.sin(s * 3) * 0.4, tilt: Math.sin(s * 1.5) * 2.2, sx: 1.11, sy: 0.87 };
  }

  computeIdlePose(dt) {
    const b = Math.sin(this.t * 2.4) * (this.mood === 'routing' ? 0.026 : 0.018);
    if (this.mood === 'idle' && !this.compact) {
      this.idleSec += dt;
      if (this.idleSec > 18) this.applyMoodNow('sleeping', 'Aguardando requisicao... Zzz', 0);
    }
    const targetTilt = this.mood === 'sleeping' ? Math.sin(this.t * 1.1) * 2.2 : this.petSec > 0.35 ? Math.sin(this.t * 8) * 3 : this.pupil.yaw * 10;
    this.pupil.tilt += (targetTilt - this.pupil.tilt) * 0.1;
    return { jx: 0, jy: 0, tilt: this.pupil.tilt, sx: 1 - b * 0.65, sy: 1 + b };
  }

  applyBodyPose(p) {
    const cx = p.cx ?? 42;
    const cy = p.cy ?? 59;
    this.q('.k-root')?.setAttribute('transform', `translate(${p.jx.toFixed(2)} ${p.jy.toFixed(2)}) rotate(${p.tilt.toFixed(2)} ${cx} ${cy})`);
    this.q('.k-body')?.setAttribute('transform', `translate(42 60) scale(${p.sx.toFixed(4)} ${p.sy.toFixed(4)}) translate(-42 -60)`);
    const shScale = clamp(1 - (-p.jy * 0.025), 0.7, 1.06);
    this.q('.k-shadow')?.setAttribute('transform', `translate(42 61.5) scale(${shScale.toFixed(3)} 1) translate(-42 -61.5)`);
  }

  updateFidgetsAndBlink(now, dt) {
    const lively = this.mood === 'celebrating' || this.mood === 'routing' || this.mood === 'startle' || this.petSec > 0.25;
    const freq = this.mood === 'sleeping' ? 1.5 : lively ? 7.6 : 3.2;
    const amp = this.mood === 'sleeping' ? 3.8 : lively ? 14.5 : 8.5;
    const wag = Math.sin(this.t * freq) * amp + Math.sin(this.t * freq * 1.85 + 0.7) * (amp * 0.22);
    const plush = 1 + Math.sin(this.t * freq * 2) * (lively ? 0.04 : 0.02);
    this.q('.k-tail')?.setAttribute('transform', `rotate(${wag.toFixed(2)} 60 50) translate(60 50) scale(1 ${plush.toFixed(3)}) translate(-60 -50)`);
    this.q('.k-earL')?.setAttribute('transform', `rotate(${(Math.sin(this.t * 2.4) * 3.4).toFixed(2)} 27 23)`);
    this.q('.k-earR')?.setAttribute('transform', `rotate(${(-Math.sin(this.t * 2.4) * 3.4).toFixed(2)} 57 23)`);

    let sniffY = 0;
    if ((this.sniffT -= dt) <= 0) {
      this.sniffP += dt * 16;
      sniffY = -Math.abs(Math.sin(this.sniffP)) * 1.1;
      if (this.sniffP >= Math.PI * 2) { this.sniffP = 0; this.sniffT = 3 + Math.random() * 3; }
    }
    this.q('.k-snout')?.setAttribute('transform', `translate(0 ${sniffY.toFixed(2)})`);

    if (now >= this.nextBlink) {
      this.blinkUntil = now + 115;
      this.nextBlink = now + (Math.random() < 0.25 ? 240 : 3000 + Math.random() * 2500);
    }
    const sc = now < this.blinkUntil ? 0.06 : 1;
    this.qa('.lid').forEach((l) => l.setAttribute('transform', `scale(1 ${sc})`));
  }

  updateParticles() {
    if (this.mood === 'dizzy' || this.mood === 'exhausted') {
      [...(this.q('.k-stars')?.children || [])].forEach((s, i) => {
        const a = this.t * 5 + (i * Math.PI * 2) / 3;
        s.setAttribute('transform', `translate(${(42 + Math.cos(a) * 18).toFixed(1)} ${(4 + Math.sin(a) * 4.5).toFixed(1)})`);
      });
    }
    if (this.mood === 'celebrating' && this.celebSec >= 0) {
      const p = Math.min(1, this.celebSec / 1.15);
      const ease = 1 - Math.pow(1 - p, 3);
      const fade = p < 0.2 ? p / 0.2 : Math.max(0, 1 - (p - 0.2) / 0.8);
      [...(this.q('.k-celeb')?.children || [])].forEach((el, i) => {
        const [ang, spd] = CELEB_VEC[i];
        el.setAttribute('transform', `translate(${(42 + Math.cos(ang) * spd * ease).toFixed(1)} ${(28 - Math.sin(ang) * spd * ease + p * p * 10).toFixed(1)})`);
        el.setAttribute('opacity', fade.toFixed(2));
      });
    }
    if (this.mood === 'sleeping') {
      [...(this.q('.k-zzz')?.children || [])].forEach((el, i) => {
        const z = (this.t * 0.55 + i * 0.33) % 1;
        el.setAttribute('transform', `translate(${(58 + Math.sin(z * 6) * 3 + i * 4).toFixed(1)} ${(22 - z * 20).toFixed(1)})`);
        el.setAttribute('opacity', (z < 0.2 ? z / 0.2 : 1 - (z - 0.2) / 0.8).toFixed(2));
      });
    }
    if (this.mood === 'warning') {
      const cyc = (this.t * 0.9) % 1;
      this.q('.k-sweat')?.setAttribute('transform', `translate(0 ${(cyc * 6).toFixed(1)})`);
      this.q('.k-sweat')?.setAttribute('opacity', (cyc < 0.2 ? cyc / 0.2 : 1 - (cyc - 0.2) / 0.8).toFixed(2));
    }
  }
}
