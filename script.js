(() => {
'use strict';

/* ================= Helpers ================= */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const pad = n => String(n).padStart(2, '0');

const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } }
};

const TZ = 'Asia/Phnom_Penh';
const PP_OFFSET_MS = 7 * 3600 * 1000; // Cambodia has no daylight saving: always UTC+7
const APP_TITLE = 'Study Timer';

/* ================= Dial drawing ================= */
function polar(r, deg) {
    const a = (deg - 90) * Math.PI / 180;
    return [200 + r * Math.cos(a), 200 + r * Math.sin(a)];
}

// Pie wedge growing clockwise from 12 o'clock
function wedgePath(r, deg) {
    if (deg <= 0.05) return '';
    if (deg >= 359.95) return `M200 ${200 - r} A${r} ${r} 0 1 1 200 ${200 + r} A${r} ${r} 0 1 1 200 ${200 - r}Z`;
    const [x, y] = polar(r, deg);
    return `M200 200 L200 ${200 - r} A${r} ${r} 0 ${deg > 180 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)}Z`;
}

function buildDial(svg, { labels, caption, clockHands = false }) {
    let s = '<circle class="bezel" cx="200" cy="200" r="198"/>';
    s += '<circle class="dial-face" cx="200" cy="200" r="190"/>';

    for (let i = 0; i < 60; i++) {
        const major = i % 5 === 0;
        const [x1, y1] = polar(178, i * 6);
        const [x2, y2] = polar(major ? 163 : 170, i * 6);
        s += `<line class="tick${major ? ' major' : ''}" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
    }

    if (labels === 'hour') {
        for (let h = 1; h <= 12; h++) {
            const [x, y] = polar(138, h * 30);
            s += `<text class="num hour" x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" dominant-baseline="central">${h}</text>`;
        }
    } else {
        for (let m = 0; m < 60; m += 5) {
            const [x, y] = polar(142, m * 6);
            s += `<text class="num" x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" dominant-baseline="central">${m}</text>`;
        }
        s += '<path class="wedge" d=""/>';
    }

    s += `<text class="caption" x="200" y="274" text-anchor="middle">${
        caption.map((l, i) => `<tspan class="cap-line" x="200" dy="${i ? 20 : 0}">${l}</tspan>`).join('')
    }</text>`;

    if (clockHands) {
        s += '<line class="hand hand-hour" x1="200" y1="200" x2="200" y2="128"/>';
        s += '<line class="hand hand-min" x1="200" y1="200" x2="200" y2="82"/>';
        s += '<line class="hand hand-sec" x1="200" y1="214" x2="200" y2="70"/>';
    }

    s += '<circle class="knob" cx="200" cy="200" r="26"/><circle class="knob-dot" cx="200" cy="200" r="4"/>';
    svg.setAttribute('viewBox', '0 0 400 400');
    svg.innerHTML = s;
}

function setCaption(svg, lines) {
    $$('.cap-line', svg).forEach((t, i) => { t.textContent = lines[i] || ''; });
}

/* ================= Navigation ================= */
const menu = $('.menu-container');
const indicator = $('.indicator');
const items = $$('ul.manu li');
let active = 'clock';

function moveIndicator() {
    const li = items.find(i => i.dataset.view === active);
    if (!li) return;
    const c = menu.getBoundingClientRect();
    const r = li.getBoundingClientRect();
    indicator.style.width  = r.width + 'px';
    indicator.style.height = r.height + 'px';
    indicator.style.left   = (r.left - c.left) + 'px';
    indicator.style.top    = (r.top - c.top) + 'px';
}

function show(name, updateHash = true) {
    active = name;
    $$('.view').forEach(v => { v.hidden = v.id !== 'view-' + name; });
    items.forEach(li => {
        const on = li.dataset.view === name;
        li.classList.toggle('active', on);
        $('button', li).setAttribute('aria-selected', on);
    });
    moveIndicator();
    if (updateHash) history.replaceState(null, '', '#' + name);
    kick();
    renderTitle();
}

items.forEach(li => $('button', li).addEventListener('click', () => show(li.dataset.view)));
window.addEventListener('resize', moveIndicator);

