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
const VIEWS = ['clock', 'stopwatch', 'timer', 'sound'];

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

    const captionSvg = `<text class="caption" x="200" y="${clockHands ? 290 : 274}" text-anchor="middle">${
        caption.map((l, i) => `<tspan class="cap-line" x="200" dy="${i ? 22 : 0}">${l}</tspan>`).join('')
    }</text>`;

    if (clockHands) {
        // Hands first, then the knob, then numbers and the city name on top so they stay readable
        s += '<line class="hand hand-hour" x1="200" y1="200" x2="200" y2="130"/>';
        s += '<line class="hand hand-min" x1="200" y1="200" x2="200" y2="86"/>';
        s += '<line class="hand hand-sec" x1="200" y1="214" x2="200" y2="84"/>';
        s += '<circle class="knob" cx="200" cy="200" r="26"/><circle class="knob-dot" cx="200" cy="200" r="4"/>';
        for (let h = 1; h <= 12; h++) {
            const [x, y] = polar(145, h * 30);
            s += `<text class="num hour" x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" dominant-baseline="central">${h}</text>`;
        }
        s += captionSvg;
    } else {
        for (let m = 0; m < 60; m += 5) {
            const [x, y] = polar(142, m * 6);
            s += `<text class="num" x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" dominant-baseline="central">${m}</text>`;
        }
        s += '<path class="wedge" d=""/>';
        s += captionSvg;
        s += '<circle class="knob" cx="200" cy="200" r="26"/><circle class="knob-dot" cx="200" cy="200" r="4"/>';
    }

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
    if (name !== 'sound') stopPreview();
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
buildDial(cSvg, { labels: 'hour', caption: ['Phnom Penh'], clockHands: true });
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

/* ================= SETTINGS (shared by timer + sounds) ================= */
const DEFAULTS = {
    sessionH: 1, sessionM: 30, breakM: 20, rounds: 2,
    auto: true, sound: true,
    soundId: 'builtin', volume: 80, ringFor: 10
};
const LIMITS = { sessionH: [0, 12], sessionM: [0, 59], breakM: [0, 120], rounds: [1, 12] };
let cfg = { ...DEFAULTS, ...store.get('studytimer.cfg2', {}) };
const saveCfg = () => store.set('studytimer.cfg2', cfg);

const clampNum = (k, v) => {
    const n = parseInt(v, 10);
    if (Number.isNaN(n)) return DEFAULTS[k];
    return Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], n));
};

