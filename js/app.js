import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// --- CONFIGURATION SUPABASE ---
const SUPABASE_URL = "https://dstmyvzjirgyuwuojwnk.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRzdG15dnpqaXJneXV3dW9qd25rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk3NzY4NTUsImV4cCI6MjA4NTM1Mjg1NX0.Cl6WAvK0elHkKXnXRtrFFiBlGABnK5RTFdawq3NGDJk";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// --- ÉTAT GLOBAL ---
let user = null;
let entries = new Map();
let state = { year: 2026, month: 0, selected: null };
let prefs = { 
  theme: 'dark', quickTap: false, confirmLogout: true,
  rateDay: 35.0, rateNightFull: 82.0, rateNightSolo: 41.0, rateHour: 13.80,
  payrollShift: false, importKeyword: '' 
};
let cellCache = new Map();
let pendingImport = [];
let codeLegend = {};

const MONTHS = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
const LABELS = { jour:"Jour", nuit:"Nuit", repos:"Repos", conges:"Congés", autre:"Autre" };
const BASE_SALARY = 2093.06;
const DAYS_FR = ["DIMANCHE", "LUNDI", "MARDI", "MERCREDI", "JEUDI", "VENDREDI", "SAMEDI"];

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const parseKey = (k) => { const [y,m,d] = k.split('-').map(Number); return new Date(y, m-1, d); };
const keyFor = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

// --- UTILITAIRE ROBUSTE ---
// Normalise tout texte : majuscules, sans accents, sans espaces superflus
const clean = (txt) => {
  if (!txt && txt !== 0) return "";
  return String(txt).toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ");
};

// --- MOTEUR DE PAIE ---
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
  if($('rateDay')) $('rateDay').value = prefs.rateDay;
  if($('rateNightFull')) $('rateNightFull').value = prefs.rateNightFull;
  if($('rateNightSolo')) $('rateNightSolo').value = prefs.rateNightSolo;
  if($('importKeyword')) $('importKeyword').value = prefs.importKeyword;
  const btnLight = $('themeLight'), btnDark = $('themeDark');
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
  data.forEach(r => entries.set(r.work_date, { status: r.status, note: r.note, custom_label: r.custom_label, imported: r.imported || false }));
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
  for(let i=0; i<7; i++) if($(`h${i}`)) $(`h${i}`).textContent = headers[i];

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
      if(entry.imported) {
        cell.style.borderStyle = 'dashed';
        cell.style.borderWidth = '2px';
        cell.style.borderColor = 'var(--accent)';
      }
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
  if($('statCount')) $('statCount').textContent = counts.jour + counts.nuit + counts.autre;
  if($('salaryValue')) {
    const salary = calculateMonthSalary(state.year, state.month);
    $('salaryValue').textContent = salary.toLocaleString('fr-FR', {minimumFractionDigits: 2, maximumFractionDigits: 2}) + ' €';
  }
}

async function saveEntry(k, patch) {
  if(!user) { if($('gate')) $('gate').classList.add('show'); return; }
  const cur = entries.get(k) || { status:'', note:'', custom_label:'', imported:false };
  const next = { ...cur, ...patch };
  entries.set(k, next);
  const cell = cellCache.get(k);
  if(cell) {
    cell.className = `day ${cell.classList.contains('out')?'out':''} ${next.status||''}`;
    if(next.imported) {
      cell.style.borderStyle = 'dashed'; cell.style.borderWidth = '2px'; cell.style.borderColor = 'var(--accent)';
    }
    const existingDot = cell.querySelector('.dot');
    if(existingDot) existingDot.remove();
    if(next.note) { const dot=document.createElement('div'); dot.className='dot'; cell.appendChild(dot); }
  }
  if(state.selected === k) updateSelectionUI();
  renderTotals();
  await supabase.from("work_calendar_entries").upsert({
    user_id: user.id, work_date: k, status: next.status, note: next.note, custom_label: next.custom_label, imported: next.imported
  }, { onConflict: "user_id,work_date" });
}

// --- IMPORT "INFAILLIBLE" (BALAYAGE GLOBAL) ---

function triggerImport() {
  if(!prefs.importKeyword || prefs.importKeyword.trim() === '') {
    alert("⚠️ Entrez votre NOM dans les Réglages > Import Sécurisé.");
    $('btnSettings').click();
    return;
  }
  $('fileInput').click();
}

