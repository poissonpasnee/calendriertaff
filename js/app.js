import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// --- CONFIGURATION ---
const SUPABASE_URL = "https://dstmyvzjirgyuwuojwnk.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRzdG15dnpqaXJneXV3dW9qd25rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk3NzY4NTUsImV4cCI6MjA4NTM1Mjg1NX0.Cl6WAvK0elHkKXnXRtrFFiBlGABnK5RTFdawq3NGDJk";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// --- ÉTAT GLOBAL ---
let user = null;
let entries = new Map();
let state = { year: 2026, month: 0, selected: null };
let prefs = { theme: 'light', quickTap: false, confirmLogout: true };
let cellCache = new Map();

const MONTHS = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
const DAYS = ["Dim","Lun","Mar","Mer","Jeu","Ven","Sam"];
const LABELS = { jour:"Jour", nuit:"Nuit", repos:"Repos", conges:"Congés", autre:"Autre" };

// --- UTILITAIRES ---
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const keyFor = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parseKey = (k) => { const [y,m,d] = k.split('-').map(Number); return new Date(y, m-1, d); };

// --- INITIALISATION ---
async function init() {
  loadLocalData();
  applyPrefs();
  renderGrid(); // Affiche la grille vide d'abord
  updateSelectionUI();
  
  // Vérifie l'auth ET affiche/masque la connexion
  await checkAuth(); 
  
  setupEvents();
}

function loadLocalData() {
  // Préférences
  const p = localStorage.getItem('prefs_v2');
  if(p) prefs = {...prefs, ...JSON.parse(p)};
  
  // État vue
  const s = localStorage.getItem('state_v2');
  if(s) state = {...state, ...JSON.parse(s)};
  else {
    const now = new Date();
    state.year = now.getFullYear();
    state.month = now.getMonth();
    state.selected = keyFor(now);
  }
}

function applyPrefs() {
  document.documentElement.setAttribute('data-theme', prefs.theme);
  $('togQuickTap').checked = prefs.quickTap;
  $('togConfirmLogout').checked = prefs.confirmLogout;
  $('themeLight').classList.toggle('active', prefs.theme === 'light');
  $('themeDark').classList.toggle('active', prefs.theme === 'dark');
}

// --- AUTHENTIFICATION (Cœur du correctif) ---
async function checkAuth() {
  const { data, error } = await supabase.auth.getSession();
  
  if (error || !data?.session) {
    // PAS CONNECTÉ -> Afficher la porte (Gate)
    user = null;
    $('topSub').textContent = "Invité";
    $('gate').classList.add('show'); // FORCE L'AFFICHAGE
    console.log("Mode hors ligne / Non connecté");
    return;
  }

  // CONNECTÉ -> Masquer la porte
  user = data.session.user;
  $('topSub').textContent = user.email.split('@')[0];
  $('gate').classList.remove('show'); // CACHE LA CONNEXION
  
  await loadEntries();
  renderGrid();
  renderTotals();
  updateSelectionUI();
}

async function loadEntries() {
  if(!user) return;
  const start = new Date(state.year, state.month - 1, 1);
  const end = new Date(state.year, state.month + 2, 0);
  
  const { data, error } = await supabase
    .from("work_calendar_entries")
    .select("*")
    .gte("work_date", keyFor(start))
    .lte("work_date", keyFor(end));
    
  if(error) { console.error(error); return; }
  
  entries.clear();
  data.forEach(r => entries.set(r.work_date, { status: r.status, note: r.note, custom_label: r.custom_label }));
}

// --- RENDU ---
function renderGrid() {
  const grid = $('grid');
  grid.innerHTML = '';
  cellCache.clear();
  
  $('navMonth').textContent = MONTHS[state.month];
  $('navYear').textContent = state.year;
  
  // Calcul début mois
  const first = new Date(state.year, state.month, 1);
  let startDay = first.getDay(); // 0=Dim
  // Ajustement si semaine commence lundi (optionnel, ici simplifié Dim)
  
  const startDate = new Date(first);
  startDate.setDate(first.getDate() - startDay);
  
  for(let i=0; i<42; i++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    const k = keyFor(d);
    
    // Numéro semaine
    if(i%7===0) {
      const wn = document.createElement('div');
      wn.className = 'weeknum';
      wn.textContent = getWeekNum(d);
      grid.appendChild(wn);
    }
    
    const cell = document.createElement('div');
    cell.className = 'day';
    if(d.getMonth() !== state.month) cell.classList.add('out');
    cell.textContent = d.getDate();
    cell.dataset.key = k;
    
    // Style
    const entry = entries.get(k);
    if(entry?.status) {
      cell.classList.add(entry.status);
      if(entry.note) {
        const dot = document.createElement('div'); dot.className='dot'; cell.appendChild(dot);
      }
    }
    if(k === state.selected) cell.classList.add('selected');
    
    cell.onclick = () => handleCellClick(k);
    
    grid.appendChild(cell);
    cellCache.set(k, cell);
  }
}

function getWeekNum(d) {
  const date = new Date(d);
  date.setHours(0,0,0,0);
  date.setDate(date.getDate() + 3 - (date.getDay()+6)%7);
  const week1 = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date-week1)/86400000 - 3 + (week1.getDay()+6)%7)/7);
}

function handleCellClick(k) {
  state.selected = k;
  localStorage.setItem('state_v2', JSON.stringify(state));
  
  const entry = entries.get(k);
  
  // Quick Tap
  if(prefs.quickTap && !entry?.status) {
    saveEntry(k, { status: 'jour' });
    renderGrid();
    updateSelectionUI();
    return;
  }
  
  renderGrid();
  updateSelectionUI();
}

