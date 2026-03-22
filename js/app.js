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
  theme: 'dark', // Défaut sombre pour le nouveau design
  quickTap: false, 
  confirmLogout: true,
  rateDay: 35.0,
  rateNightFull: 82.0,
  rateNightSolo: 41.0,
  rateHour: 13.80,
  payrollShift: false
};
let cellCache = new Map();

const MONTHS = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
const LABELS = { jour:"Jour", nuit:"Nuit", repos:"Repos", conges:"Congés", autre:"Autre" };
const BASE_SALARY = 2093.06;

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
  
  if($('togQuickTap')) $('togQuickTap').checked = prefs.quickTap;
  if($('togConfirmLogout')) $('togConfirmLogout').checked = prefs.confirmLogout;
  if($('togPayrollShift')) $('togPayrollShift').checked = prefs.payrollShift;
  
  if($('rateDay')) $('rateDay').value = prefs.rateDay;
  if($('rateNightFull')) $('rateNightFull').value = prefs.rateNightFull;
  if($('rateNightSolo')) $('rateNightSolo').value = prefs.rateNightSolo;
  if($('rateHour')) $('rateHour').value = prefs.rateHour;
  
  // Gestion des boutons thème
  const btnLight = $('themeLight');
  const btnDark = $('themeDark');
  if(btnLight) btnLight.classList.toggle('active', prefs.theme === 'light');
  if(btnDark) btnDark.classList.toggle('active', prefs.theme === 'dark');
}