function handleFileSelect(e) {
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const data = new Uint8Array(evt.target.result);
      const workbook = XLSX.read(data, { type: 'array', cellDates: false, cellText: true });
      if(!workbook.SheetNames.length) throw new Error("Fichier vide");
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
      processUniversalImport(rawData);
    } catch (err) {
      console.error(err);
      alert("❌ Erreur de lecture du fichier.");
    }
    $('fileInput').value = '';
  };
  reader.readAsArrayBuffer(file);
}

function processUniversalImport(rows) {
  const keyword = clean(prefs.importKeyword);
  if (!keyword) return alert("Nom manquant dans les réglages.");

  console.log("🔍 Analyse universelle pour :", keyword);

  // 1. Détecter la zone de dates (En-têtes)
  // On cherche la ligne qui contient le plus de jours (LUNDI, MARDI...)
  let headerRowIdx = -1;
  let maxDaysCount = 0;
  let dateColumns = {}; // Map: indexCol -> DateObj

  for(let r=0; r<Math.min(rows.length, 30); r++) {
    let count = 0;
    rows[r].forEach((cell, c) => {
      const txt = clean(cell);
      if(DAYS_FR.some(d => txt.includes(d))) count++;
    });
    if(count > maxDaysCount) {
      maxDaysCount = count;
      headerRowIdx = r;
    }
  }

  if(headerRowIdx === -1 || maxDaysCount < 3) {
    return alert("❌ Impossible de détecter les jours de la semaine dans le fichier.");
  }

  // Extraire les dates sous les en-têtes
  // On regarde la ligne d'en-tête et la suivante pour trouver des dates (12/03, 12, etc.)
  const parseDate = (str, refMonth, refYear) => {
    if(!str) return null;
    const s = String(str);
    // Format 12/03 ou 12/03/2026
    const m1 = s.match(/(\d{1,2})[/\-\.](\d{1,2})/);
    if(m1) {
      const d = parseInt(m1[1]);
      const m = parseInt(m1[2]) - 1;
      const y = s.match(/(\d{4})$/) ? parseInt(s.match(/(\d{4})$/)[1]) : refYear;
      const date = new Date(y, m, d);
      if(!isNaN(date)) return date;
    }
    // Format "12" seul (on suppose le mois de l'en-tête si présent)
    const m2 = s.match(/^\d{1,2}$/);
    if(m2 && refMonth !== -1) {
       return new Date(refYear, refMonth, parseInt(m2[0]));
    }
    return null;
  };

  // Déduire le mois/année de référence (souvent dans la ligne d'en-tête ou au dessus)
  let refYear = new Date().getFullYear();
  let refMonth = -1;
  // Tentative simple : si l'en-tête dit "LUNDI 12 JANVIER", on le prend
  const headerText = rows[headerRowIdx].join(" ").toUpperCase();
  const monthsFr = ["JANVIER","FÉVRIER","MARS","AVRIL","MAI","JUIN","JUILLET","AOÛT","SEPTEMBRE","OCTOBRE","NOVEMBRE","DÉCEMBRE"];
  monthsFr.forEach((m, idx) => { if(headerText.includes(m)) refMonth = idx; });
  if(refMonth === -1) refMonth = new Date().getMonth(); // Fallback

  for(let c=0; c<rows[headerRowIdx].length; c++) {
    // Cherche date dans la ligne d'en-tête ou la ligne du dessous
    let d = parseDate(rows[headerRowIdx][c], refMonth, refYear);
    if(!d && rows[headerRowIdx+1]) d = parseDate(rows[headerRowIdx+1][c], refMonth, refYear);
    if(d) dateColumns[c] = d;
  }

  // 2. Construire la légende (Code -> Type)
  codeLegend = {};
  let inLegend = false;
  for(let r=0; r<rows.length; r++) {
    const txt = rows[r].join(" ").toUpperCase();
    if(txt.includes("MEMO") || txt.includes("LÉGENDE") || txt.includes("CODE")) { inLegend = true; continue; }
    if(inLegend && DAYS_FR.some(d => txt.includes(d))) break; // Fin légende
    
    if(inLegend) {
      let currentCode = "";
      rows[r].forEach(cell => {
        const val = clean(cell);
        if(/^[A-Z]{1,2}[0-9]{1,3}$/.test(val)) currentCode = val;
        else if(currentCode && val.length > 3) {
          if(val.includes("NUIT")) codeLegend[currentCode] = "nuit";
          else if(val.includes("JOUR")) codeLegend[currentCode] = "jour";
          else if(val.includes("REPOS")) codeLegend[currentCode] = "repos";
          else if(val.includes("CONG")) codeLegend[currentCode] = "conges";
          currentCode = "";
        }
      });
    }
  }

  // 3. BALAYAGE GLOBAL : Trouver LE nom n'importe où
  const foundServices = [];
  let matchFound = false;

  for(let r=headerRowIdx + 1; r<rows.length; r++) {
    const row = rows[r];
    // On teste chaque cellule de la ligne
    for(let c=0; c<row.length; c++) {
      const cellVal = clean(row[c]);
      
      // CRITÈRE : La cellule contient le mot-clé (et fait plus de 3 lettres pour éviter les faux positifs)
      if(cellVal.length >= 3 && cellVal.includes(keyword)) {
        // C'est la bonne ligne ! On scanne TOUTE la ligne pour les codes
        console.log(`✅ Ligne trouvée à r=${r}, c=${c} : "${row[c]}"`);
        
        row.forEach((cellData, colIdx) => {
          const code = clean(cellData);
          // Si c'est un code valide ET qu'on a une date pour cette colonne
          if(/^[A-Z]{1,2}[0-9]{1,3}$/.test(code) && dateColumns[colIdx]) {
            const status = codeLegend[code] || "autre";
            const dateObj = dateColumns[colIdx];
            
            foundServices.push({
              dateKey: keyFor(dateObj),
              dateObj: dateObj,
              dayName: dateObj.toLocaleDateString('fr-FR', { weekday: 'long' }).toUpperCase(),
              code: code,
              status: status,
              note: `Import: ${code}`
            });
          }
        });
        matchFound = true;
        break; // On a trouvé la ligne, on arrête de chercher d'autres lignes
      }
    }
    if(matchFound) break;
  }

  if(!matchFound) {
    console.warn("Aucun match trouvé. Vérifiez l'orthographe.");
    return alert(`❌ Impossible de trouver "${prefs.importKeyword}" dans le fichier.\nVérifiez l'orthographe dans les Réglages.`);
  }

  if(foundServices.length === 0) {
    return alert("⚠️ Nom trouvé, mais aucun code (N28, etc.) détecté sur cette ligne.");
  }

  showImportPreview(foundServices);
}