/* ================= Animation loop (only when needed) ================= */
let raf = 0;
function loop() {
    raf = 0;
    if (active === 'clock') {
        renderClock();
        raf = requestAnimationFrame(loop);
    } else if (active === 'stopwatch') {
        renderSW();
        if (sw.running) raf = requestAnimationFrame(loop);
    }
}
function kick() { if (!raf) raf = requestAnimationFrame(loop); }

/* ================= CLOCK ================= */
const cSvg = $('#clock-dial');
buildDial(cSvg, { labels: 'hour', caption: ['Phnom Penh', 'UTC+7'], clockHands: true });
const hHand = $('.hand-hour', cSvg), mHand = $('.hand-min', cSvg), sHand = $('.hand-sec', cSvg);
const cRead = $('#c-readout'), cDate = $('#c-date'), cFmt = $('#c-format');
let use24 = store.get('studytimer.24h', true);
let lastSec = -1;

const dateFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
});

function setFormatButton() {
    cFmt.textContent = use24 ? '24-hour' : '12-hour';
    cFmt.setAttribute('aria-pressed', use24);
}

function renderClock() {
    const t = new Date(Date.now() + PP_OFFSET_MS);
    const h = t.getUTCHours(), m = t.getUTCMinutes(), s = t.getUTCSeconds(), ms = t.getUTCMilliseconds();
    const sec = s + ms / 1000;

    hHand.setAttribute('transform', `rotate(${((h % 12) + m / 60 + s / 3600) * 30} 200 200)`);
    mHand.setAttribute('transform', `rotate(${(m + sec / 60) * 6} 200 200)`);
    sHand.setAttribute('transform', `rotate(${sec * 6} 200 200)`);

    if (s !== lastSec) {
        lastSec = s;
        if (use24) {
            cRead.textContent = `${pad(h)}:${pad(m)}:${pad(s)}`;
        } else {
            const h12 = h % 12 || 12;
            cRead.innerHTML = `${h12}:${pad(m)}:${pad(s)}<span class="ampm">${h < 12 ? 'AM' : 'PM'}</span>`;
        }
        cDate.textContent = dateFmt.format(new Date());
    }
}

cFmt.addEventListener('click', () => {
    use24 = !use24;
    store.set('studytimer.24h', use24);
    lastSec = -1;
    setFormatButton();
    renderClock();
});
setFormatButton();

/* ================= STOPWATCH ================= */
const swSvg = $('#sw-dial');
buildDial(swSvg, { labels: 'min', caption: ['Every lap', 'counts.'] });
const swWedge = $('.wedge', swSvg);
const swRead = $('#sw-readout'), swMain = $('#sw-main'), swLapBtn = $('#sw-lap'), swReset = $('#sw-reset'), swLaps = $('#sw-laps');

const sw = { running: false, base: 0, start: 0, laps: [] };
const swElapsed = () => sw.base + (sw.running ? performance.now() - sw.start : 0);