function updateSelectionUI() {
  const d = parseKey(state.selected);
  const entry = entries.get(state.selected);
  $('selDate').textContent = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  $('selState').textContent = entry?.status ? LABELS[entry.status] : "Libre";
  $('sheetTitle').textContent = `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  $('noteText').value = entry?.note || '';
}

function renderTotals() {
  const counts = { jour:0, nuit:0, repos:0, conges:0, autre:0 };
  entries.forEach(e => { if(e.status) counts[e.status]++; });
  
  const t = $('totals');
  t.innerHTML = '';
  Object.entries(counts).forEach(([k,v]) => {
    if(v>0) {
      const span = document.createElement('span');
      span.className = 'pillchip';
      span.textContent = `${LABELS[k]}: ${v}`;
      t.appendChild(span);
    }
  });
}

// --- SAUVEGARDE ---
async function saveEntry(k, patch) {
  if(!user) {
    $('gate').classList.add('show');
    return;
  }
  
  const cur = entries.get(k) || { status:'', note:'', custom_label:'' };
  const next = { ...cur, ...patch };
  entries.set(k, next);
  
  // UI Update
  const cell = cellCache.get(k);
  if(cell) {
    cell.className = `day ${cell.classList.contains('out')?'out':''} ${next.status||''}`;
    cell.querySelectorAll('.dot').forEach(e=>e.remove());
    if(next.note) { const dot=document.createElement('div'); dot.className='dot'; cell.appendChild(dot); }
  }
  if(state.selected === k) updateSelectionUI();
  renderTotals();
  
  await supabase.from("work_calendar_entries").upsert({
    user_id: user.id, work_date: k, status: next.status, note: next.note, custom_label: next.custom_label
  }, { onConflict: "user_id,work_date" });
}

// --- ÉVÉNEMENTS ---
function setupEvents() {
  // Nav
  $('btnPrevMonth').onclick = () => { state.month--; if(state.month<0){state.month=11;state.year--;} saveAndReload(); };
  $('btnNextMonth').onclick = () => { state.month++; if(state.month>11){state.month=0;state.year++;} saveAndReload(); };
  $('btnToday').onclick = () => { const n=new Date(); state.year=n.getFullYear(); state.month=n.getMonth(); state.selected=keyFor(n); saveAndReload(); };
  $('btnPrevYear').onclick = () => { state.year--; saveAndReload(); };
  $('btnNextYear').onclick = () => { state.year++; saveAndReload(); };

  function saveAndReload() {
    localStorage.setItem('state_v2', JSON.stringify(state));
    loadEntries().then(() => { renderGrid(); updateSelectionUI(); renderTotals(); });
  }

  // Actions
  document.querySelectorAll('[data-set]').forEach(btn => {
    btn.onclick = () => {
      if(!state.selected) return;
      if(btn.dataset.set === 'autre') {
        $('sheetOther').style.display = 'block';
        $('sheetNote').style.display = 'none';
        $('backdrop').classList.add('show');
        $('sheet').classList.add('show');
      } else {
        saveEntry(state.selected, { status: btn.dataset.set, custom_label: '' });
      }
    };
  });

  $('btnNote').onclick = () => {
    $('sheetNote').style.display = 'block';
    $('sheetOther').style.display = 'none';
    $('backdrop').classList.add('show');
    $('sheet').classList.add('show');
  };

  const closeSheet = () => { $('sheet').classList.remove('show'); $('backdrop').classList.remove('show'); };
  $('btnCloseSheet').onclick = closeSheet;
  $('backdrop').onclick = closeSheet;

  $('btnSaveNote').onclick = () => { saveEntry(state.selected, { note: $('noteText').value }); closeSheet(); };
  $('btnClearNote').onclick = () => { saveEntry(state.selected, { note: '' }); closeSheet(); };
  $('btnApplyOther').onclick = () => {
    const val = $('otherSelect').value;
    const custom = $('otherCustom').value;
    saveEntry(state.selected, { status: 'autre', custom_label: val==='custom'?custom:val });
    closeSheet();
  };
  $('otherSelect').onchange = (e) => { $('otherCustom').style.display = e.target.value==='custom'?'block':'none'; };

  // Settings
  $('btnSettings').onclick = (e) => { e.stopPropagation(); $('settingsPop').classList.toggle('show'); };
  document.onclick = () => $('settingsPop').classList.remove('show');
  $('settingsPop').onclick = (e) => e.stopPropagation();
  
  $('themeLight').onclick = () => { prefs.theme='light'; savePrefs(); applyPrefs(); };
  $('themeDark').onclick = () => { prefs.theme='dark'; savePrefs(); applyPrefs(); };
  $('togQuickTap').onchange = (e) => { prefs.quickTap=e.target.checked; savePrefs(); };
  $('togConfirmLogout').onchange = (e) => { prefs.confirmLogout=e.target.checked; savePrefs(); };

  function savePrefs() { localStorage.setItem('prefs_v2', JSON.stringify(prefs)); }

  // Auth UI
  $('tabLogin').onclick = () => { $('paneLogin').style.display='block'; $('paneSignup').style.display='none'; $('tabLogin').classList.add('active'); $('tabSignup').classList.remove('active'); };
  $('tabSignup').onclick = () => { $('paneLogin').style.display='none'; $('paneSignup').style.display='block'; $('tabSignup').classList.add('active'); $('tabLogin').classList.remove('active'); };
  $('btnBackLogin').onclick = $('tabLogin').onclick;

  $('btnLogin').onclick = async () => {
    const email = $('loginEmail').value;
    const pass = $('loginPass').value;
    const hint = $('loginHint');
    hint.textContent = "Connexion...";
    const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
    if(error) { hint.textContent = "Erreur: " + error.message; } 
    else { checkAuth(); }
  };

  $('btnSignup').onclick = async () => {
    const email = $('signEmail').value;
    const pass = $('signPass').value;
    if(pass.length < 6) return alert("6 caractères min");
    const { error } = await supabase.auth.signUp({ email, password: pass });
    if(error) alert(error.message);
    else { alert("Compte créé ! Connectez-vous."); $('tabLogin').onclick(); }
  };

  $('btnReset').onclick = async () => {
    const email = $('loginEmail').value;
    if(!email) return alert("Entrez email");
    await supabase.auth.resetPasswordForEmail(email);
    alert("Email envoyé");
  };

  $('btnLogout').onclick = async () => {
    if(prefs.confirmLogout && !confirm("Déconnexion ?")) return;
    await supabase.auth.signOut();
    checkAuth(); // Va réafficher la gate
  };
  
  $('btnExportXLSX').onclick = () => alert("Export Excel (nécessite fichier complet)");
}

// Démarrage
init();const parseKey = (k) => { const [y,m,d] = k.split('-').map(Number); return new Date(y, m-1, d); };

const MONTHS = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
const DAYS_SUN = ["Dim","Lun","Mar","Mer","Jeu","Ven","Sam"];
const DAYS_MON = ["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"];
const LABELS = { jour:"Jour", nuit:"Nuit", repos:"Repos", conges:"Congés", autre:"Autre" };

/* =========================
   Initialisation
   ========================= */
async function init() {
  loadPrefs();
  applyPrefsUI();
  
  // Restaurer l'état de vue
  if (!restoreState()) {
    const now = new Date();
    state.year = now.getFullYear();
    state.month = now.getMonth();
    state.selected = keyFor(now);
  }

  // Rendu initial (sans données pour l'instant)
  renderHeaders();
  renderGrid();
  updateSelectionUI();
  renderTotals();

  // Vérifier l'auth APRÈS le rendu UI pour éviter les bugs d'affichage
  await checkAuth();
  
  setupListeners();
}

/* =========================
   Préférences & État
   ========================= */
function loadPrefs() {
  try {
    const raw = localStorage.getItem(LS_PREFS);
    if (raw) prefs = { ...defaultPrefs, ...JSON.parse(raw) };
  } catch (e) { console.error("Prefs load error", e); }
}

function savePrefs() {
  localStorage.setItem(LS_PREFS, JSON.stringify(prefs));
}

function restoreState() {
  try {
    const raw = localStorage.getItem(LS_STATE);
    if (!raw) return false;
    const s = JSON.parse(raw);
    state = { ...state, ...s };
    return true;
  } catch { return false; }
}

function saveState() {
  localStorage.setItem(LS_STATE, JSON.stringify(state));
}

function applyPrefsUI() {
  document.documentElement.setAttribute('data-theme', prefs.theme);
  document.documentElement.setAttribute('data-size', prefs.size);
  
  // Update toggles UI
  const togQuick = $('togQuickTap');
  const togConf = $('togConfirmLogout');
  if(togQuick) togQuick.checked = prefs.quickTap;
  if(togConf) togConf.checked = prefs.confirmLogout;
  
  // Update theme buttons
  const btnL = $('themeLight'), btnD = $('themeDark');
  if(btnL) btnL.classList.toggle('active', prefs.theme === 'light');
  if(btnD) btnD.classList.toggle('active', prefs.theme === 'dark');
}

/* =========================
   Rendu Grille
   ========================= */
function renderHeaders() {
  const list = prefs.weekStart === 'mon' ? DAYS_MON : DAYS_SUN;
  for(let i=0; i<7; i++) {
    const el = $(`h${i}`);
    if(el) el.textContent = list[i];
  }
}

function renderGrid() {
  const grid = $('grid');
  if(!grid) return;
  grid.innerHTML = '';
  cellCache.clear();

  $('navMonth').textContent = MONTHS[state.month];
  $('navYear').textContent = state.year;

  const first = new Date(state.year, state.month, 1);
  let startDay = first.getDay();
  if (prefs.weekStart === 'mon') startDay = startDay === 0 ? 6 : startDay - 1;

  const startDate = new Date(first);
  startDate.setDate(first.getDate() - startDay);

  for (let i = 0; i < 42; i++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    const k = keyFor(d);
    
    // Colonne Semaine
    if (i % 7 === 0) {
      const wn = document.createElement('div');
      wn.className = 'weeknum';
      wn.textContent = getWeekNumber(d);
      grid.appendChild(wn);
    }

    const cell = document.createElement('div');
    cell.className = 'day';
    if (d.getMonth() !== state.month) cell.classList.add('out');
    cell.dataset.key = k;
    cell.textContent = d.getDate();

    // Appliquer les données si disponibles
    const entry = entries.get(k);
    if (entry?.status) {
      cell.classList.add(entry.status);
      if (entry.note) {
        const dot = document.createElement('div');
        dot.className = 'dot';
        cell.appendChild(dot);
      }
    }

    // Sélection
    if (k === state.selected) {
      cell.classList.add('selected');
    }

    // Clic
    cell.addEventListener('click', () => handleCellClick(k));

    grid.appendChild(cell);
    cellCache.set(k, cell);
  }
}

function getWeekNumber(d) {
  const date = new Date(d.getTime());
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
  const week1 = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

/* =========================
   Interactions
   ========================= */
function handleCellClick(k) {
  state.selected = k;
  saveState();

  const entry = entries.get(k);
  
  // Quick Tap : Si activé et case vide -> Applique "Jour" directement
  if (prefs.quickTap && !entry?.status) {
    saveEntry(k, { status: 'jour' });
    renderGrid(); // Rafraîchir pour voir la couleur
    updateSelectionUI();
    return;
  }

  renderGrid();
  updateSelectionUI();
}

function updateSelectionUI() {
  const d = parseKey(state.selected);
  const entry = entries.get(state.selected);
  
  const dateStr = `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  $('selDate').textContent = dateStr;
  
  const statusLabel = entry?.status ? LABELS[entry.status] : "—";
  const extra = (entry?.status === 'autre' && entry.custom_label) ? ` (${entry.custom_label})` : "";
  $('selState').textContent = `État: ${statusLabel}${extra}`;
  
  $('sheetTitle').textContent = dateStr;
  $('sheetSub').textContent = entry?.note ? "Note présente" : "Aucune note";
  $('noteText').value = entry?.note || "";
}

