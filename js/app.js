import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// --- CONFIGURATION SUPABASE ---
const SUPABASE_URL = "https://dstmyvzjirgyuwuojwnk.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRzdG15dnpqaXJneXV3dW9qd25rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk3NzY4NTUsImV4cCI6MjA4NTM1Mjg1NX0.Cl6WAvK0elHkKXnXRtrFFiBlGABnK5RTFdawq3NGDJk";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// --- ÉTAT GLOBAL & PRÉFÉRENCES ---
let user = null;
let entries = new Map();
let state = { year: 2026, month: 0, selected: null };
let prefs = { 
  theme: 'light', 
  quickTap: false, 
  confirmLogout: true,
  rateDay: 35.0,        // Indemnité Jour
  rateNightFull: 82.0,  // Nuit Complète (GD)
  rateNightSolo: 41.0,  // Nuit Seule
  rateHour: 13.80,      // Taux horaire base
  payrollShift: false   // Mode Décalage M+1
};
let cellCache = new Map();

const MONTHS = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
const LABELS = { jour:"Jour", nuit:"Nuit", repos:"Repos", conges:"Congés", autre:"Autre" };
const BASE_SALARY = 2093.06; // Salaire de base fixe

// --- UTILITAIRES ---
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const parseKey = (k) => { const [y,m,d] = k.split('-').map(Number); return new Date(y, m-1, d); };
const keyFor = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

// --- CALCUL SALAIRE ---
function calculateMonthSalary(year, month) {
  let totalVariable = 0;
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);
  
  let current = new Date(start);
  while (current <= end) {
    const k = keyFor(current);
    const entry = entries.get(k);
    if (entry && entry.status) {
      if (entry.status === 'jour') totalVariable += parseFloat(prefs.rateDay);
      else if (entry.status === 'nuit') totalVariable += parseFloat(prefs.rateNightFull);
      // Ajoutez d'autres règles ici si besoin (ex: férié)
    }
    current.setDate(current.getDate() + 1);
  }
  return BASE_SALARY + totalVariable;
}