// --- AUTHENTIFICATION ---
async function checkAuth() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data?.session) {
    user = null;
    if($('topSub')) $('topSub').textContent = "Invité";
    if($('gate')) $('gate').classList.add('show');
    return;
  }
  user = data.session.user;
  if($('topSub')) $('topSub').textContent = user.email.split('@')[0];
  if($('gate')) $('gate').classList.remove('show');
  
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
  if(!grid) return;
  grid.innerHTML = '';
  cellCache.clear();
  
  let displayYear = state.year;
  let displayMonth = state.month;
  
  if (prefs.payrollShift) {
    displayMonth--;
    if (displayMonth < 0) { displayMonth = 11; displayYear--; }
  }

  if($('navMonth')) $('navMonth').textContent = MONTHS[displayMonth] + (prefs.payrollShift ? ' (N-1)' : '');
  if($('navYear')) $('navYear').textContent = displayYear;
  
  const headers = ["D/L", "L/M", "M/M", "M/J", "J/V", "V/S", "S/D"];
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
  if($('selDate')) $('selDate').textContent = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  if($('selState')) $('selState').textContent = entry?.status ? LABELS[entry.status] : "Libre";
  if($('sheetTitle')) $('sheetTitle').textContent = `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  if($('noteText')) $('noteText').value = entry?.note || '';
}

function renderTotals() {
  const counts = { jour:0, nuit:0, repos:0, conges:0, autre:0 };
  entries.forEach(e => { if(e.status) counts[e.status]++; });
  
  const t = $('totals'); // Note: dans le nouveau design, c'est .stats-bar, mais gardons la compatibilité
  // On met à jour les éléments spécifiques du nouveau design
  const statCount = $('statCount');
  const salaryVal = $('salaryValue');
  
  const totalDays = counts.jour + counts.nuit + counts.autre; // Exemple simple
  
  if(statCount) statCount.textContent = totalDays;
  if(salaryVal) {
    const salary = calculateMonthSalary(state.year, state.month);
    salaryVal.textContent = salary.toLocaleString('fr-FR', {minimumFractionDigits: 2, maximumFractionDigits: 2}) + ' €';
  }
}

async function saveEntry(k, patch) {
  if(!user) { 
    if($('gate')) $('gate').classList.add('show'); 
    return; 
  }
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
  if($('exportStart')) $('exportStart').value = keyFor(firstDay);
  if($('exportEnd')) $('exportEnd').value = keyFor(lastDay);
  if($('backdropExport')) $('backdropExport').classList.add('show');
  if($('sheetExport')) $('sheetExport').classList.add('show');
}

function closeExportModal() {
  if($('sheetExport')) $('sheetExport').classList.remove('show');
  if($('backdropExport')) $('backdropExport').classList.remove('show');
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

// --- GESTIONNAIRE D'ÉVÉNEMENTS ---
function setupEvents() {
  // Navigation
  if($('btnPrevMonth')) $('btnPrevMonth').onclick = () => { state.month--; if(state.month<0){state.month=11;state.year--;} saveAndReload(); };
  if($('btnNextMonth')) $('btnNextMonth').onclick = () => { state.month++; if(state.month>11){state.month=0;state.year++;} saveAndReload(); };
  if($('btnToday')) $('btnToday').onclick = () => { const n=new Date(); state.year=n.getFullYear(); state.month=n.getMonth(); state.selected=keyFor(n); saveAndReload(); };
  if($('btnPrevYear')) $('btnPrevYear').onclick = () => { state.year--; saveAndReload(); };
  if($('btnNextYear')) $('btnNextYear').onclick = () => { state.year++; saveAndReload(); };

  function saveAndReload() {
    localStorage.setItem('state_v2', JSON.stringify(state));
    loadEntries().then(() => { renderGrid(); updateSelectionUI(); renderTotals(); });
  }

  // Actions Dock
  document.querySelectorAll('[data-set]').forEach(btn => {
    btn.onclick = () => {
      if(!state.selected) return;
      if(btn.dataset.set === 'autre') {
        if($('sheetOther')) $('sheetOther').style.display = 'block';
        if($('sheetNote')) $('sheetNote').style.display = 'none';
        if($('backdrop')) $('backdrop').classList.add('show');
        if($('sheet')) $('sheet').classList.add('show');
      } else {
        saveEntry(state.selected, { status: btn.dataset.set, custom_label: '' });
      }
    };
  });

  // Notes & Modales
  if($('btnNote')) $('btnNote').onclick = () => {
    if($('sheetNote')) $('sheetNote').style.display = 'block';
    if($('sheetOther')) $('sheetOther').style.display = 'none';
    if($('backdrop')) $('backdrop').classList.add('show');
    if($('sheet')) $('sheet').classList.add('show');
  };

  const closeSheet = () => { 
    if($('sheet')) $('sheet').classList.remove('show'); 
    if($('backdrop')) $('backdrop').classList.remove('show'); 
  };
  if($('btnCloseSheet')) $('btnCloseSheet').onclick = closeSheet;
  if($('backdrop')) $('backdrop').onclick = closeSheet;
  if($('btnSaveNote')) $('btnSaveNote').onclick = () => { saveEntry(state.selected, { note: $('noteText').value }); closeSheet(); };
  if($('btnClearNote')) $('btnClearNote').onclick = () => { saveEntry(state.selected, { note: '' }); closeSheet(); };
  
  if($('btnApplyOther')) $('btnApplyOther').onclick = () => {
    const val = $('otherSelect').value;
    const custom = $('otherCustom').value;
    saveEntry(state.selected, { status: 'autre', custom_label: val==='custom'?custom:val });
    closeSheet();
  };
  if($('otherSelect')) $('otherSelect').onchange = (e) => { 
    if($('otherCustom')) $('otherCustom').style.display = e.target.value==='custom'?'block':'none'; 
  };

  // Export
  if($('btnExportXLSX')) $('btnExportXLSX').onclick = () => { openExportModal(); };
  if($('btnCloseExport')) $('btnCloseExport').onclick = closeExportModal;
  if($('backdropExport')) $('backdropExport').onclick = closeExportModal;
  if($('btnGenerateXLSX')) $('btnGenerateXLSX').onclick = generateExcel;

  // Réglages
  if($('btnSettings')) $('btnSettings').onclick = (e) => { e.stopPropagation(); if($('settingsPop')) $('settingsPop').classList.toggle('show'); };
  document.onclick = () => { if($('settingsPop')) $('settingsPop').classList.remove('show'); };
  if($('settingsPop')) $('settingsPop').onclick = (e) => e.stopPropagation();
  
  if($('themeLight')) $('themeLight').onclick = () => { prefs.theme='light'; savePrefs(); applyPrefs(); };
  if($('themeDark')) $('themeDark').onclick = () => { prefs.theme='dark'; savePrefs(); applyPrefs(); };
  
  if($('togQuickTap')) $('togQuickTap').onchange = (e) => { prefs.quickTap=e.target.checked; savePrefs(); };
  if($('togConfirmLogout')) $('togConfirmLogout').onchange = (e) => { prefs.confirmLogout=e.target.checked; savePrefs(); };
  if($('togPayrollShift')) $('togPayrollShift').onchange = (e) => { prefs.payrollShift=e.target.checked; savePrefs(); renderGrid(); renderTotals(); };
  
  if($('rateDay')) $('rateDay').onchange = (e) => { prefs.rateDay=parseFloat(e.target.value)||0; savePrefs(); renderTotals(); };
  if($('rateNightFull')) $('rateNightFull').onchange = (e) => { prefs.rateNightFull=parseFloat(e.target.value)||0; savePrefs(); renderTotals(); };
  if($('rateNightSolo')) $('rateNightSolo').onchange = (e) => { prefs.rateNightSolo=parseFloat(e.target.value)||0; savePrefs(); renderTotals(); };
  if($('rateHour')) $('rateHour').onchange = (e) => { prefs.rateHour=parseFloat(e.target.value)||0; savePrefs(); };

  function savePrefs() { localStorage.setItem('prefs_v2', JSON.stringify(prefs)); }

  // --- AUTHENTIFICATION (CORRIGÉ ET COMPLET) ---
  const tabLogin = $('tabLogin');
  const tabSignup = $('tabSignup');
  const paneLogin = $('paneLogin');
  const paneSignup = $('paneSignup');

  if(tabLogin && tabSignup && paneLogin && paneSignup) {
    tabLogin.onclick = () => {
      paneLogin.style.display = 'block';
      paneSignup.style.display = 'none';
      tabLogin.classList.add('active');
      tabSignup.classList.remove('active');
    };
    tabSignup.onclick = () => {
      paneLogin.style.display = 'none';
      paneSignup.style.display = 'block';
      tabSignup.classList.add('active');
      tabLogin.classList.remove('active');
    };
    if($('btnBackLogin')) $('btnBackLogin').onclick = tabLogin.onclick;
  }

  const btnLogin = $('btnLogin');
  if(btnLogin) {
    btnLogin.onclick = async () => {
      const email = $('loginEmail').value;
      const pass = $('loginPass').value;
      const hint = $('loginHint');
      
      if(!email || !pass) {
        hint.textContent = "Veuillez remplir tous les champs.";
        hint.style.color = "#f43f5e";
        return;
      }

      hint.textContent = "Connexion en cours...";
      hint.style.color = "var(--text-muted)";
      btnLogin.disabled = true;
      btnLogin.style.opacity = "0.7";

      try {
        const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
        if(error) { 
          hint.textContent = "Erreur: " + error.message; 
          hint.style.color = "#f43f5e";
          btnLogin.disabled = false;
          btnLogin.style.opacity = "1";
        } else { 
          checkAuth();
        }
      } catch (e) {
        hint.textContent = "Erreur réseau.";
        btnLogin.disabled = false;
        btnLogin.style.opacity = "1";
      }
    };
  }

  const btnSignup = $('btnSignup');
  if(btnSignup) {
    btnSignup.onclick = async () => {
      const email = $('signEmail').value;
      const pass = $('signPass').value;
      if(pass.length < 6) return alert("6 caractères min");
      const { error } = await supabase.auth.signUp({ email, password: pass });
      if(error) alert(error.message);
      else { 
        alert("Compte créé ! Connectez-vous."); 
        if(tabLogin) tabLogin.onclick(); 
      }
    };
  }

  const btnReset = $('btnReset');
  if(btnReset) {
    btnReset.onclick = async () => {
      const email = $('loginEmail').value;
      if(!email) return alert("Entrez votre email d'abord");
      await supabase.auth.resetPasswordForEmail(email);
      alert("Email de réinitialisation envoyé");
    };
  }

  const btnLogout = $('btnLogout');
  if(btnLogout) {
    btnLogout.onclick = async () => {
      if(prefs.confirmLogout && !confirm("Déconnexion ?")) return;
      await supabase.auth.signOut();
      checkAuth();
    };
  }
}

// Démarrage
init();