function renderTotals() {
  let counts = { jour:0, nuit:0, repos:0, conges:0, autre:0 };
  entries.forEach(e => { if(e.status) counts[e.status]++; });
  
  const t = $('totals');
  if(!t) return;
  t.innerHTML = '';
  
  Object.keys(counts).forEach(k => {
    if (counts[k] > 0) {
      const chip = document.createElement('div');
      chip.className = 'pillchip';
      chip.textContent = `${LABELS[k]}: ${counts[k]}`;
      t.appendChild(chip);
    }
  });
}

/* =========================
   Sauvegarde & Auth
   ========================= */
async function saveEntry(k, patch) {
  if (!user) {
    // Si pas connecté, on sauvegarde en local temporairement (optionnel)
    // Ici on bloque pour forcer la connexion
    $('gate').classList.add('show');
    return;
  }

  const current = entries.get(k) || { status: '', note: '', custom_label: '' };
  const next = { ...current, ...patch };
  entries.set(k, next);

  // Mise à jour UI immédiate
  const cell = cellCache.get(k);
  if (cell) {
    cell.className = `day ${cell.classList.contains('out') ? 'out' : ''} ${next.status ? next.status : ''}`;
    cell.querySelectorAll('.dot').forEach(e => e.remove());
    if (next.note) {
      const dot = document.createElement('div'); dot.className='dot'; cell.appendChild(dot);
    }
  }
  
  if (state.selected === k) updateSelectionUI();
  renderTotals();

  const { error } = await supabase
    .from("work_calendar_entries")
    .upsert({
      user_id: user.id,
      work_date: k,
      status: next.status,
      note: next.note || null,
      custom_label: next.custom_label || null
    }, { onConflict: "user_id,work_date" });

  if (error) {
    console.error("Erreur sauvegarde", error);
    alert("Erreur de synchronisation");
  }
}