// One session = focus + break. Focus time is calculated: session length - break.
function getPlan() {
    const session = Math.max(1, cfg.sessionH * 60 + cfg.sessionM);
    const brk = Math.min(cfg.breakM, session - 1);
    return { session, brk, focus: session - brk };
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

/* ================= SOUNDS ================= */
const snd = {
    list: $('#snd-list'), file: $('#snd-file'), msg: $('#snd-msg'),
    vol: $('#snd-vol'), len: $('#snd-len')
};
let sounds = [];            // user files: { id, name, blob }
let dbOK = true;
const urlCache = {};
const alarmEl = new Audio();
alarmEl.preload = 'auto';
let playingId = null, stopTimer = 0, ringing = false, previewing = false;
let actx;

/* -- tiny IndexedDB wrapper (so big files are saved on the device) -- */
function dbOpen() {
    return new Promise((res, rej) => {
        if (!window.indexedDB) return rej(new Error('no indexedDB'));
        const r = indexedDB.open('studytimer', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('sounds', { keyPath: 'id' });
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
    });
}
async function dbRun(mode, fn) {
    const db = await dbOpen();
    return new Promise((res, rej) => {
        const tx = db.transaction('sounds', mode);
        const req = fn(tx.objectStore('sounds'));
        tx.oncomplete = () => res(req && req.result);
        tx.onerror = () => rej(tx.error);
    });
}

async function loadSounds() {
    try { sounds = (await dbRun('readonly', s => s.getAll())) || []; }
    catch { dbOK = false; sounds = []; }
    if (cfg.soundId !== 'builtin' && !sounds.some(s => s.id === cfg.soundId)) { cfg.soundId = 'builtin'; saveCfg(); }
    renderSounds();
}

const selectedRec = () => sounds.find(s => s.id === cfg.soundId) || null;
const urlFor = rec => urlCache[rec.id] || (urlCache[rec.id] = URL.createObjectURL(rec.blob));

function say(text) { snd.msg.textContent = text; }

async function addSound(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const isMp3 = ext === 'mp3' && (
        file.type === 'audio/mpeg' ||
        file.type === 'audio/mp3' ||
        file.type === 'application/octet-stream' ||
        file.type === ''
    );

    if (!isMp3) {
        say('Only MP3 files are accepted. Please choose a file ending in .mp3.');
        return;
    }

    if (file.size > 40 * 1024 * 1024) {
        say('That MP3 is larger than 40 MB. Please choose a smaller file.');
        return;
    }

    const mp3Blob = file.type === 'audio/mpeg'
        ? file
        : new Blob([file], { type: 'audio/mpeg' });

    const testUrl = URL.createObjectURL(mp3Blob);
    const playable = await new Promise(resolve => {
        const audio = document.createElement('audio');
        let finished = false;

        const finish = result => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            audio.pause();
            audio.removeAttribute('src');
            audio.load();
            URL.revokeObjectURL(testUrl);
            resolve(result);
        };

        const timer = setTimeout(() => finish(false), 8000);
        audio.preload = 'metadata';
        audio.onloadedmetadata = () => {
            finish(Number.isFinite(audio.duration) && audio.duration > 0);
        };
        audio.onerror = () => finish(false);
        audio.src = testUrl;
        audio.load();
    });

    if (!playable) {
        say('This MP3 cannot be played by this browser. Please choose another MP3 file.');
        return;
    }

    const rec = {
        id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: file.name.replace(/\.[^.]+$/, ''),
        blob: mp3Blob,
        type: 'audio/mpeg',
        ext: 'mp3'
    };

    sounds.push(rec);

    if (dbOK) {
        try {
            await dbRun('readwrite', store => store.put(rec));
        } catch {
            dbOK = false;
        }
    }

    cfg.soundId = rec.id;
    saveCfg();
    renderSounds();
    say(`${file.name} is ready and selected.`);
}

function renderSounds() {
    snd.list.innerHTML = '';
    const rows = [{ id: 'builtin', name: 'Soft chime', sub: 'Built in' },
        ...sounds.map(s => ({ id: s.id, name: s.name, sub: 'Your file', custom: true }))];

    rows.forEach(r => {
        const li = document.createElement('li');
        li.className = cfg.soundId === r.id ? 'on' : '';

        const label = document.createElement('label');
        const radio = document.createElement('input');
        radio.type = 'radio'; radio.name = 'alarm'; radio.checked = cfg.soundId === r.id;
        radio.addEventListener('change', () => { cfg.soundId = r.id; saveCfg(); renderSounds(); });
        const nm = document.createElement('span');
        nm.className = 'sound-name';
        const a = document.createElement('span'); a.textContent = r.name;
        const b = document.createElement('small'); b.textContent = r.sub;
        nm.append(a, b);
        label.append(radio, nm);

        const play = document.createElement('button');
        play.type = 'button';
        play.className = 'btn small';
        play.textContent = playingId === r.id ? 'Stop' : 'Play';
        play.addEventListener('click', () => (playingId === r.id ? stopPreview() : previewSound(r.id)));

        li.append(label, play);
        if (r.custom) {
            const del = document.createElement('button');
            del.type = 'button';
            del.className = 'btn small';
            del.textContent = 'Remove';
            del.setAttribute('aria-label', 'Remove ' + r.name);
            del.addEventListener('click', () => removeSound(r.id));
            li.append(del);
        }
        snd.list.appendChild(li);
    });

    snd.vol.value = cfg.volume;
    snd.len.value = String(cfg.ringFor);
}

/* -- playback -- */
function ensureAudio() {
    try {
        actx = actx || new (window.AudioContext || window.webkitAudioContext)();
        if (actx.state === 'suspended') actx.resume();
    } catch { /* ignore */ }
}

function chime() {
    ensureAudio();
    if (!actx) return;
    const t0 = actx.currentTime, vol = (cfg.volume / 100) * 0.4;
    [659.25, 783.99, 987.77].forEach((f, i) => {
        const o = actx.createOscillator(), g = actx.createGain(), t = t0 + i * 0.22;
        o.type = 'sine';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(Math.max(0.0002, vol), t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
        o.connect(g).connect(actx.destination);
        o.start(t);
        o.stop(t + 0.75);
    });
}

function stopSound() {
    clearTimeout(stopTimer);
    try { alarmEl.pause(); alarmEl.currentTime = 0; } catch { /* ignore */ }
    playingId = null;
    previewing = false;
    setRinging(false);
}

function playRecord(id) {
    stopSound();
    const rec = sounds.find(s => s.id === id);
    if (!rec) { chime(); return false; }
    alarmEl.src = urlFor(rec);
    alarmEl.muted = false;
    alarmEl.loop = false;
    alarmEl.volume = cfg.volume / 100;
    const p = alarmEl.play();
    playingId = id;
    if (cfg.ringFor > 0) stopTimer = setTimeout(stopSound, cfg.ringFor * 1000);
    if (p && p.catch) p.catch(() => { playingId = null; chime(); renderSounds(); });
    return true;
}

alarmEl.addEventListener('ended', () => { playingId = null; previewing = false; setRinging(false); renderSounds(); });

function previewSound(id) {
    if (id === 'builtin') { stopSound(); chime(); return; }
    playRecord(id);
    previewing = true;
    renderSounds();
}
function stopPreview() { if (previewing) { stopSound(); renderSounds(); } }

// Browsers only allow sound after a tap. Call this from the Start button to "unlock" it.
function primeAlarm() {
    ensureAudio();
    const rec = selectedRec();
    if (!rec) return;
    try {
        alarmEl.src = urlFor(rec);
        alarmEl.muted = true;
        const p = alarmEl.play();
        if (p && p.then) p.then(() => { alarmEl.pause(); alarmEl.currentTime = 0; alarmEl.muted = false; })
                          .catch(() => { alarmEl.muted = false; });
    } catch { /* ignore */ }
}

function ringAlarm() {
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    if (!cfg.sound) return;
    const rec = selectedRec();
    if (rec) { playRecord(rec.id); setRinging(true); }
    else chime();
}

snd.file.addEventListener('change', async () => {
    const f = snd.file.files && snd.file.files[0];
    snd.file.value = '';
    if (f) await addSound(f);
});
snd.vol.addEventListener('input', () => {
    cfg.volume = +snd.vol.value; saveCfg();
    alarmEl.volume = cfg.volume / 100;
});
snd.vol.addEventListener('change', () => { if (!playingId) previewSound(cfg.soundId); });
snd.len.addEventListener('change', () => { cfg.ringFor = +snd.len.value; saveCfg(); });

/* ================= TIMER (sessions = focus + break) ================= */
const tSvg = $('#timer-dial');
buildDial(tSvg, { labels: 'min', caption: ['One thing', 'at a time.'] });
const tWedge = $('.wedge', tSvg);
const tView = $('#view-timer');
const el = {
    phase: $('#t-phase'), sub: $('#t-sub'), read: $('#t-readout'), bar: $('#t-bar'), dots: $('#t-dots'),
    main: $('#t-main'), skip: $('#t-skip'), reset: $('#t-reset'), stopAlarm: $('#t-stopalarm'),
    next: $('#t-next'), total: $('#t-total'), calc: $('#t-calc'),
    sessionH: $('#sessionH'), sessionM: $('#sessionM'), breakM: $('#breakM'), rounds: $('#rounds'),
    auto: $('#auto'), sound: $('#sound')
};

const T = { phase: 'focus', round: 1, running: false, started: false, remaining: 0, total: 0, endAt: 0 };

function loadPhase(phase) {
    const plan = getPlan();
    T.phase = phase;
    T.total = (phase === 'focus' ? plan.focus : plan.brk) * 60000;
    T.remaining = T.total;
}

function setRinging(on) {
    ringing = on;
    el.stopAlarm.hidden = !on;
}

/* ---- state transitions ---- */
function tReset() {
    stopSound();
    T.running = false; T.started = false; T.round = 1;
    loadPhase('focus');
    renderTimer();
}

function tStart() {
    stopSound();
    primeAlarm();
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

function finish() {
    T.phase = 'done'; T.running = false; T.remaining = 0; T.total = 0;
}

// Move to the next part. Called when the current part has ended (or is skipped).
function advance(silent) {
    const prevEnd = T.endAt;
    const plan = getPlan();
    if (!silent) ringAlarm();

    if (T.phase === 'focus' && plan.brk > 0) {
        loadPhase('break');
    } else if (T.round >= cfg.rounds) {
        finish();
        return;
    } else {
        T.round++;
        loadPhase('focus');
    }

    if (cfg.auto) { T.running = true; T.endAt = prevEnd + T.total; }
    else { T.running = false; }
}

function tSkip() {
    if (T.phase === 'done') return;
    stopSound();
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
    const plan = getPlan();
    tView.dataset.phase = T.phase === 'done' ? 'focus' : T.phase;

    el.phase.textContent = T.phase === 'focus' ? 'Focus' : T.phase === 'break' ? 'Break' : 'All done';
    el.sub.textContent =
        T.phase === 'done' ? `${cfg.rounds} ${cfg.rounds === 1 ? 'session' : 'sessions'} completed` :
        T.phase === 'break' ? `Break, session ${T.round} of ${cfg.rounds}` :
        `Session ${T.round} of ${cfg.rounds}`;

    el.read.textContent = fmtClock(T.remaining);
    tWedge.setAttribute('d', wedgePath(118, Math.min(T.remaining / 3600000, 1) * 360));
    setCaption(tSvg,
        T.phase === 'break' ? ['Rest your eyes,', 'drink some water.'] :
        T.phase === 'done' ? ['Session', 'complete.'] :
        ['One thing', 'at a time.']);

    const prog = T.total ? (1 - T.remaining / T.total) * 100 : 100;
    el.bar.style.width = Math.min(100, Math.max(0, prog)) + '%';

    el.main.textContent =
        T.phase === 'done' ? 'Start again' :
        T.running ? 'Pause' :
        T.remaining < T.total ? 'Resume' :
        T.phase === 'break' ? 'Start break' : 'Start focus';
    el.skip.disabled = T.phase === 'done';

    el.dots.innerHTML = Array.from({ length: cfg.rounds }, (_, i) => {
        const n = i + 1;
        const cls = T.phase === 'done' || n < T.round ? 'done' : n === T.round ? 'current' : '';
        return `<span class="${cls}"></span>`;
    }).join('');

    if (T.phase === 'done') el.next.textContent = 'Great work. Take a proper rest.';
    else if (T.phase === 'break') el.next.textContent = T.round >= cfg.rounds
        ? 'Last break of your plan. Almost there.'
        : `Next: session ${T.round + 1}, ${fmtDur(plan.focus)} of focus`;
    else if (plan.brk > 0) el.next.textContent = `Next: ${fmtDur(plan.brk)} break`;
    else el.next.textContent = T.round >= cfg.rounds ? 'This is your last session.' : `Next: session ${T.round + 1}`;

    renderTitle();
}

function renderTitle() {
    document.title = (T.running && T.phase !== 'done')
        ? `${fmtClock(T.remaining)} ${T.phase === 'focus' ? 'Focus' : 'Break'} - ${APP_TITLE}`
        : APP_TITLE;
}

function renderPlan() {
    const plan = getPlan();
    el.calc.innerHTML = plan.brk > 0
        ? `Focus <b>${fmtDur(plan.focus)}</b> + break <b>${fmtDur(plan.brk)}</b> = <b>${fmtDur(plan.session)}</b> per session`
        : `Focus <b>${fmtDur(plan.focus)}</b> with no break`;
    if (cfg.breakM > plan.brk) el.calc.innerHTML += '<br>Your break was shortened so it fits inside the session.';

    el.total.textContent = `Whole plan: ${fmtDur(plan.session * cfg.rounds)} (${cfg.rounds} × ${fmtDur(plan.session)})`;

    $$('.chip').forEach(c => {
        c.classList.toggle('on',
            +c.dataset.s === plan.session && +c.dataset.b === plan.brk && +c.dataset.r === cfg.rounds);
    });
}

function syncInputs() {
    ['sessionH', 'sessionM', 'breakM', 'rounds'].forEach(k => { el[k].value = cfg[k]; });
    el.auto.checked = cfg.auto;
    el.sound.checked = cfg.sound;
}

function applyCfg() {
    saveCfg();
    if (!T.started) loadPhase('focus');   // nothing running yet: update the dial straight away
    renderPlan();
    renderTimer();
}

['sessionH', 'sessionM', 'breakM', 'rounds'].forEach(k => {
    el[k].addEventListener('input', () => {
        if (el[k].value === '') return;
        cfg[k] = clampNum(k, el[k].value);
        applyCfg();
    });
    el[k].addEventListener('change', () => {
        cfg[k] = clampNum(k, el[k].value);
        if (cfg.sessionH === 0 && cfg.sessionM === 0) cfg.sessionM = 1;
        cfg.breakM = getPlan().brk;           // keep the break inside the session
        syncInputs();
        applyCfg();
    });
});
el.auto.addEventListener('change', () => { cfg.auto = el.auto.checked; saveCfg(); });
el.sound.addEventListener('change', () => { cfg.sound = el.sound.checked; saveCfg(); });

$$('.chip').forEach(c => c.addEventListener('click', () => {
    const s = +c.dataset.s;
    cfg.sessionH = Math.floor(s / 60);
    cfg.sessionM = s % 60;
    cfg.breakM = +c.dataset.b;
    cfg.rounds = +c.dataset.r;
    syncInputs();
    applyCfg();
}));

el.main.addEventListener('click', () => (T.running ? tPause() : tStart()));
el.skip.addEventListener('click', tSkip);
el.reset.addEventListener('click', tReset);
el.stopAlarm.addEventListener('click', () => { stopSound(); renderSounds(); });

setInterval(tick, 100);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { tick(); kick(); } });

/* ---- keyboard: Space = start/pause, R = reset, L = lap ---- */
document.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (['input', 'button', 'select', 'label'].includes(tag) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'Space') {
        if (active === 'stopwatch') { e.preventDefault(); swToggle(); }
        else if (active === 'timer') { e.preventDefault(); T.running ? tPause() : tStart(); }
    } else if (e.key === 'r' || e.key === 'R') {
        if (active === 'stopwatch') swClear();
        else if (active === 'timer') tReset();
    } else if ((e.key === 'l' || e.key === 'L') && active === 'stopwatch') {
        swLap();
    }
});

/* ================= Start ================= */
cfg.sessionH = clampNum('sessionH', cfg.sessionH);
cfg.sessionM = clampNum('sessionM', cfg.sessionM);
cfg.breakM   = clampNum('breakM', cfg.breakM);
cfg.rounds   = clampNum('rounds', cfg.rounds);
cfg.volume   = Math.min(100, Math.max(0, +cfg.volume || 0));
if (cfg.sessionH === 0 && cfg.sessionM === 0) cfg.sessionM = 1;
cfg.breakM = getPlan().brk;

loadPhase('focus');
syncInputs();
renderPlan();
renderTimer();
renderSounds();
loadSounds();

const startView = location.hash.slice(1);
show(VIEWS.includes(startView) ? startView : 'clock', false);

// Place the indicator once the pixel font has loaded, then enable the slide animation
(document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(() => {
    moveIndicator();
    requestAnimationFrame(() => indicator.classList.add('ready'));
});

})();
