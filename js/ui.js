import { COMPONENTS, CATEGORIES, BY_ID } from './components.js';
import { hasAction, actionKind } from './sim.js';

const KEY = 'cesna-controls:v1';
const T = {
  en: {
    title: 'Cessna 172 / 175 Controls', sub: 'Click any part to learn its name',
    search: 'Search parts…', learned: 'learned', demonstrate: 'Show me', toggle: 'Flip switch',
    mark: 'Mark learned', unmark: 'Learned ✓', zoom: 'Zoom to it', prev: 'Previous', next: 'Next',
    views: 'Views', pilot: 'Pilot seat', panel: 'Whole panel', floor: 'Floor & pedals', copilot: 'Copilot seat',
    quiz: 'Quiz', parts: 'Parts', help: 'Help', full: 'Full screen', exitFull: 'Exit full screen',
    find: 'Find', skip: 'Skip', end: 'End quiz', correct: 'Correct!', thatIs: 'That is', tryAgain: 'Try again.',
    itWas: 'Here it is:', done: 'Quiz finished', score: 'Score', best: 'Best', again: 'Play again', close: 'Close',
    on: 'ON', off: 'OFF', surfaces: 'Control surfaces', showSurf: 'Control-surface airplane', reset: 'Reset progress',
    desc: 'Text', both: 'Both', resetConfirm: 'Clear your learned parts and quiz best score?', nothing: 'No matching parts',
    hint: 'Drag to look around · scroll or pinch to zoom · right-drag or two fingers to move',
  },
  es: {
    title: 'Controles del Cessna 172 / 175', sub: 'Toque cualquier pieza para ver su nombre',
    search: 'Buscar piezas…', learned: 'aprendidas', demonstrate: 'Muéstrame', toggle: 'Cambiar interruptor',
    mark: 'Marcar aprendida', unmark: 'Aprendida ✓', zoom: 'Acercar', prev: 'Anterior', next: 'Siguiente',
    views: 'Vistas', pilot: 'Asiento del piloto', panel: 'Panel completo', floor: 'Piso y pedales', copilot: 'Asiento del copiloto',
    quiz: 'Prueba', parts: 'Piezas', help: 'Ayuda', full: 'Pantalla completa', exitFull: 'Salir de pantalla completa',
    find: 'Encuentre', skip: 'Saltar', end: 'Terminar', correct: '¡Correcto!', thatIs: 'Eso es', tryAgain: 'Inténtelo de nuevo.',
    itWas: 'Aquí está:', done: 'Prueba terminada', score: 'Puntos', best: 'Mejor', again: 'Jugar otra vez', close: 'Cerrar',
    on: 'ENCENDIDO', off: 'APAGADO', surfaces: 'Superficies de control', showSurf: 'Avión de superficies de control', reset: 'Borrar progreso',
    desc: 'Texto', both: 'Ambos', resetConfirm: '¿Borrar las piezas aprendidas y el mejor puntaje?', nothing: 'No hay piezas que coincidan',
    hint: 'Arrastre para mirar · rueda o pellizco para acercar · clic derecho o dos dedos para mover',
  },
};

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}