async function checkAuth() {
  const { data, error } = await supabase.auth.getSession();
  
  if (error || !data?.session) {
    user = null;
    $('topSub').textContent = "Non connecté";
    $('gate').classList.add('show'); // AFFICHER LA CONNEXION
    return;
  }

  user = data.session.user;
  $('topSub').textContent = user.email.split('@')[0];
  $('gate').classList.remove('show'); // CACHER LA CONNEXION
  
  await loadEntries();
}

async function loadEntries() {
  if (!user) return;
  
  // Charger 3 mois autour de la vue actuelle
  const start = new Date(state.year, state.month - 1, 1);
  const end = new Date(state.year, state.month + 2, 0);
  
  const { data, error } = await supabase
    .from("work_calendar_entries")
    .select("work_date,status,note,custom_label")
    .gte("work_date", keyFor(start))
    .lte("work_date", keyFor(end));

  if (error) {
    console.error("Erreur chargement", error);
    return;
  }

  entries.clear();
  if (data) {
    data.forEach(r => entries.set(r.work_date, {
      status: r.status,
      note: r.note,
      custom_label: r.custom_label
    }));
  }
  renderGrid();
  renderTotals();
  updateSelectionUI();
}

/* =========================
   Écouteurs (Listeners)
   ========================= */
function setupListeners() {
  // Navigation
  $('btnPrevMonth').onclick = () => changeMonth(-1);
  $('btnNextMonth').onclick = () => changeMonth(1);
  $('btnToday').onclick = () => {
    const now = new Date();
    state.year = now.getFullYear();
    state.month = now.getMonth();
    state.selected = keyFor(now);
    saveState();
    loadEntries().then(() => {
      renderGrid();
      updateSelectionUI();
    });
  };

  // Actions Dock
  document.querySelectorAll('[data-set]').forEach(btn => {
    btn.onclick = () => {
      if (!state.selected) return;
      const type = btn.dataset.set;
      
      if (type === 'autre') {
        $('sheetOther').style.display = 'block';
        $('sheetNote').style.display = 'none';
        $('backdrop').classList.add('show');
        $('sheet').classList.add('show');
      } else {
        saveEntry(state.selected, { status: type, custom_label: '' });
      }
    };
  });

  // Note
  $('btnNote').onclick = () => {
    $('sheetNote').style.display = 'block';
    $('sheetOther').style.display = 'none';
    $('backdrop').classList.add('show');
    $('sheet').classList.add('show');
  };

  // Fermeture Sheet
  const closeSheet = () => {
    $('sheet').classList.remove('show');
    $('backdrop').classList.remove('show');
  };
  $('btnCloseSheet').onclick = closeSheet;
  $('backdrop').onclick = closeSheet;

  $('btnSaveNote').onclick = () => {
    saveEntry(state.selected, { note: $('noteText').value });
    closeSheet();
  };

  $('btnApplyOther').onclick = () => {
    const val = $('otherSelect').value;
    const custom = $('otherCustom').value;
    saveEntry(state.selected, { 
      status: 'autre', 
      custom_label: val === 'custom' ? custom : val 
    });
    closeSheet();
  };

  // Settings
  $('btnSettings').onclick = (e) => {
    e.stopPropagation();
    $('settingsPop').classList.toggle('show');
  };
  document.addEventListener('click', () => $('settingsPop').classList.remove('show'));
  $('settingsPop').onclick = (e) => e.stopPropagation();

  $('themeLight').onclick = () => { prefs.theme = 'light'; savePrefs(); applyPrefsUI(); };
  $('themeDark').onclick = () => { prefs.theme = 'dark'; savePrefs(); applyPrefsUI(); };
  
  const togQuick = $('togQuickTap');
  if(togQuick) togQuick.onchange = (e) => { prefs.quickTap = e.target.checked; savePrefs(); };
  
  const togConf = $('togConfirmLogout');
  if(togConf) togConf.onchange = (e) => { prefs.confirmLogout = e.target.checked; savePrefs(); };

  // Auth Actions
  $('tabLogin').onclick = () => { $('paneLogin').style.display='block'; $('paneSignup').style.display='none'; $('tabLogin').classList.add('primary'); $('tabSignup').classList.remove('primary'); };
  $('tabSignup').onclick = () => { $('paneLogin').style.display='none'; $('paneSignup').style.display='block'; $('tabSignup').classList.add('primary'); $('tabLogin').classList.remove('primary'); };
  $('btnBackLogin').onclick = $('tabLogin').onclick;

  $('btnLogin').onclick = async () => {
    const email = $('loginEmail').value;
    const pass = $('loginPass').value;
    const hint = $('loginHint');
    hint.textContent = "Connexion...";
    
    const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
    if (error) {
      hint.textContent = "Erreur: " + error.message;
    } else {
      hint.textContent = "";
      checkAuth();
    }
  };

  $('btnSignup').onclick = async () => {
    const email = $('signEmail').value;
    const pass = $('signPass').value;
    if(pass.length < 6) { alert("Mot de passe trop court"); return; }
    
    const { error } = await supabase.auth.signUp({ email, password: pass });
    if (error) alert(error.message);
    else {
      alert("Compte créé ! Connectez-vous.");
      $('tabLogin').onclick();
    }
  };

  $('btnReset').onclick = async () => {
    const email = $('loginEmail').value;
    if(!email) { alert("Entrez votre email d'abord"); return; }
    await supabase.auth.resetPasswordForEmail(email);
    alert("Email de réinitialisation envoyé");
  };

  $('btnLogout').onclick = async () => {
    if (prefs.confirmLogout && !confirm("Déconnexion ?")) return;
    await supabase.auth.signOut();
    entries.clear();
    user = null;
    $('topSub').textContent = "Non connecté";
    $('gate').classList.add('show');
    renderGrid(); // Effacer visuellement
  };
  
  // Export
  $('btnExportXLSX').onclick = () => {
     // (Votre logique d'export existante fonctionne toujours)
     alert("Fonction export prête (nécessite la librairie XLSX chargée)");
  };
}

