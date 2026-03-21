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
// Estimation heures par type
const HOURS_EST = { jour: 8, nuit: 10, repos: 0, conges: 0, autre: 0 };

// --- UTILITAIRES ---
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const parseKey = (k) => { const [y,m,d] = k.split('-').map(Number); return new Date(y, m-1, d); };
const keyFor = (d) => `$${d.getFullYear()}-$${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

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
  // Charge 3 mois autour pour être sûr
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
  
  $('navMonth').textContent = MONTHS[state.month];
  $('navYear').textContent = state.year;
  
  const headers = ["Di/Lu", "Lu/Ma", "Ma/Me", "Me/Je", "Je/Ve", "Ve/Sa", "Sa/Di"];
  for(let i=0; i<7; i++) {
    const el = $$(`h$${i}`);
    if(el) el.textContent = headers[i];
  }

  const first = new Date(state.year, state.month, 1);
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
  $('selDate').textContent = `$${d.getDate()} $${MONTHS[d.getMonth()]}`;
  $('selState').textContent = entry?.status ? LABELS[entry.status] : "Libre";
  $('sheetTitle').textContent = `$${d.getDate()} $${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
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
      span.textContent = `$${LABELS[k]}: $${v}`;
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
    cell.className = `day $${cell.classList.contains('out')?'out':''} $${next.status||''}`;
    cell.querySelectorAll('.dot').forEach(e=>e.remove());
    if(next.note) { const dot=document.createElement('div'); dot.className='dot'; cell.appendChild(dot); }
  }
  if(state.selected === k) updateSelectionUI();
  renderTotals();
  await supabase.from("work_calendar_entries").upsert({
    user_id: user.id, work_date: k, status: next.status, note: next.note, custom_label: next.custom_label
  }, { onConflict: "user_id,work_date" });
}

// --- GESTION EXPORT EXCEL (NOUVEAU) ---
function openExportModal() {
  // Définir les dates par défaut : du 1er au dernier jour du mois en cours
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
  
  if(!startStr || !endStr) {
    alert("Veuillez sélectionner une période.");
    return;
  }

  const startDate = parseKey(startStr);
  const endDate = parseKey(endStr);
  
  if(endDate < startDate) {
    alert("La date de fin doit être après la date de début.");
    return;
  }

  // Préparation des données
  const dataRows = [];
  const stats = { jour:0, nuit:0, repos:0, conges:0, autre:0, totalHeures:0 };
  
  // En-têtes du tableau
  dataRows.push(["Date", "Jour", "Semaine", "Statut", "Libellé", "Note", "Heures Est."]);
  
  // Boucle sur la période
  let current = new Date(startDate);
  while(current <= endDate) {
    const k = keyFor(current);
    const entry = entries.get(k);
    const status = entry?.status || "";
    const label = entry?.custom_label || "";
    const note = entry?.note || "";
    
    // Calcul stats
    if(status) {
      stats[status] = (stats[status] || 0) + 1;
      const h = HOURS_EST[status] || 0;
      stats.totalHeures += h;
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
      HOURS_EST[status] || 0
    ]);
    
    current.setDate(current.getDate() + 1);
  }
  
  // Ligne vide
  dataRows.push([]);
  
  // Tableau Récapitulatif
  dataRows.push(["--- STATISTIQUES ---", "", "", "", "", "", ""]);
  dataRows.push(["Total Jours", stats.jour, "", "", "", "", ""]);
  dataRows.push(["Total Nuits", stats.nuit, "", "", "", "", ""]);
  dataRows.push(["Total Repos", stats.repos, "", "", "", "", ""]);
  dataRows.push(["Total Congés", stats.conges, "", "", "", "", ""]);
  dataRows.push(["Total Autres", stats.autre, "", "", "", "", ""]);
  dataRows.push(["TOTAL HEURES (Est.)", stats.totalHeures, "", "", "", "", ""]);
  
  // Création du fichier Excel
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(dataRows);
  
  // Ajustement largeur colonnes
  ws['!cols'] = [
    {wch: 12}, // Date
    {wch: 10}, // Jour
    {wch: 6},  // Semaine
    {wch: 10}, // Statut
    {wch: 15}, // Libellé
    {wch: 20}, // Note
    {wch: 10}  // Heures
  ];
  
  XLSX.utils.book_append_sheet(wb, ws, "Planning");
  
  // Nom du fichier
  const fileName = `Planning_$${startStr}_au_$${endStr}.xlsx`;
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

  const closeSheet = () => { $$('sheet').classList.remove('show'); $$('backdrop').classList.remove('show'); };
  $('btnCloseSheet').onclick = closeSheet;
  $('backdrop').onclick = closeSheet;
  $$('btnSaveNote').onclick = () => { saveEntry(state.selected, { note: $$('note