// --- INITIALISATION ---
async function init() {
  loadLocalData();
  applyPrefs();
  renderGrid(); 
  updateSelectionUI();
  renderTotals();
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
  
  // Sécurité : vérifier si l'élément existe avant de modifier
  if($('togQuickTap')) $('togQuickTap').checked = prefs.quickTap;
  if($('togConfirmLogout')) $('togConfirmLogout').checked = prefs.confirmLogout;
  if($('togPayrollShift')) $('togPayrollShift').checked = prefs.payrollShift;
  
  if($('rateDay')) $('rateDay').value = prefs.rateDay;
  if($('rateNightFull')) $('rateNightFull').value = prefs.rateNightFull;
  if($('rateNightSolo')) $('rateNightSolo').value = prefs.rateNightSolo;
  if($('rateHour')) $('rateHour').value = prefs.rateHour;
  
  if($('themeLight')) $('themeLight').classList.toggle('active', prefs.theme === 'light');
  if($('themeDark')) $('themeDark').classList.toggle('active', prefs.theme === 'dark');
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

// --- RENDU GRILLE ---
function renderGrid() {
  const grid = $('grid');
  grid.innerHTML = '';
  cellCache.clear();
  
  let displayYear = state.year;
  let displayMonth = state.month;
  
  // Gestion du décalage M+1 pour l'affichage
  if (prefs.payrollShift) {
    displayMonth--;
    if (displayMonth < 0) { displayMonth = 11; displayYear--; }
  }

  $('navMonth').textContent = MONTHS[displayMonth] + (prefs.payrollShift ? ' (N-1)' : '');
  $('navYear').textContent = displayYear;
  
  const headers = ["Di/Lu", "Lu/Ma", "Ma/Me", "Me/Je", "Je/Ve", "Ve/Sa", "Sa/Di"];
  for(let i=0; i<7; i++) {
    const el = $(`h${i}`);
    if(el) el.textContent = headers[i];
  }

  const first = new Date(displayYear, displayMonth, 1);
  let startDay = first.getDay(); 
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
    if(d.getMonth() !== displayMonth) cell.classList.add('out');
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
  if(t) {
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

  // Affichage Salaire Estimé
  const salary = calculateMonthSalary(state.year, state.month);
  const salaryDiv = $('salaryDisplay');
  const salaryVal = $('salaryValue');
  if(salaryDiv && salaryVal) {
    salaryDiv.style.display = 'block';
    salaryVal.textContent = salary.toLocaleString('fr-FR', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  }
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

// --- EXPORT EXCEL ---
function openExportModal() {
  const firstDay = new Date(state.year, state.month, 1);
  const lastDay = new Date(state.year, state.month + 1, 0);
  $('exportStart').value = keyFor(firstDay);
  $('exportEnd').value = keyFor(lastDay);
  $('backdropExport').classList.add('show');
  $('sheetExport').classList.add('show');
}

function closeExportModal() {
  $('sheetExport').classList.remove('show');
  $('backdropExport').classList.remove('show');
}

function generateExcel() {
  const startStr = $('exportStart').value;
  const endStr = $('exportEnd').value;
  if(!startStr || !endStr) return alert("Période invalide");
  if(parseKey(endStr) < parseKey(startStr)) return alert("Date de fin < début");

  const dataRows = [];
  dataRows.push(["Date", "Jour", "Statut", "Estimation (€)"]);
  
  let totalVariable = 0;
  let current = parseKey(startStr);
  while(current <= parseKey(endStr)) {
    const k = keyFor(current);
    const entry = entries.get(k);
    const status = entry?.status || "";
    let dailyVal = 0;
    if(status === 'jour') dailyVal = prefs.rateDay;
    if(status === 'nuit') dailyVal = prefs.rateNightFull;
    
    totalVariable += dailyVal;
    dataRows.push([k, current.toLocaleDateString('fr-FR'), LABELS[status]||"", dailyVal > 0 ? dailyVal : ""]);
    current.setDate(current.getDate() + 1);
  }
  
  dataRows.push([]);
  dataRows.push(["Salaire de Base", "", "", BASE_SALARY]);
  dataRows.push(["Total Variables", "", "", totalVariable]);
  dataRows.push(["ESTIMATION TOTALE BRUTE", "", "", BASE_SALARY + totalVariable]);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(dataRows);
  XLSX.utils.book_append_sheet(wb, ws, "Paie");
  XLSX.writeFile(wb, `Paie_${startStr}_au_${endStr}.xlsx`);
  closeExportModal();
}

// --- ÉVÉNEMENTS ---
function setupEvents() {
  // Navigation
  $('btnPrevMonth').onclick = () => { state.month--; if(state.month<0){state.month=11;state.year--;} saveAndReload(); };
  $('btnNextMonth').onclick = () => { state.month++; if(state.month>11){state.month=0;state.year++;} saveAndReload(); };
  $('btnToday').onclick = () => { const n=new Date(); state.year=n.getFullYear(); state.month=n.getMonth(); state.selected=keyFor(n); saveAndReload(); };
  $('btnPrevYear').onclick = () => { state.year--; saveAndReload(); };
  $('btnNextYear').onclick = () => { state.year++; saveAndReload(); };

  function saveAndReload() {
    localStorage.setItem('state_v2', JSON.stringify(state));
    loadEntries().then(() => { renderGrid(); updateSelectionUI(); renderTotals(); });
  }

  // Actions Dock
  document.querySelectorAll('[data-set]').forEach(btn => {
    btn.onclick = () => {
      if(!state.selected) return;
      if(btn.dataset.set === 'autre') {
        $('sheetOther').style.display = 'block'; $('sheetNote').style.display = 'none';
        $('backdrop').classList.add('show'); $('sheet').classList.add('show');
      } else {
        saveEntry(state.selected, { status: btn.dataset.set, custom_label: '' });
      }
    };
  });

  // Notes & Modales
  $('btnNote').onclick = () => {
    $('sheetNote').style.display = 'block'; $('sheetOther').style.display = 'none';
    $('backdrop').classList.add('show'); $('sheet').classList.add('show');
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

  // Export
  $('btnExportXLSX').onclick = () => { openExportModal(); };
  $('btnCloseExport').onclick = closeExportModal;
  $('backdropExport').onclick = closeExportModal;
  $('btnGenerateXLSX').onclick = generateExcel;

  // Réglages
  $('btnSettings').onclick = (e) => { e.stopPropagation(); $('settingsPop').classList.toggle('show'); };
  document.onclick = () => $('settingsPop').classList.remove('show');
  $('settingsPop').onclick = (e) => e.stopPropagation();
  
  $('themeLight').onclick = () => { prefs.theme='light'; savePrefs(); applyPrefs(); };
  $('themeDark').onclick = () => { prefs.theme='dark'; savePrefs(); applyPrefs(); };
  
  if($('togQuickTap')) $('togQuickTap').onchange = (e) => { prefs.quickTap=e.target.checked; savePrefs(); };
  if($('togConfirmLogout')) $('togConfirmLogout').onchange = (e) => { prefs.confirmLogout=e.target.checked; savePrefs(); };
  if($('togPayrollShift')) $('togPayrollShift').onchange = (e) => { prefs.payrollShift=e.target.checked; savePrefs(); renderGrid(); renderTotals(); };
  
  if($('rateDay')) $('rateDay').onchange = (e) => { prefs.rateDay=parseFloat(e.target.value)||0; savePrefs(); renderTotals(); };
  if($('rateNightFull')) $('rateNightFull').onchange = (e) => { prefs.rateNightFull=parseFloat(e.target.value)||0; savePrefs(); renderTotals(); };
  if($('rateNightSolo')) $('rateNightSolo').onchange = (e) => { prefs.rateNightSolo=parseFloat(e.target.value)||0; savePrefs(); renderTotals(); };
  if($('rateHour')) $('rateHour').onchange = (e) => { prefs.rateHour=parseFloat(e.target.value)||0; savePrefs(); };

  function savePrefs() { localStorage.setItem('prefs_v2', JSON.stringify(prefs)); }

  // Authentification
  $('tabLogin').onclick = () => {
    $('paneLogin').style.display='block'; $('paneSignup').style.display='none';
    $('tabLogin').classList.add('active'); $('tabSignup').classList.remove('active');
  };
  $('tabSignup').onclick = () => {
    $('paneLogin').style.display='none'; $('paneSignup').style.display='block';
    $('tabSignup').classList.add('active'); $('tabLogin').classList.remove('active');
  };
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
}

// Démarrage
init();