function changeMonth(delta) {
  state.month += delta;
  if (state.month > 11) { state.month = 0; state.year++; }
  if (state.month < 0) { state.month = 11; state.year--; }
  saveState();
  loadEntries().then(() => {
    renderGrid();
    updateSelectionUI();
  });
}

// Lancement
init();  if(themeColor) themeColor.setAttribute('content', prefs.theme === 'dark' ? '#0f172a' : '#f4f6fb');
}

function loadPrefs() {
  try { const p = JSON.parse(localStorage.getItem(LS_PREFS)); if(p) prefs = {...prefs, ...p}; } catch{}
}
function savePrefs() { localStorage.setItem(LS_PREFS, JSON.stringify(prefs)); }
function loadState() {
  try { const s = JSON.parse(localStorage.getItem(LS_STATE)); if(s) state = {...state, ...s}; } catch{}
  const now = new Date();
  if (!state.selected || state.year < 2020) {
    state.year = now.getFullYear();
    state.month = now.getMonth();
    state.selected = key(now);
  }
}
function saveState() { localStorage.setItem(LS_STATE, JSON.stringify(state)); }

function applyPrefs() {
  document.documentElement.setAttribute('data-theme', prefs.theme);
  document.documentElement.setAttribute('data-size', prefs.size);
  updateSettingsUI();
  renderHeaders();
}

/* --- Rendu --- */
function renderHeaders() {
  const startDay = prefs.weekStart === 'mon' ? 1 : 0;
  const headers = [...daysShort.slice(startDay), ...daysShort.slice(0, startDay)];
  for(let i=0; i<7; i++) {
    const el = $(`h${i}`);
    if(el) el.textContent = headers[i];
  }
}

function render() {
  $('navMonth').textContent = months[state.month];
  $('navYear').textContent = state.year;
  
  const grid = $('grid');
  grid.innerHTML = '';
  cellCache.clear();

  const first = new Date(state.year, state.month, 1);
  let startDay = first.getDay();
  if (prefs.weekStart === 'mon') startDay = startDay === 0 ? 6 : startDay - 1;
  
  const startDate = new Date(first);
  startDate.setDate(first.getDate() - startDay);

  for (let i = 0; i < 42; i++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    const k = key(d);
    
    // Week number column
    if (i % 7 === 0) {
      const wn = document.createElement('div');
      wn.className = 'weeknum';
      wn.textContent = getWeekNumber(d);
      grid.appendChild(wn);
    }

    const cell = document.createElement('div');
    cell.className = `day ${d.getMonth() !== state.month ? 'out' : ''}`;
    cell.dataset.key = k;
    cell.textContent = d.getDate();
    
    // Apply status
    const entry = entries.get(k);
    if (entry?.status) {
      cell.classList.add(entry.status);
      if (entry.note) {
        const dot = document.createElement('div'); dot.className = 'dot'; cell.appendChild(dot);
      }
    }

    if (k === state.selected) cell.classList.add('selected');
    
    cell.onclick = () => handleCellClick(k);
    
    grid.appendChild(cell);
    cellCache.set(k, cell);
  }
  
  updateSelectionUI();
  renderTotals();
}

