import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// --- CONFIGURATION ---
const SUPABASE_URL = "https://dstmyvzjirgyuwuojwnk.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRzdG15dnpqaXJneXV3dW9qd25rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk3NzY4NTUsImV4cCI6MjA4NTM1Mjg1NX0.Cl6WAvK0elHkKXnXRtrFFiBlGABnK5RTFdawq3NGDJk";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// --- ÉTAT GLOBAL ---
let user = null;
let entries = new Map();
let state = { year: 2026, month: 0, selected: null };
let prefs = { 
  theme: 'light', 
  quickTap: false, 
  confirmLogout: true,
  // Règles de paie par défaut
  rateDay: 35,
  rateNightFull: 82,
  rateNightSolo: 41,
  rateHour: 13.80,
  payrollShift: false // Mode M+1 (décalage)
};
let cellCache = new Map();

const MONTHS = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
const LABELS = { jour:"Jour", nuit:"Nuit", repos:"Repos", conges:"Congés", autre:"Autre" };

// --- UTILITAIRES ---
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const parseKey = (k) => { const [y,m,d] = k.split('-').map(Number); return new Date(y, m-1, d); };
const keyFor = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

// --- CALCUL SALAIRE ---
function calculateDailyEarnings(dateKey, status) {
  if (!status) return 0;
  const date = parseKey(dateKey);
  const dayOfWeek = date.getDay(); // 0 = Dimanche
  const isSunday = (dayOfWeek === 0);
  
  let earnings = 0;

  if (status === 'jour') {
    earnings = parseFloat(prefs.rateDay);
    if (isSunday) earnings *= 1.5; // Majoration dimanche (exemple)
  } 
  else if (status === 'nuit') {
    // On utilise le taux "Nuit Complète" par défaut
    earnings = parseFloat(prefs.rateNightFull);
  }
  else if (status === 'autre') {
    const entry = entries.get(dateKey);
    if (entry && entry.custom_label === 'Férié') {
      earnings = parseFloat(prefs.rateDay) * 2; // Férié doublé (exemple)
    }
  }
  // Repos, Congés = 0 (le fixe est ajouté à part)
  
  return earnings;
}

function calculateMonthSalary(year, month) {
  let totalVariable = 0;
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);
  
  let current = new Date(start);
  while (current <= end) {
    const k = keyFor(current);
    const entry = entries.get(k);
    if (entry && entry.status) {
      totalVariable += calculateDailyEarnings(k, entry.status);
    }
    current.setDate(current.getDate() + 1);
  }
  
  // Ajout du fixe mensuel (2093.06 €)
  const total = totalVariable + 2093.06;
  return total;
}