function showImportPreview(services) {
  pendingImport = services;
  const list = $('importPreviewList');
  const summary = $('importSummary');
  list.innerHTML = '';
  summary.textContent = `${services.length} services trouvés.`;
  
  services.forEach(s => {
    const div = document.createElement('div');
    div.style.cssText = "padding:8px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center; font-size:13px;";
    div.innerHTML = `<span><b>${s.dayName}</b> ${s.dateObj.toLocaleDateString()}</span><span style="background:var(--surface); padding:4px 8px; border-radius:6px; font-weight:700; color:var(--accent); border:1px solid var(--border);">${s.status.toUpperCase()} (${s.code})</span>`;
    list.appendChild(div);
  });

  $('backdropImport').classList.add('show');
  $('sheetImport').classList.add('show');
}

function confirmImport() {
  if(!user) { alert("Connectez-vous."); $('gate').classList.add('show'); return; }
  let count = 0;
  const batch = [];
  pendingImport.forEach(item => {
    entries.set(item.dateKey, { status: item.status, note: item.note, custom_label: item.code, imported: true });
    const cell = cellCache.get(item.dateKey);
    if(cell) {
      cell.className = `day ${cell.classList.contains('out')?'out':''} ${item.status}`;
      cell.style.borderStyle = 'dashed'; cell.style.borderWidth = '2px'; cell.style.borderColor = 'var(--accent)';
    }
    batch.push({ user_id: user.id, work_date: item.dateKey, status: item.status, note: item.note, custom_label: item.code, imported: true });
    count++;
  });
  renderTotals();
  renderGrid();
  (async () => {
    for(const item of batch) await supabase.from("work_calendar_entries").upsert(item, { onConflict: "user_id,work_date" });
    alert(`✅ ${count} services importés !`);
    closeImportModal();
  })();
}