function fmtSW(ms) {
    const total = Math.floor(ms / 10);
    const cs = total % 100;
    const s = Math.floor(total / 100) % 60;
    const m = Math.floor(total / 6000) % 60;
    const h = Math.floor(total / 360000);
    return { main: h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`, cs: pad(cs) };
}

function renderSW() {
    const e = swElapsed();
    const f = fmtSW(e);
    swRead.innerHTML = `${f.main}<span class="cs">.${f.cs}</span>`;
    swWedge.setAttribute('d', wedgePath(118, ((e / 1000) % 60) * 6));
}

function renderLaps() {
    swLaps.innerHTML = '';
    if (!sw.laps.length) return;
    const splits = sw.laps.map(l => l.split);
    const best = Math.min(...splits), worst = Math.max(...splits);
    [...sw.laps].reverse().forEach(l => {
        const li = document.createElement('li');
        if (sw.laps.length >= 3) {
            if (l.split === best) li.className = 'best';
            else if (l.split === worst) li.className = 'worst';
        }
        const a = fmtSW(l.split), b = fmtSW(l.total);
        li.innerHTML = `<span>Lap ${l.n}</span><span>${a.main}.${a.cs}</span><span>${b.main}.${b.cs}</span>`;
        swLaps.appendChild(li);
    });
}

function swToggle() {
    if (sw.running) {
        sw.base = swElapsed();
        sw.running = false;
    } else {
        sw.start = performance.now();
        sw.running = true;
    }
    swUI();
    renderSW();
    kick();
}
function swLap() {
    if (!sw.running) return;
    const total = swElapsed();
    const prev = sw.laps.length ? sw.laps[sw.laps.length - 1].total : 0;
    sw.laps.push({ n: sw.laps.length + 1, split: total - prev, total });
    renderLaps();
}
function swClear() {
    sw.running = false; sw.base = 0; sw.laps = [];
    swUI(); renderLaps(); renderSW();
}
function swUI() {
    swMain.textContent = sw.running ? 'Pause' : (sw.base > 0 ? 'Resume' : 'Start');
    swLapBtn.disabled = !sw.running;
}

swMain.addEventListener('click', swToggle);
swLapBtn.addEventListener('click', swLap);
swReset.addEventListener('click', swClear);
swUI(); renderSW();

/* ================= TIMER (focus + break sets) ================= */
const tSvg = $('#timer-dial');
buildDial(tSvg, { labels: 'min', caption: ['One thing', 'at a time.'] });
const tWedge = $('.wedge', tSvg);
const tView = $('#view-timer');
const el = {
    phase: $('#t-phase'), sub: $('#t-sub'), read: $('#t-readout'), bar: $('#t-bar'), dots: $('#t-dots'),
    main: $('#t-main'), skip: $('#t-skip'), reset: $('#t-reset'), next: $('#t-next'), total: $('#t-total'),
    focusH: $('#focusH'), focusM: $('#focusM'), breakM: $('#breakM'), rounds: $('#rounds'),
    auto: $('#auto'), sound: $('#sound')
};

const DEFAULTS = { focusH: 1, focusM: 30, breakM: 20, rounds: 4, auto: true, sound: true };
const LIMITS = { focusH: [0, 12], focusM: [0, 59], breakM: [0, 120], rounds: [1, 12] };
let cfg = { ...DEFAULTS, ...store.get('studytimer.cfg', {}) };

const T = { phase: 'focus', round: 1, running: false, started: false, remaining: 0, total: 0, endAt: 0 };

const clampNum = (k, v) => {
    const n = parseInt(v, 10);
    if (Number.isNaN(n)) return DEFAULTS[k];
    return Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], n));
};
const focusMs = () => Math.max(1, cfg.focusH * 60 + cfg.focusM) * 60000;
const breakMs = () => cfg.breakM * 60000;

function loadPhase(phase) {
    T.phase = phase;
    T.total = phase === 'focus' ? focusMs() : breakMs();
    T.remaining = T.total;
}

function fmtDur(min) {
    const h = Math.floor(min / 60), m = min % 60;
    return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}
function fmtClock(ms) {
    const s = Math.ceil(ms / 1000);
    const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
    return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/* ---- audio / alerts ---- */
let actx;
function ensureAudio() {
    if (!cfg.sound) return;
    try {
        actx = actx || new (window.AudioContext || window.webkitAudioContext)();
        if (actx.state === 'suspended') actx.resume();
    } catch { /* ignore */ }
}
function alertUser() {
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    if (!cfg.sound || !actx) return;
    const t0 = actx.currentTime;
    [659.25, 783.99, 987.77].forEach((f, i) => {
        const o = actx.createOscillator(), g = actx.createGain(), t = t0 + i * 0.22;
        o.type = 'sine';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.25, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
        o.connect(g).connect(actx.destination);
        o.start(t);
        o.stop(t + 0.75);
    });
}

/* ---- state transitions ---- */
function tReset() {
    T.running = false; T.started = false; T.round = 1;
    loadPhase('focus');
    renderTimer();
}

function tStart() {
    ensureAudio();
    if (T.phase === 'done') tReset();
    T.started = true;
    T.running = true;
    T.endAt = performance.now() + T.remaining;
    renderTimer();
}

function tPause() {
    T.remaining = Math.max(0, T.endAt - performance.now());
    T.running = false;
    renderTimer();
}

// Move to the next part. Called when the current part has ended (or is skipped).
function advance(silent) {
    const prevEnd = T.endAt;
    if (!silent) alertUser();

    if (T.phase === 'focus') {
        if (T.round >= cfg.rounds) {
            T.phase = 'done'; T.running = false; T.remaining = 0; T.total = 0;
            return;
        }
        if (cfg.breakM > 0) loadPhase('break');
        else { T.round++; loadPhase('focus'); }
    } else {
        T.round++;
        loadPhase('focus');
    }

    if (cfg.auto) { T.running = true; T.endAt = prevEnd + T.total; }
    else { T.running = false; }
}

function tSkip() {
    if (T.phase === 'done') return;
    const was = T.running;
    T.endAt = performance.now();
    advance(true);
    if (!was) T.running = false;
    renderTimer();
}

function tick() {
    if (!T.running) return;
    const now = performance.now();
    T.remaining = T.endAt - now;
    let guard = 0;
    while (T.running && T.remaining <= 0 && guard++ < 100) {
        advance(false);
        if (T.running) T.remaining = T.endAt - now;
    }
    if (T.remaining < 0) T.remaining = 0;
    renderTimer();
}

/* ---- rendering ---- */
function renderTimer() {
    tView.dataset.phase = T.phase === 'done' ? 'focus' : T.phase;

    const label = T.phase === 'focus' ? 'Focus' : T.phase === 'break' ? 'Break' : 'All done';
    el.phase.textContent = label;
    el.sub.textContent =
        T.phase === 'done' ? `${cfg.rounds} ${cfg.rounds === 1 ? 'set' : 'sets'} completed` :
        T.phase === 'break' ? `Break after set ${T.round} of ${cfg.rounds}` :
        `Set ${T.round} of ${cfg.rounds}`;

    el.read.textContent = fmtClock(T.remaining);
    tWedge.setAttribute('d', wedgePath(118, Math.min(T.remaining / 3600000, 1) * 360));
    setCaption(tSvg,
        T.phase === 'break' ? ['Rest your eyes,', 'drink some water.'] :
        T.phase === 'done' ? ['Session', 'complete.'] :
        ['One thing', 'at a time.']);

    const prog = T.total ? (1 - T.remaining / T.total) * 100 : 100;
    el.bar.style.width = Math.min(100, Math.max(0, prog)) + '%';

    // Main button label
    el.main.textContent =
        T.phase === 'done' ? 'Start again' :
        T.running ? 'Pause' :
        T.remaining < T.total ? 'Resume' :
        T.phase === 'break' ? 'Start break' : 'Start focus';
    el.skip.disabled = T.phase === 'done';

    // Progress dots
    el.dots.innerHTML = Array.from({ length: cfg.rounds }, (_, i) => {
        const n = i + 1;
        const cls = T.phase === 'done' || n < T.round || (n === T.round && T.phase === 'break') ? 'done'
                  : n === T.round ? 'current' : '';
        return `<span class="${cls}"></span>`;
    }).join('');

    // Next-up line
    if (T.phase === 'done') el.next.textContent = 'Great work. Take a proper rest.';
    else if (T.phase === 'break') el.next.textContent = `Next: focus set ${T.round + 1} (${fmtDur(cfg.focusH * 60 + cfg.focusM || 1)})`;
    else if (T.round >= cfg.rounds) el.next.textContent = 'This is your last set.';
    else el.next.textContent = cfg.breakM > 0 ? `Next: ${cfg.breakM} min break` : 'Next: straight into the next set (no break)';

    renderTitle();
}

function renderTitle() {
    document.title = (T.running && T.phase !== 'done')
        ? `${fmtClock(T.remaining)} ${T.phase === 'focus' ? 'Focus' : 'Break'} - ${APP_TITLE}`
        : APP_TITLE;
}

function renderTotal() {
    const f = Math.max(1, cfg.focusH * 60 + cfg.focusM);
    const total = f * cfg.rounds + cfg.breakM * (cfg.rounds - 1);
    el.total.textContent =
        `Whole session: ${fmtDur(total)} (${cfg.rounds} × ${fmtDur(f)} focus` +
        (cfg.rounds > 1 && cfg.breakM ? `, ${cfg.rounds - 1} × ${fmtDur(cfg.breakM)} break)` : ')');
}

/* ---- settings ---- */
function syncInputs() {
    ['focusH', 'focusM', 'breakM', 'rounds'].forEach(k => { el[k].value = cfg[k]; });
    el.auto.checked = cfg.auto;
    el.sound.checked = cfg.sound;
    $$('.chip').forEach(c => {
        const f = +c.dataset.f;
        c.classList.toggle('on',
            f === cfg.focusH * 60 + cfg.focusM && +c.dataset.b === cfg.breakM && +c.dataset.r === cfg.rounds);
    });
}

function applyCfg() {
    store.set('studytimer.cfg', cfg);
    if (!T.started) loadPhase('focus');          // nothing running yet: update the dial straight away
    else if (T.phase === 'done') loadPhase('focus'), T.phase = 'done', T.remaining = 0, T.total = 0;
    renderTotal();
    renderTimer();
    $$('.chip').forEach(c => {
        c.classList.toggle('on',
            +c.dataset.f === cfg.focusH * 60 + cfg.focusM && +c.dataset.b === cfg.breakM && +c.dataset.r === cfg.rounds);
    });
}

['focusH', 'focusM', 'breakM', 'rounds'].forEach(k => {
    el[k].addEventListener('input', () => {
        if (el[k].value === '') return;
        cfg[k] = clampNum(k, el[k].value);
        applyCfg();
    });
    el[k].addEventListener('change', () => {
        cfg[k] = clampNum(k, el[k].value);
        if (cfg.focusH === 0 && cfg.focusM === 0) { cfg.focusM = 1; }
        syncInputs();
        applyCfg();
    });
});
el.auto.addEventListener('change', () => { cfg.auto = el.auto.checked; store.set('studytimer.cfg', cfg); });
el.sound.addEventListener('change', () => { cfg.sound = el.sound.checked; store.set('studytimer.cfg', cfg); if (cfg.sound) ensureAudio(); });

$$('.chip').forEach(c => c.addEventListener('click', () => {
    const f = +c.dataset.f;
    cfg.focusH = Math.floor(f / 60);
    cfg.focusM = f % 60;
    cfg.breakM = +c.dataset.b;
    cfg.rounds = +c.dataset.r;
    syncInputs();
    applyCfg();
}));

el.main.addEventListener('click', () => (T.running ? tPause() : tStart()));
el.skip.addEventListener('click', tSkip);
el.reset.addEventListener('click', tReset);

setInterval(tick, 100);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { tick(); kick(); } });

/* ---- keyboard: Space = start/pause, R = reset ---- */
document.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'button' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'Space') {
        e.preventDefault();
        if (active === 'stopwatch') swToggle();
        else if (active === 'timer') (T.running ? tPause() : tStart());
    } else if (e.key === 'r' || e.key === 'R') {
        if (active === 'stopwatch') swClear();
        else if (active === 'timer') tReset();
    } else if ((e.key === 'l' || e.key === 'L') && active === 'stopwatch') {
        swLap();
    }
});

/* ================= Start ================= */
cfg.focusH = clampNum('focusH', cfg.focusH);
cfg.focusM = clampNum('focusM', cfg.focusM);
cfg.breakM = clampNum('breakM', cfg.breakM);
cfg.rounds = clampNum('rounds', cfg.rounds);
if (cfg.focusH === 0 && cfg.focusM === 0) cfg.focusM = 1;

loadPhase('focus');
syncInputs();
renderTotal();
renderTimer();

const startView = location.hash.slice(1);
show(['clock', 'stopwatch', 'timer'].includes(startView) ? startView : 'clock', false);

// Place the indicator once the pixel font has loaded, then enable the slide animation
(document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(() => {
    moveIndicator();
    requestAnimationFrame(() => indicator.classList.add('ready'));
});

})();