// --- INITIALISATION ---
async function init() {
  loadLocalData();
  applyPrefs();
  renderGrid(); 
  updateSelectionUI();
  renderTotals(); // Inclut le salaire
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
  $('togPayrollShift').checked = prefs.payrollShift;
  
  $('rateDay').value = prefs.rateDay;
  $('rateNightFull').value = prefs.rateNightFull;
  $('rateNightSolo').value = prefs.rateNightSolo;
  $('rateHour').value = prefs.rateHour;
  
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

// --- RENDU GRILLE ---
function renderGrid() {
  const grid = $('grid');
  grid.innerHTML = '';
  cellCache.clear();
  
  // Gestion du décalage M+1 pour l'affichage
  let displayYear = state.year;
  let displayMonth = state.month;
  
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
  t.innerHTML = '';
  Object.entries(counts).forEach(([k,v]) => {
    if(v>0) {
      const span = document.createElement('span');
      span.className = 'pillchip';
      span.textContent = `${LABELS[k]}: ${v}`;
      t.appendChild(span);
    }
  });

  // Calcul et affichage du salaire
  const salary = calculateMonthSalary(state.year, state.month);
  const salaryDiv = $('salaryDisplay');
  const salaryVal = $('salaryValue');
  
  if(salaryDiv && salaryVal) {
    salaryDiv.style.display = 'block';
    salaryVal.textContent = salary.toFixed(2).replace('.', ',');
    
    if(prefs.payrollShift) {
      salaryDiv.innerHTML = `Estimation Salaire (Payé ce mois-ci) : <span id="salaryValue">${salary.toFixed(2).replace('.', ',')}</span> €`;
    } else {
      salaryDiv.innerHTML = `Estimation Salaire (Travaillé ce mois-ci) : <span id="salaryValue">${salary.toFixed(2).replace('.', ',')}</span> €`;
    }
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

// --- GESTION EXPORT EXCEL ---
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
  if(!startStr || !endStr) { alert("Veuillez sélectionner une période."); return; }

  const startDate = parseKey(startStr);
  const endDate = parseKey(endStr);
  if(endDate < startDate) { alert("La date de fin doit être après la date de début."); return; }

  const dataRows = [];
  const stats = { jour:0, nuit:0, repos:0, conges:0, autre:0, totalHeures:0, totalSalaire:0 };
  
  dataRows.push(["Date", "Jour", "Semaine", "Statut", "Libellé", "Note", "Est. Salaire (€)"]);
  
  let current = new Date(startDate);
  while(current <= endDate) {
    const k = keyFor(current);
    const entry = entries.get(k);
    const status = entry?.status || "";
    const label = entry?.custom_label || "";
    const note = entry?.note || "";
    
    const dailyEarn = calculateDailyEarnings(k, status);
    
    if(status) {
      stats[status] = (stats[status] || 0) + 1;
      stats.totalSalaire += dailyEarn;
    }
    
    const dayName = current.toLocaleDateString('fr-FR', { weekday: 'long' });
    const weekNum = getWeekNum(current);
    
    dataRows.push([
      k,
      dayName.charAt(0).toUpperCase() + dayName.slice(1),
      weekNum,
      LABELS[status] || "",
      label,
      note,
      dailyEarn > 0 ? dailyEarn.toFixed(2) : ""
    ]);
    
    current.setDate(current.getDate() + 1);
  }
  
  dataRows.push([]);
  dataRows.push(["--- STATISTIQUES ---", "", "", "", "", "", ""]);
  dataRows.push(["Total Jours", stats.jour, "", "", "", "", ""]);
  dataRows.push(["Total Nuits", stats.nuit, "", "", "", "", ""]);
  dataRows.push(["Total Repos", stats.repos, "", "", "", "", ""]);
  dataRows.push(["Total Congés", stats.conges, "", "", "", "", ""]);
  dataRows.push(["Total Autres", stats.autre, "", "", "", "", ""]);
  dataRows.push(["TOTAL SALAIRE VARIABLE", "", "", "", "", "", stats.totalSalaire.toFixed(2) + " €"]);
  dataRows.push(["(+ Fixe Mensuel)", "", "", "", "", "", "2093.06 €"]);
  dataRows.push(["ESTIMATION TOTALE", "", "", "", "", "", (stats.totalSalaire + 2093.06).toFixed(2) + " €"]);
  
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(dataRows);
  ws['!cols'] = [{wch: 12}, {wch: 10}, {wch: 6}, {wch: 10}, {wch: 15}, {wch: 20}, {wch: 12}];
  XLSX.utils.book_append_sheet(wb, ws, "Planning");
  
  const fileName = `Planning_Salaire_${startStr}_au_${endStr}.xlsx`;
  XLSX.writeFile(wb, fileName);
  closeExportModal();
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

  // Export
  $('btnExportXLSX').onclick = () => { openExportModal(); };
  $('btnCloseExport').onclick = closeExportModal;
  $('backdropExport').onclick = closeExportModal;
  $('btnGenerateXLSX').onclick = generateExcel;

  // Settings
  $('btnSettings').onclick = (e) => { e.stopPropagation(); $('settingsPop').classList.toggle('show'); };
  document.onclick = () => $('settingsPop').classList.remove('show');
  $('settingsPop').onclick = (e) => e.stopPropagation();
  
  $('themeLight').onclick = () => { prefs.theme='light'; savePrefs(); applyPrefs(); };
  $('themeDark').onclick = () => { prefs.theme='dark'; savePrefs(); applyPrefs(); };
  $('togQuickTap').onchange = (e) => { prefs.quickTap=e.target.checked; savePrefs(); };
  $('togConfirmLogout').onchange = (e) => { prefs.confirmLogout=e.target.checked; savePrefs(); };
  
  // Sauvegarde des taux de paie
  const saveRates = () => {
    prefs.rateDay = parseFloat($('rateDay').value) || 35;
    prefs.rateNightFull = parseFloat($('rateNightFull').value) || 82;
    prefs.rateNightSolo = parseFloat($('rateNightSolo').value) || 41;
    prefs.rateHour = parseFloat($('rateHour').value) || 13.8;
    prefs.payrollShift = $('togPayrollShift').checked;
    savePrefs();
    renderTotals(); // Recalculer l'affichage
  };

  $('rateDay').onchange = saveRates;
  $('rateNightFull').onchange = saveRates;
  $('rateNightSolo').onchange = saveRates;
  $('rateHour').onchange = saveRates;
  $('togPayrollShift').onchange = saveRates;

  function savePrefs() { localStorage.setItem('prefs_v2', JSON.stringify(prefs)); }

  // Auth
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
}

init();