function closeImportModal() {
  $('sheetImport').classList.remove('show');
  $('backdropImport').classList.remove('show');
  pendingImport = [];
}

// --- EXPORT & EVENTS ---
function openExportModal() {
  const firstDay = new Date(state.year, state.month, 1);
  const lastDay = new Date(state.year, state.month + 1, 0);
  if($('exportStart')) $('exportStart').value = keyFor(firstDay);
  if($('exportEnd')) $('exportEnd').value = keyFor(lastDay);
  $('backdropExport').classList.add('show');
  $('sheetExport').classList.add('show');
}
function closeExportModal() { $('sheetExport').classList.remove('show'); $('backdropExport').classList.remove('show'); }

function generateExcel() {
  const startStr = $('exportStart').value;
  const endStr = $('exportEnd').value;
  if(!startStr || !endStr) return alert("Période invalide");
  const dataRows = [["Date", "Jour", "Statut", "Code", "Estimation (€)"]];
  let totalVariable = 0;
  let current = parseKey(startStr);
  while(current <= parseKey(endStr)) {
    const k = keyFor(current);
    const entry = entries.get(k);
    const status = entry?.status || "";
    const code = entry?.custom_label || "";
    let val = 0;
    if(status === 'jour') val = prefs.rateDay;
    if(status === 'nuit') val = prefs.rateNightFull;
    totalVariable += val;
    dataRows.push([k, current.toLocaleDateString('fr-FR'), LABELS[status]||"", code, val || ""]);
    current.setDate(current.getDate() + 1);
  }
  dataRows.push([], ["Salaire Base", "", "", "", BASE_SALARY], ["Total Variables", "", "", "", totalVariable], ["ESTIMATION TOTALE", "", "", "", BASE_SALARY + totalVariable]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dataRows), "Paie");
  XLSX.writeFile(wb, `Paie_${startStr}_au_${endStr}.xlsx`);
  closeExportModal();
}