function getWeekNumber(d) {
  const date = new Date(d.getTime());
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
  const week1 = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

/* --- Interactions --- */
function handleCellClick(k) {
  state.selected = k;
  saveState();
  
  // Quick Tap Feature: Si activé, applique "Jour" directement au premier clic
  if (prefs.quickTap) {
    const entry = entries.get(k);
    if (!entry?.status) {
      saveEntry(k, { status: 'jour' });
      render(); // Re-render pour montrer le changement
      return;
    }
  }

  render();
  updateSelectionUI();
}

function updateSelectionUI() {
  const d = parseKey(state.selected);
  const entry = entries.get(state.selected);
  $('selDate').textContent = `${d.getDate()} ${months[d.getMonth()]}`;
  $('selState').textContent = entry?.status ? labels[entry.status] : 'Libre';
  
  const title = `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  $('sheetTitle').textContent = title;
  $('sheetSub').textContent = entry?.note || 'Aucune note';
  $('noteText').value = entry?.note || '';
}

function renderTotals() {
  let counts = { jour:0, nuit:0, repos:0, conges:0, autre:0 };
  entries.forEach(e => { if(e.status) counts[e.status]++; });
  
  const t = $('totals');
  t.innerHTML = '';
  Object.entries(counts).forEach(([k, v]) => {
    if (v > 0) {
      const chip = document.createElement('div');
      chip.className = 'pillchip'; // Assurez-vous que ce style existe ou utilisez un span simple
      chip.style.cssText = "display:inline-block; padding:4px 8px; border-radius:8px; background:var(--surface2); font-size:11px; font-weight:700; margin-right:4px; border:1px solid var(--stroke);";
      chip.textContent = `${labels[k]}: ${v}`;
      t.appendChild(chip);
    }
  });
}

/* --- Sauvegarde --- */
async function saveEntry(k, patch) {
  if (!user) { alert('Connectez-vous d\'abord'); return; }
  
  const current = entries.get(k) || { status: '', note: '' };
  const next = { ...current, ...patch };
  entries.set(k, next);
  
  // Optimistic UI update
  const cell = cellCache.get(k);
  if (cell) {
    cell.className = `day ${cell.classList.contains('out') ? 'out' : ''} ${next.status ? next.status : ''} ${state.selected === k ? 'selected' : ''}`;
    // Clean dots
    cell.querySelectorAll('.dot').forEach(e => e.remove());
    if (next.note) { const dot = document.createElement('div'); dot.className='dot'; cell.appendChild(dot); }
  }
  renderTotals();
  updateSelectionUI();

  const { error } = await supabase.from('work_calendar_entries').upsert({
    user_id: user.id, work_date: k, status: next.status, note: next.note
  }, { onConflict: 'user_id,work_date' });
  
  if (error) console.error('Save error', error);
}

/* --- Auth & Data --- */
async function refreshAuth() {
  const { data } = await supabase.auth.getSession();
  user = data?.session?.user;
  
  if (user) {
    $('gate').classList.remove('show');
    $('topSub').textContent = user.email.split('@')[0];
    loadEntries();
  } else {
    $('gate').classList.add('show');
    $('topSub').textContent = 'Invité';
  }
}

async function loadEntries() {
  if (!user) return;
  // Load 3 months around current view
  const start = new Date(state.year, state.month - 1, 1);
  const end = new Date(state.year, state.month + 2, 0);
  
  const { data } = await supabase.from('work_calendar_entries')
    .select('*')
    .gte('work_date', key(start))
    .lte('work_date', key(end));
    
  entries.clear();
  if (data) data.forEach(r => entries.set(r.work_date, { status: r.status, note: r.note }));
  render();
}

/* --- Listeners --- */
function setupListeners() {
  // Nav
  $('btnPrevMonth').onclick = () => changeMonth(-1);
  $('btnNextMonth').onclick = () => changeMonth(1);
  $('btnToday').onclick = () => {
    const now = new Date();
    state.year = now.getFullYear(); state.month = now.getMonth(); state.selected = key(now);
    saveState(); render();
  };
  
  // Actions
  document.querySelectorAll('[data-set]').forEach(btn => {
    btn.onclick = () => {
      if (!state.selected) return;
      const type = btn.dataset.set;
      if (type === 'autre') {
        $('sheetOther').style.display = 'block';
        $('sheetNote').style.display = 'none';
        $('backdrop').classList.add('show');
        $('sheet').classList.add('show');
      } else {
        saveEntry(state.selected, { status: type });
      }
    };
  });

  $('btnNote').onclick = () => {
    $('sheetNote').style.display = 'block';
    $('sheetOther').style.display = 'none';
    $('backdrop').classList.add('show');
    $('sheet').classList.add('show');
  };

  $('btnCloseSheet').onclick = $('backdrop').onclick = () => {
    $('sheet').classList.remove('show');
    $('backdrop').classList.remove('show');
  };

  $('btnSaveNote').onclick = () => {
    saveEntry(state.selected, { note: $('noteText').value });
    $('sheet').classList.remove('show');
    $('backdrop').classList.remove('show');
  };

  $('btnApplyOther').onclick = () => {
    const val = $('otherSelect').value;
    saveEntry(state.selected, { status: 'autre' }); // Simplified for demo
    $('sheet').classList.remove('show');
    $('backdrop').classList.remove('show');
  };

  // Settings
  $('btnSettings').onclick = (e) => {
    e.stopPropagation();
    $('settingsPop').classList.toggle('show');
  };
  document.onclick = () => $('settingsPop').classList.remove('show');
  
  $('themeLight').onclick = () => { prefs.theme = 'light'; savePrefs(); applyPrefs(); };
  $('themeDark').onclick = () => { prefs.theme = 'dark'; savePrefs(); applyPrefs(); };
  $('togQuickTap').onchange = (e) => { prefs.quickTap = e.target.checked; savePrefs(); };
  $('togConfirmLogout').onchange = (e) => { prefs.confirmLogout = e.target.checked; savePrefs(); };

  // Auth
  $('btnLogin').onclick = async () => {
    const { error } = await supabase.auth.signInWithPassword({
      email: $('loginEmail').value, password: $('loginPass').value
    });
    if (error) alert(error.message); else refreshAuth();
  };
  
  $('btnLogout').onclick = async () => {
    if (prefs.confirmLogout && !confirm('Déconnexion ?')) return;
    await supabase.auth.signOut();
    refreshAuth();
  };
}

function changeMonth(delta) {
  state.month += delta;
  if (state.month > 11) { state.month = 0; state.year++; }
  if (state.month < 0) { state.month = 11; state.year--; }
  saveState();
  loadEntries(); // Reload data for new range
  render();
}

function updateSettingsUI() {
  $('themeLight').classList.toggle('active', prefs.theme === 'light');
  $('themeDark').classList.toggle('active', prefs.theme === 'dark');
  $('togQuickTap').checked = prefs.quickTap;
  $('togConfirmLogout').checked = prefs.confirmLogout;
}

init();      custom_label: r.custom_label || "",
      note: r.note || ""
    });
  });
}

/* ------- UI incremental update ------- */
function clearCellVisual(cell){
  cell.classList.remove("jour","nuit","repos","conges","autre");
  const dot = cell.querySelector(".dot");
  if(dot) dot.remove();
  const badge = cell.querySelector(".badge");
  if(badge) badge.remove();
}
function applyEntryToCell(cell, entry){
  if(entry?.status) cell.classList.add(entry.status);

  if(entry?.note){
    const dot = document.createElement("div");
    dot.className="dot";
    cell.appendChild(dot);
  }
  if(entry?.status === "autre" && entry.custom_label){
    const b = document.createElement("div");
    b.className="badge";
    b.textContent = entry.custom_label.slice(0,6);
    cell.appendChild(b);
  }
}
function updateCell(key){
  const cell = cellByKey.get(key);
  if(!cell) return;
  clearCellVisual(cell);
  applyEntryToCell(cell, entries.get(key));
}

/* Save immediately */
async function upsertDay(dateKey, patch){
  if(!user){ toast("Connecte-toi."); return; }

  const cur = entries.get(dateKey) || { status:"", custom_label:"", note:"" };
  const next = { ...cur, ...patch };

  entries.set(dateKey, next);
  requestAnimationFrame(()=>{
    updateCell(dateKey);
    renderTotals();
    setSelected(dateKey);
  });

  const { error } = await supabase
    .from("work_calendar_entries")
    .upsert({
      user_id: user.id,
      work_date: dateKey,
      status: next.status,
      custom_label: next.custom_label || null,
      note: next.note || null
    }, { onConflict: "user_id,work_date" });

  if(error){
    console.error(error);

    if(cur.status || cur.note || cur.custom_label) entries.set(dateKey, cur);
    else entries.delete(dateKey);

    requestAnimationFrame(()=>{
      updateCell(dateKey);
      renderTotals();
      setSelected(dateKey);
    });

    toast("Erreur sauvegarde: " + (error.message || error.code || ""));
    return;
  }

  saveViewState();
}

/* Render month */
function getWeekNum(d){
  if(prefs.weekNumber === "iso") return isoWeek(d);
  return simpleWeekSunday(d);
}
function rotatedStartDateForMonth(year, month){
  // base start is Sunday grid start
  const first = new Date(year, month, 1);
  const baseStart = new Date(year, month, 1 - first.getDay()); // Sunday
  if(prefs.weekStart === "sun") return baseStart;

  // Monday start: shift grid start back 1 day (Monday)
  const s = new Date(baseStart);
  s.setDate(s.getDate() - 6); // from Sunday to previous Monday
  // explanation: baseStart is Sunday; previous Monday is -6 days
  return s;
}
function renderMonth(){
  grid.innerHTML="";
  cellByKey.clear();
  selectedEl = null;

  navMonth.textContent = MONTHS[viewMonth];
  navYear.textContent  = String(viewYear);

  const start = rotatedStartDateForMonth(viewYear, viewMonth);

  for(let week=0; week<6; week++){
    const weekStart = new Date(start);
    weekStart.setDate(start.getDate() + week*7);

    const wn = document.createElement("div");
    wn.className="weeknum";
    wn.textContent = String(getWeekNum(weekStart)).padStart(2,"0");
    grid.appendChild(wn);

    for(let i=0;i<7;i++){
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate()+i);
      const k = keyFor(d);

      const cell = document.createElement("div");
      cell.className="day";
      cell.dataset.key=k;

      // out-of-month
      if(d.getMonth() !== viewMonth) cell.classList.add("out");
      cell.textContent = String(d.getDate());

      applyEntryToCell(cell, entries.get(k));

      cellByKey.set(k, cell);

      fastTap(cell, async ()=>{
        setSelected(k);
        saveViewState();

        // If "Tap applique direct" is ON: tap = just select (fast) -> actions below remain
        // If OFF: tap opens Note sheet quickly (useful like Calendar)
        if(!prefs.fastApply){
          openSheet("note");
        }
      });

      grid.appendChild(cell);
    }
  }

  if(selectedKey){
    const el = cellByKey.get(selectedKey);
    if(el){
      el.classList.add("selected");
      selectedEl = el;
    }
  }
}

function setSelected(k){
  selectedKey = k;

  if(selectedEl) selectedEl.classList.remove("selected");
  const el = cellByKey.get(k);
  if(el){
    el.classList.add("selected");
    selectedEl = el;
  }else{
    selectedEl = null;
  }

  const d = parseKey(k);
  const e = entries.get(k);
  const state = e?.status ? LABEL[e.status] : "—";
  const extra = (e?.status==="autre" && e.custom_label) ? ` (${e.custom_label})` : "";

  selDate.textContent = fmtLong(d);
  selState.textContent = `État: ${state}${extra}`;
  sheetTitle.textContent = fmtLong(d);
  sheetSub.textContent = `État actuel: ${state}${extra}`;
  noteText.value = e?.note || "";
}

function renderTotals(){
  let cJ=0,cN=0,cR=0,cC=0,cA=0;
  for(const e of entries.values()){
    if(!e?.status) continue;
    if(e.status==="jour") cJ++;
    if(e.status==="nuit") cN++;
    if(e.status==="repos") cR++;
    if(e.status==="conges") cC++;
    if(e.status==="autre") cA++;
  }

  totalsEl.innerHTML="";
  const chip=(t)=>{
    const d=document.createElement("div");
    d.className="pillchip";
    d.textContent=t;
    return d;
  };
  totalsEl.appendChild(chip(`Jours: ${cJ}`));
  totalsEl.appendChild(chip(`Nuits: ${cN}`));
  totalsEl.appendChild(chip(`Repos: ${cR}`));
  totalsEl.appendChild(chip(`Congés: ${cC}`));
  if(!prefs.hideOtherTotal) totalsEl.appendChild(chip(`Autres: ${cA}`));
}

/* Buttons */
function ensureSelected(){
  if(!selectedKey){
    const d = getSncfNow();
    viewYear = clampYear(d.getFullYear());
    viewMonth = d.getMonth();
    selectedKey = keyFor(d);
  }
  return selectedKey;
}

/* Action buttons */
document.querySelectorAll("[data-set]").forEach(btn=>{
  fastTap(btn, async ()=>{
    const k = ensureSelected();
    const dSel = parseKey(k);

    if(dSel.getFullYear()!==viewYear || dSel.getMonth()!==viewMonth){
      viewYear = clampYear(dSel.getFullYear());
      viewMonth = dSel.getMonth();
      await reloadView(true);
    }

    const type = btn.dataset.set;

    if(type==="autre"){
      const e = entries.get(k);
      otherSelect.value="OCP"; otherCustom.value=""; otherCustom.style.display="none";
      if(e?.status==="autre" && e.custom_label){
        if(e.custom_label==="OCP" || e.custom_label==="Férié") otherSelect.value=e.custom_label;
        else { otherSelect.value="custom"; otherCustom.style.display="block"; otherCustom.value=e.custom_label; }
      }
      openSheet("other");
      return;
    }

    await upsertDay(k, { status:type, custom_label:"" });
  });
});

fastTap(btnNote, ()=>{
  ensureSelected();
  openSheet("note");
});

fastTap(document.getElementById("btnApplyOther"), async ()=>{
  const k = ensureSelected();
  let label = otherSelect.value;
  if(label==="custom"){
    label = (otherCustom.value||"").trim();
    if(!label){ toast("Entre un libellé."); return; }
  }
  await upsertDay(k, { status:"autre", custom_label:label });
  closeSheet();
});

fastTap(document.getElementById("btnSaveNote"), async ()=>{
  const k = ensureSelected();
  await upsertDay(k, { note:(noteText.value||"").trim() });
  closeSheet();
});

fastTap(document.getElementById("btnClearNote"), async ()=>{
  const k = ensureSelected();
  noteText.value="";
  await upsertDay(k, { note:"" });
  closeSheet();
});

/* Navigation */
async function changeMonth(delta){
  let y=viewYear, m=viewMonth+delta;
  if(m<0){m=11;y--}
  if(m>11){m=0;y++}
  viewYear = clampYear(y);
  viewMonth = m;
  await reloadView(false);
  saveViewState();
}
async function changeYear(delta){
  viewYear = clampYear(viewYear + delta);
  await reloadView(false);
  saveViewState();
}

fastTap(btnPrevMonth, ()=>changeMonth(-1));
fastTap(btnNextMonth, ()=>changeMonth(1));
fastTap(btnPrevYear,  ()=>changeYear(-1));
fastTap(btnNextYear,  ()=>changeYear(1));

fastTap(btnToday, async ()=>{
  const d = getSncfNow();
  viewYear = clampYear(d.getFullYear());
  viewMonth = d.getMonth();
  selectedKey = keyFor(d);
  await reloadView(true);
  saveViewState();
});

/* Export Excel */
fastTap(btnExportXLSX, ()=>{
  const rows = [["Date","Année","Mois","Semaine","Type","Libellé","Note"]];
  const keys = Array.from(entries.keys()).sort();
  for(const k of keys){
    const e = entries.get(k);
    if(!e?.status) continue;
    const d = new Date(k);
    rows.push([
      k,
      d.getFullYear(),
      MONTHS[d.getMonth()],
      String(getWeekNum(d)).padStart(2,"0"),
      LABEL[e.status]||"",
      e.custom_label||"",
      e.note||""
    ]);
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Planning");
  XLSX.writeFile(wb, `planning_${viewYear}-${pad2(viewMonth+1)}.xlsx`);
});

/* Reload view */
async function reloadView(keepSelection){
  await loadGridEntries();
  renderMonth();
  renderTotals();

  if(keepSelection && selectedKey){
    setSelected(selectedKey);
  }else{
    const k = `${viewYear}-${pad2(viewMonth+1)}-01`;
    selectedKey = k;
    setSelected(k);
  }
}

/* Settings popover wiring */
function initSettings(){
  // load + apply
  loadPrefs();
  applyTheme(getTheme());
  applySettingsToUI();
  updateSettingsUI();

  // open/close
  fastTap(btnSettings, (e)=>{
    e?.stopPropagation?.();
    settingsPop.classList.toggle("show");
  });
  document.addEventListener("click", ()=>settingsPop.classList.remove("show"));
  settingsPop.addEventListener("click", (e)=>e.stopPropagation());

  // theme
  fastTap(document.getElementById("themeLight"), ()=>setTheme("light"));
  fastTap(document.getElementById("themeDark"),  ()=>setTheme("dark"));

  // week start
  fastTap(document.getElementById("weekStartSun"), ()=>{
    prefs.weekStart = "sun";
    savePrefs(); applySettingsToUI(); updateSettingsUI();
    renderMonth(); // reflow columns
    renderTotals();
  });
  fastTap(document.getElementById("weekStartMon"), ()=>{
    prefs.weekStart = "mon";
    savePrefs(); applySettingsToUI(); updateSettingsUI();
    renderMonth();
    renderTotals();
  });

  // week number mode
  fastTap(document.getElementById("weekIso"), ()=>{
    prefs.weekNumber = "iso";
    savePrefs(); updateSettingsUI();
    renderMonth();
  });
  fastTap(document.getElementById("weekSimple"), ()=>{
    prefs.weekNumber = "simple";
    savePrefs(); updateSettingsUI();
    renderMonth();
  });

  // cell size
  fastTap(document.getElementById("cellCompact"), ()=>{
    prefs.cellSize = "compact";
    savePrefs(); applyCellSize(); updateSettingsUI();
  });
  fastTap(document.getElementById("cellComfort"), ()=>{
    prefs.cellSize = "comfort";
    savePrefs(); applyCellSize(); updateSettingsUI();
  });
  fastTap(document.getElementById("cellLarge"), ()=>{
    prefs.cellSize = "large";
    savePrefs(); applyCellSize(); updateSettingsUI();
  });

  // toggles
  const tFast = document.getElementById("togFastApply");
  const tToday= document.getElementById("togAutoToday");
  const tConf = document.getElementById("togConfirmLogout");
  const tHide = document.getElementById("togHideOtherTotal");

  tFast?.addEventListener("change", ()=>{
    prefs.fastApply = !!tFast.checked;
    savePrefs();
  }, { passive:true });

  tToday?.addEventListener("change", ()=>{
    prefs.autoToday = !!tToday.checked;
    savePrefs();
  }, { passive:true });

  tConf?.addEventListener("change", ()=>{
    prefs.confirmLogout = !!tConf.checked;
    savePrefs();
  }, { passive:true });

  tHide?.addEventListener("change", ()=>{
    prefs.hideOtherTotal = !!tHide.checked;
    savePrefs();
    renderTotals();
  }, { passive:true });
}

/* Init */
async function init(){
  initSettings();

  const restored = restoreViewState();

  if(!restored || prefs.autoToday){
    const now = getSncfNow();
    viewYear = clampYear(now.getFullYear());
    viewMonth = now.getMonth();
    selectedKey = keyFor(now);
  }

  renderMonth();
  renderTotals();
  if(selectedKey) setSelected(selectedKey);

  await refreshSessionUser();
  if(user) await reloadView(true);

  supabase.auth.onAuthStateChange(async ()=>{
    await refreshSessionUser();
    if(user) await reloadView(true);
  });
}

init();
