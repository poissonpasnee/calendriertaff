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
const LABELS = { jour:"Jour", nuit:"Nuit", repos:"Repos", conges:"Congés", autre:"Autre" };

// --- UTILITAIRES ---
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const parseKey = (k) => { const [y,m,d] = k.split('-').map(Number); return new Date(y, m-1, d); };
const keyFor = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

// --- INITIALISATION ---
async function init() {
  loadLocalData();
  applyPrefs();
  renderGrid(); 
  updateSelectionUI();
  await checkAuth(); 
  setupEvents();
}

function loadLocalData() {
  const p = localStorage.getItem('prefs_v2');
  if(p) prefs = {...prefs, ...JSON.parse(p)};
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

// --- AUTHENTIFICATION ---
async function checkAuth() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data?.session) {
    user = null;
    $('topSub').textContent = "Invité";
    $('gate').classList.add('show');
    return;
  }
  user = data.session.user;
  $('topSub').textContent = user.email.split('@')[0];
  $('gate').classList.remove('show');
  await loadEntries();
  renderGrid();
  renderTotals();
  updateSelectionUI();
}

async function loadEntries() {
  if(!user) return;
  const start = new Date(state.year, state.month - 1, 1);
  const end = new Date(state.year, state.month + 2, 0);
  const { data, error } = await supabase.from("work_calendar_entries").select("*").gte("work_date", keyFor(start)).lte("work_date", keyFor(end));
  if(error) { console.error(error); return; }
  entries.clear();
  data.forEach(r => entries.set(r.work_date, { status: r.status, note: r.note, custom_label: r.custom_label }));
}

// --- RENDU GRILLE (MODIFIÉ POUR DI/LU) ---
function renderGrid() {
  const grid = $('grid');
  grid.innerHTML = '';
  cellCache.clear();
  
  $('navMonth').textContent = MONTHS[state.month];
  $('navYear').textContent = state.year;
  
  // Mise à jour des en-têtes (Di/Lu, Lu/Ma, etc.)
  const headers = ["Di/Lu", "Lu/Ma", "Ma/Me", "Me/Je", "Je/Ve", "Ve/Sa", "Sa/Di"];
  for(let i=0; i<7; i++) {
    const el = $(`h${i}`);
    if(el) el.textContent = headers[i];
  }

  // Calcul du début de grille : on aligne sur le Dimanche (0)
  const first = new Date(state.year, state.month, 1);
  let startDay = first.getDay(); // 0 = Dimanche
  const startDate = new Date(first);
  startDate.setDate(first.getDate() - startDay);
  
  for(let i=0; i<42; i++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    const k = keyFor(d);
    
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
  if(!user) { $('gate').classList.add('show'); return; }
  const cur = entries.get(k) || { status:'', note:'', custom_label:'' };
  const next = { ...cur, ...patch };
  entries.set(k, next);
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
  $('btnPrevMonth').onclick = () => { state.month--; if(state.month<0){state.month=11;state.year--;} saveAndReload(); };
  $('btnNextMonth').onclick = () => { state.month++; if(state.month>11){state.month=0;state.year++;} saveAndReload(); };
  $('btnToday').onclick = () => { const n=new Date(); state.year=n.getFullYear(); state.month=n.getMonth(); state.selected=keyFor(n); saveAndReload(); };
  $('btnPrevYear').onclick = () => { state.year--; saveAndReload(); };
  $('btnNextYear').onclick = () => { state.year++; saveAndReload(); };

  function saveAndReload() {
    localStorage.setItem('state_v2', JSON.stringify(state));
    loadEntries().then(() => { renderGrid(); updateSelectionUI(); renderTotals(); });
  }

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

  $('btnSettings').onclick = (e) => { e.stopPropagation(); $('settingsPop').classList.toggle('show'); };
  document.onclick = () => $('settingsPop').classList.remove('show');
  $('settingsPop').onclick = (e) => e.stopPropagation();
  
  $('themeLight').onclick = () => { prefs.theme='light'; savePrefs(); applyPrefs(); };
  $('themeDark').onclick = () => { prefs.theme='dark'; savePrefs(); applyPrefs(); };
  $('togQuickTap').onchange = (e) => { prefs.quickTap=e.target.checked; savePrefs(); };
  $('togConfirmLogout').onchange = (e) => { prefs.confirmLogout=e.target.checked; savePrefs(); };
  function savePrefs() { localStorage.setItem('prefs_v2', JSON.stringify(prefs)); }

  $('tabLogin').onclick = () => { $('paneLogin').style.display='block'; $('paneSignup').style.display='none'; $('tabLogin').classList.add('active'); $('tabSignup').classList.remove('active'); };
  $('tabSignup').onclick = () => { $('paneLogin').style.display='none'; $('paneSignup').style.display='block'; $('tabSignup').classList.add('active'); $('tabLogin').classList.remove('active'); };
  $('btnBackLogin').onclick = $('tabLogin').onclick;

  $('btnLogin').onclick = async () => {
    const email = $('loginEmail').value;
    const pass = $('loginPass').value;
    const hint = $('loginHint');
    hint.textContent = "Connexion...";
    const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
    if(error) { hint.textContent = "Erreur: " + error.message; } else { checkAuth(); }
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
    checkAuth();
  };
  $('btnExportXLSX').onclick = () => alert("Export Excel (nécessite fichier complet)");
}

init();