function setupEvents() {
  if($('btnPrevMonth')) $('btnPrevMonth').onclick = () => { state.month--; if(state.month<0){state.month=11;state.year--;} localStorage.setItem('state_v2', JSON.stringify(state)); loadEntries().then(() => { renderGrid(); updateSelectionUI(); renderTotals(); }); };
  if($('btnNextMonth')) $('btnNextMonth').onclick = () => { state.month++; if(state.month>11){state.month=0;state.year++;} localStorage.setItem('state_v2', JSON.stringify(state)); loadEntries().then(() => { renderGrid(); updateSelectionUI(); renderTotals(); }); };
  if($('btnToday')) $('btnToday').onclick = () => { const n=new Date(); state.year=n.getFullYear(); state.month=n.getMonth(); state.selected=keyFor(n); localStorage.setItem('state_v2', JSON.stringify(state)); loadEntries().then(() => { renderGrid(); updateSelectionUI(); renderTotals(); }); };

  document.querySelectorAll('[data-set]').forEach(btn => {
    btn.onclick = () => {
      if(!state.selected) return;
      if(btn.dataset.set === 'autre') {
        $('sheetOther').style.display = 'block'; $('sheetNote').style.display = 'none';
        $('backdrop').classList.add('show'); $('sheet').classList.add('show');
      } else saveEntry(state.selected, { status: btn.dataset.set, custom_label: '' });
    };
  });

  const closeSheet = () => { $('sheet').classList.remove('show'); $('backdrop').classList.remove('show'); };
  if($('btnSaveNote')) $('btnSaveNote').onclick = () => { saveEntry(state.selected, { note: $('noteText').value }); closeSheet(); };
  if($('btnClearNote')) $('btnClearNote').onclick = () => { saveEntry(state.selected, { note: '' }); closeSheet(); };
  if($('btnApplyOther')) $('btnApplyOther').onclick = () => {
    const val = $('otherSelect').value;
    const custom = $('otherCustom').value;
    saveEntry(state.selected, { status: 'autre', custom_label: val==='custom'?custom:val });
    closeSheet();
  };
  if($('otherSelect')) $('otherSelect').onchange = (e) => { if($('otherCustom')) $('otherCustom').style.display = e.target.value==='custom'?'block':'none'; };

  if($('btnImport')) $('btnImport').onclick = triggerImport;
  if($('fileInput')) $('fileInput').onchange = handleFileSelect;
  if($('btnConfirmImport')) $('btnConfirmImport').onclick = confirmImport;
  if($('btnCancelImport')) $('btnCancelImport').onclick = closeImportModal;
  if($('backdropImport')) $('backdropImport').onclick = closeImportModal;

  if($('btnExportXLSX')) $('btnExportXLSX').onclick = openExportModal;
  if($('btnCloseExport')) $('btnCloseExport').onclick = closeExportModal;
  if($('backdropExport')) $('backdropExport').onclick = closeExportModal;
  if($('btnGenerateXLSX')) $('btnGenerateXLSX').onclick = generateExcel;

  if($('btnSettings')) $('btnSettings').onclick = (e) => { e.stopPropagation(); if($('settingsPop')) $('settingsPop').classList.toggle('show'); };
  document.onclick = () => { if($('settingsPop')) $('settingsPop').classList.remove('show'); };
  if($('settingsPop')) $('settingsPop').onclick = (e) => e.stopPropagation();
  
  if($('themeLight')) $('themeLight').onclick = () => { prefs.theme='light'; localStorage.setItem('prefs_v2', JSON.stringify(prefs)); applyPrefs(); };
  if($('themeDark')) $('themeDark').onclick = () => { prefs.theme='dark'; localStorage.setItem('prefs_v2', JSON.stringify(prefs)); applyPrefs(); };
  if($('rateDay')) $('rateDay').onchange = (e) => { prefs.rateDay=parseFloat(e.target.value)||0; localStorage.setItem('prefs_v2', JSON.stringify(prefs)); renderTotals(); };
  if($('rateNightFull')) $('rateNightFull').onchange = (e) => { prefs.rateNightFull=parseFloat(e.target.value)||0; localStorage.setItem('prefs_v2', JSON.stringify(prefs)); renderTotals(); };
  if($('rateNightSolo')) $('rateNightSolo').onchange = (e) => { prefs.rateNightSolo=parseFloat(e.target.value)||0; localStorage.setItem('prefs_v2', JSON.stringify(prefs)); renderTotals(); };
  
  if($('btnSaveImportConfig')) $('btnSaveImportConfig').onclick = () => {
    const val = $('importKeyword').value.trim();
    if(val) { prefs.importKeyword = val; localStorage.setItem('prefs_v2', JSON.stringify(prefs)); alert("✅ Nom enregistré localement."); $('settingsPop').classList.remove('show'); }
    else alert("Entrez un nom.");
  };

  const tabLogin = $('tabLogin'), tabSignup = $('tabSignup');
  const paneLogin = $('paneLogin'), paneSignup = $('paneSignup');
  if(tabLogin && tabSignup) {
    const switchToLogin = () => { paneLogin.style.display='block'; paneSignup.style.display='none'; tabLogin.classList.add('active'); tabSignup.classList.remove('active'); };
    tabLogin.onclick = switchToLogin;
    tabSignup.onclick = () => { paneLogin.style.display='none'; paneSignup.style.display='block'; tabSignup.classList.add('active'); tabLogin.classList.remove('active'); };
    if($('btnBackLogin')) $('btnBackLogin').onclick = switchToLogin;
  }
  
  if($('btnLogin')) $('btnLogin').onclick = async () => {
    const email = $('loginEmail').value, pass = $('loginPass').value, hint = $('loginHint');
    if(!email || !pass) { hint.textContent = "Champs requis"; return; }
    hint.textContent = "Connexion...";
    const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
    if(error) { hint.textContent = "Erreur: " + error.message; } else checkAuth();
  };
  if($('btnSignup')) $('btnSignup').onclick = async () => {
    const email = $('signEmail').value, pass = $('signPass').value;
    if(pass.length < 6) return alert("6 caractères min");
    const { error } = await supabase.auth.signUp({ email, password: pass });
    if(error) alert(error.message); else { alert("Compte créé !"); tabLogin.onclick(); }
  };
  if($('btnReset')) $('btnReset').onclick = async () => {
    const email = $('loginEmail').value;
    if(!email) return alert("Entrez email");
    await supabase.auth.resetPasswordForEmail(email);
    alert("Email envoyé");
  };
  if($('btnLogout')) $('btnLogout').onclick = async () => {
    if(prefs.confirmLogout && !confirm("Déconnexion ?")) return;
    await supabase.auth.signOut();
    checkAuth();
  };
}

init();