export function createUI({ sim, onSelect, onFocus, onView, getCamera, setCamera, controls }) {
  const saved = load();
  const st = {
    uiLang: saved.uiLang || ((navigator.language || 'en').toLowerCase().startsWith('es') ? 'es' : 'en'),
    descLang: saved.descLang || 'both',
    learned: new Set(saved.learned || []),
    quizBest: saved.quizBest || 0,
    sidebar: saved.sidebar ?? window.innerWidth > 900,
    mini: saved.mini ?? window.innerWidth > 700,
    selected: null,
  };
  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify({
          uiLang: st.uiLang, descLang: st.descLang, learned: [...st.learned], quizBest: st.quizBest,
          sidebar: st.sidebar, mini: st.mini, lastSelected: st.selected, camera: getCamera(),
        }));
      } catch { /* storage may be unavailable; the app still works */ }
    }, 250);
  }
  const t = (k) => T[st.uiLang][k] || T.en[k] || k;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------------------------------------------------------------- sidebar
  const list = $('#list');
  const search = $('#search');
  function renderList() {
    const q = search.value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    let html = '', count = 0;
    for (const [cat, names] of Object.entries(CATEGORIES)) {
      const items = COMPONENTS.filter(c => c.cat === cat && (!q || norm(c.en).includes(q) || norm(c.es).includes(q)));
      if (!items.length) continue;
      count += items.length;
      html += `<li class="cat"><span>${esc(names.en)}</span><span class="es">${esc(names.es)}</span></li>`;
      for (const c of items) {
        html += `<li><button class="item${st.selected === c.id ? ' active' : ''}${st.learned.has(c.id) ? ' done' : ''}" data-id="${c.id}">
          <span class="nm"><span class="en">${esc(c.en)}</span><span class="es">${esc(c.es)}</span></span>
          <span class="tick" aria-hidden="true">✓</span></button></li>`;
      }
    }
    list.innerHTML = html || `<li class="empty">${t('nothing')}</li>`;
    const n = st.learned.size, total = COMPONENTS.length;
    $('#progress-text').textContent = `${n} / ${total} ${t('learned')}`;
    $('#progress-bar').style.width = `${(n / total) * 100}%`;
  }
  list.addEventListener('click', (e) => {
    const b = e.target.closest('button.item');
    if (!b) return;
    select(b.dataset.id, true);
    if (window.innerWidth < 700) setSidebar(false);
  });
  search.addEventListener('input', renderList);
  function setSidebar(open) {
    st.sidebar = open;
    document.body.classList.toggle('sidebar-open', open);
    $('#btn-parts').setAttribute('aria-pressed', String(open));
    save();
  }
  $('#btn-parts').addEventListener('click', () => setSidebar(!st.sidebar));
  $('#sidebar-close').addEventListener('click', () => setSidebar(false));

  // ---------------------------------------------------------------- info card
  const info = $('#info');
  function renderInfo() {
    const c = BY_ID[st.selected];
    if (!c) { info.hidden = true; return; }
    info.hidden = false;
    const cat = CATEGORIES[c.cat];
    const kind = hasAction(c.id) ? actionKind(c.id) : null;
    let stateTxt = '';
    if (kind === 'toggle') {
      const key = c.id === 'avmaster' ? 'avionics' : c.id === 'master' ? 'bat' : c.id;
      stateTxt = `<span class="state ${sim.state[key] ? 'on' : ''}">${sim.state[key] ? t('on') : t('off')}</span>`;
    }
    info.innerHTML = `
      <div class="info-head">
        <span class="chip">${esc(cat.en)} · ${esc(cat.es)}</span>
        <button class="icon" id="info-close" aria-label="${t('close')}" title="${t('close')} (Esc)">✕</button>
      </div>
      <h2 class="name-en" lang="en">${esc(c.en)}</h2>
      <h2 class="name-es" lang="es">${esc(c.es)}</h2>
      <div class="seg" role="group" aria-label="${t('desc')}">
        ${['en', 'es', 'both'].map(l => `<button data-l="${l}" class="${st.descLang === l ? 'on' : ''}">${l === 'both' ? t('both') : l.toUpperCase()}</button>`).join('')}
      </div>
      <div class="desc">
        ${st.descLang !== 'es' ? `<p lang="en">${esc(c.d)}</p>` : ''}
        ${st.descLang !== 'en' ? `<p lang="es" class="es">${esc(c.dEs)}</p>` : ''}
      </div>
      <div class="actions">
        ${kind ? `<button class="primary" id="act-run">${kind === 'toggle' ? '⏻ ' + t('toggle') : '▶ ' + t('demonstrate')}</button>${stateTxt}` : ''}
        <button id="act-learn" class="${st.learned.has(c.id) ? 'learned' : ''}">${st.learned.has(c.id) ? t('unmark') : t('mark')}</button>
        <button id="act-zoom">⌖ ${t('zoom')}</button>
        <span class="spacer"></span>
        <button class="icon" id="act-prev" aria-label="${t('prev')}" title="${t('prev')} (←)">‹</button>
        <button class="icon" id="act-next" aria-label="${t('next')}" title="${t('next')} (→)">›</button>
      </div>`;
    $('#info-close').onclick = () => select(null);
    info.querySelectorAll('.seg button').forEach(b => b.onclick = () => { st.descLang = b.dataset.l; save(); renderInfo(); });
    const run = $('#act-run');
    if (run) run.onclick = operate;
    $('#act-learn').onclick = toggleLearned;
    $('#act-zoom').onclick = () => onFocus(st.selected);
    $('#act-prev').onclick = () => step(-1);
    $('#act-next').onclick = () => step(1);
  }
  function operate() {
    if (!st.selected || !hasAction(st.selected)) return;
    sim.stop();
    sim.play(st.selected);
    if (actionKind(st.selected) === 'toggle') setTimeout(renderInfo, 30);
  }
  function toggleLearned() {
    if (!st.selected) return;
    if (st.learned.has(st.selected)) st.learned.delete(st.selected); else st.learned.add(st.selected);
    save(); renderInfo(); renderList();
  }
  function step(d) {
    const i = COMPONENTS.findIndex(c => c.id === st.selected);
    const n = COMPONENTS[(i + d + COMPONENTS.length) % COMPONENTS.length];
    select(n.id, true);
  }
  function select(id, focus = false) {
    if (id !== st.selected) sim.stop();
    st.selected = id;
    onSelect(id);
    renderInfo();
    renderList();
    const active = list.querySelector('.item.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
    if (id && focus) onFocus(id);
    save();
  }

  // ---------------------------------------------------------------- tooltip
  const tip = $('#tooltip');
  function hover(id, x, y) {
    if (!id || quiz) { tip.hidden = true; return; }
    const c = BY_ID[id];
    tip.innerHTML = `<span class="en">${esc(c.en)}</span><span class="es">${esc(c.es)}</span>`;
    tip.hidden = false;
    const w = tip.offsetWidth;
    tip.style.left = `${Math.min(x + 16, window.innerWidth - w - 8)}px`;
    tip.style.top = `${y + 18}px`;
  }

  // ---------------------------------------------------------------- quiz
  let quiz = null;
  const qbar = $('#quizbar');
  function startQuiz() {
    select(null);
    const pool = [...COMPONENTS].sort(() => Math.random() - 0.5).slice(0, 10);
    quiz = { pool, i: 0, score: 0, tries: 0 };
    document.body.classList.add('quizzing');
    renderQuiz();
  }
  function endQuiz() {
    quiz = null; qbar.hidden = true;
    document.body.classList.remove('quizzing');
    onSelect(null);
  }
  function renderQuiz(msg = '', cls = '') {
    if (!quiz) return;
    qbar.hidden = false;
    if (quiz.i >= quiz.pool.length) {
      if (quiz.score > st.quizBest) { st.quizBest = quiz.score; save(); }
      qbar.innerHTML = `<div class="q-main"><strong>${t('done')}</strong> · ${t('score')}: ${quiz.score} / ${quiz.pool.length} · ${t('best')}: ${st.quizBest}</div>
        <div class="q-actions"><button class="primary" id="q-again">${t('again')}</button><button id="q-end">${t('close')}</button></div>`;
      $('#q-again').onclick = startQuiz; $('#q-end').onclick = endQuiz;
      return;
    }
    const c = quiz.pool[quiz.i];
    qbar.innerHTML = `<div class="q-main"><span class="q-label">${t('find')} · Encuentre</span>
        <span class="q-en">${esc(c.en)}</span><span class="q-es">${esc(c.es)}</span></div>
      <div class="q-msg ${cls}">${msg}</div>
      <div class="q-actions"><span class="q-score">${quiz.score} / ${quiz.pool.length} · ${t('best')} ${st.quizBest}</span>
        <button id="q-skip">${t('skip')}</button><button id="q-end">${t('end')}</button></div>`;
    $('#q-skip').onclick = () => reveal();
    $('#q-end').onclick = endQuiz;
  }
  function reveal() {
    const c = quiz.pool[quiz.i];
    onSelect(c.id); onFocus(c.id);
    renderQuiz(`${t('itWas')} ${esc(c.en)} / ${esc(c.es)}`, 'bad');
    const at = quiz.i;
    setTimeout(() => { if (quiz && quiz.i === at) { quiz.i++; quiz.tries = 0; onSelect(null); renderQuiz(); } }, 2600);
  }
  function quizPick(id) {
    const c = quiz.pool[quiz.i];
    if (!c || !id) return;
    // Some parts are sub-pieces of others: accept the yoke when looking for the PTT, etc.
    if (id === c.id) {
      quiz.score += quiz.tries === 0 ? 1 : 0.5;
      onSelect(id);
      renderQuiz(`✓ ${t('correct')}`, 'good');
      const at = quiz.i;
      setTimeout(() => { if (quiz && quiz.i === at) { quiz.i++; quiz.tries = 0; onSelect(null); renderQuiz(); } }, 1300);
    } else {
      quiz.tries++;
      const w = BY_ID[id];
      if (quiz.tries >= 3) { reveal(); return; }
      renderQuiz(`${t('thatIs')} ${esc(w.en)} / ${esc(w.es)}. ${t('tryAgain')}`, 'bad');
    }
  }
  $('#btn-quiz').addEventListener('click', () => (quiz ? endQuiz() : startQuiz()));

  // ---------------------------------------------------------------- views, language, help, fullscreen
  const viewsMenu = $('#views-menu');
  $('#btn-views').addEventListener('click', (e) => { e.stopPropagation(); viewsMenu.hidden = !viewsMenu.hidden; });
  document.addEventListener('click', () => { viewsMenu.hidden = true; });
  viewsMenu.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.view) onView(b.dataset.view);
    if (b.dataset.toggle === 'mini') { st.mini = !st.mini; applyMini(); save(); }
    if (b.dataset.toggle === 'reset') {
      if (confirm(t('resetConfirm'))) { st.learned.clear(); st.quizBest = 0; save(); renderList(); renderInfo(); }
    }
  });
  $('#btn-lang').addEventListener('click', () => { st.uiLang = st.uiLang === 'en' ? 'es' : 'en'; save(); renderChrome(); });
  const help = $('#help');
  $('#btn-help').addEventListener('click', () => { help.hidden = false; });
  help.addEventListener('click', (e) => { if (e.target === help || e.target.closest('[data-close]')) help.hidden = true; });
  $('#btn-full').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  });
  document.addEventListener('fullscreenchange', renderChrome);

  const miniEl = $('#mini');
  function applyMini() {
    miniEl.hidden = !st.mini;
    viewsMenu.querySelector('[data-toggle=mini]').classList.toggle('checked', st.mini);
  }
  $('#mini-close').addEventListener('click', () => { st.mini = false; applyMini(); save(); });

  function renderChrome() {
    document.documentElement.lang = st.uiLang;
    $('#title').textContent = t('title');
    $('#subtitle').textContent = t('sub');
    search.placeholder = t('search');
    $('#btn-parts .lbl').textContent = t('parts');
    $('#btn-quiz .lbl').textContent = t('quiz');
    $('#btn-views .lbl').textContent = t('views');
    $('#btn-help .lbl').textContent = t('help');
    $('#btn-lang .lbl').textContent = st.uiLang === 'en' ? 'Español' : 'English';
    $('#btn-full').title = document.fullscreenElement ? t('exitFull') : t('full');
    $('#btn-full .lbl').textContent = document.fullscreenElement ? t('exitFull') : t('full');
    for (const v of ['pilot', 'panel', 'floor', 'copilot']) viewsMenu.querySelector(`[data-view=${v}]`).textContent = t(v);
    viewsMenu.querySelector('[data-toggle=mini]').textContent = t('showSurf');
    viewsMenu.querySelector('[data-toggle=reset]').textContent = t('reset');
    $('#mini-title').textContent = `${T.en.surfaces} · ${T.es.surfaces}`;
    $('#hint').textContent = t('hint');
    renderList(); renderInfo(); renderQuiz();
  }

  // ---------------------------------------------------------------- keyboard
  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea')) { if (e.key === 'Escape') e.target.blur(); return; }
    if (e.key === 'Escape') { if (!help.hidden) help.hidden = true; else if (quiz) endQuiz(); else select(null); }
    else if (e.key === 'ArrowRight' && st.selected) step(1);
    else if (e.key === 'ArrowLeft' && st.selected) step(-1);
    else if (e.key === ' ' && st.selected) { e.preventDefault(); operate(); }
    else if (e.key.toLowerCase() === 'l' && st.selected) toggleLearned();
    else if (e.key.toLowerCase() === 'f' && st.selected) onFocus(st.selected);
    else if (e.key === '/') { e.preventDefault(); setSidebar(true); search.focus(); }
  });

  controls.addEventListener('end', save);

  // ---------------------------------------------------------------- init
  document.body.classList.toggle('sidebar-open', st.sidebar);
  applyMini();
  renderChrome();
  if (saved.camera && Array.isArray(saved.camera.pos)) setCamera(saved.camera);
  if (saved.lastSelected && BY_ID[saved.lastSelected]) select(saved.lastSelected, false);
  setTimeout(() => $('#hint').classList.add('fade'), 7000);

  let lastToggleState = '';
  return {
    get selected() { return st.selected; },
    get miniVisible() { return st.mini && !miniEl.hidden; },
    miniRect() { const r = miniEl.querySelector('.mini-view').getBoundingClientRect(); return r.width > 0 ? r : null; },
    picked(id) {
      if (quiz) { quizPick(id); return; }
      select(id, false);
    },
    hover,
    saveCamera: save,
    tick() {
      // Keep the ON/OFF badge in sync when a switch changes.
      if (st.selected && hasAction(st.selected) && actionKind(st.selected) === 'toggle') {
        const s = sim.state;
        const k = `${s.bat}${s.avionics}${s.sw_beacon}${s.sw_land}${s.sw_taxi}${s.sw_nav}${s.sw_strobe}${s.sw_pitot}`;
        if (k !== lastToggleState) { lastToggleState = k; renderInfo(); }
      }
    },
  };
}
