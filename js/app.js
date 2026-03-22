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
  theme: 'dark', 
  quickTap: false, 
  confirmLogout: true,
  rateDay: 35.0,
  rateNightFull: 82.0,
  rateNightSolo: 41.0,
  rateHour: 13.80,
  payrollShift: false,
  importKeyword: '' // Votre nom pour l'import (stocké localement)
};
let cellCache = new Map();
let pendingImport = []; // Données temporaires avant confirmation

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
  data.forEach(r => entries.set(r.work_date, { 
    status: r.status, 
    note: r.note, 
    custom_label: r.custom_label, 
    imported: r.imported || false 
  }));
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
      // Style spécial si importé (pointillés)
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
  
  const statCount = $('statCount');
  const salaryVal = $('salaryValue');
  const totalDays = counts.jour + counts.nuit + counts.autre;
  
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
  const cur = entries.get(k) || { status:'', note:'', custom_label:'', imported:false };
  const next = { ...cur, ...patch };
  entries.set(k, next);
  
  const cell = cellCache.get(k);
  if(cell) {
    cell.className = `day ${cell.classList.contains('out')?'out':''} ${next.status||''}`;
    if(next.imported) {
      cell.style.borderStyle = 'dashed';
      cell.style.borderWidth = '2px';
      cell.style.borderColor = 'var(--accent)';
    }
    cell.querySelectorAll('.dot').forEach(e=>e.remove());
    if(next.note) { const dot=document.createElement('div'); dot.className='dot'; cell.appendChild(dot); }
  }
  
  if(state.selected === k) updateSelectionUI();
  renderTotals();
  
  await supabase.from("work_calendar_entries").upsert({
    user_id: user.id, work_date: k, status: next.status, note: next.note, custom_label: next.custom_label, imported: next.imported
  }, { onConflict: "user_id,work_date" });
}

// --- IMPORT EXCEL INTELLIGENT & SÉCURISÉ ---

function triggerImport() {
  if(!prefs.importKeyword || prefs.importKeyword.trim() === '') {
    alert("⚠️ Veuillez d'abord configurer votre nom dans les Réglages (roue dentée) > section 'Import Sécurisé'.\nC'est indispensable pour vous identifier dans le fichier.");
    $('btnSettings').click();
    return;
  }
  $('fileInput').click();
}

function handleFileSelect(e) {
  const file = e.target.files[0];
  if(!file) return;

  // Vérification extension
  const fileName = file.name.toLowerCase();
  if(!fileName.endsWith('.xlsx') && !fileName.endsWith('.xls')) {
    alert("⚠️ Ce fichier ne semble pas être un Excel valide (.xlsx).\n\nSolution : Ouvrez le fichier dans Excel, faites 'Enregistrer sous' et choisissez 'Classeur Excel (.xlsx)' standard.");
    return;
  }

  const reader = new FileReader();
  
  reader.onerror = (err) => {
    console.error("Erreur lecture fichier:", err);
    alert("❌ Impossible de lire le fichier. Assurez-vous qu'il n'est pas ouvert dans Excel en même temps.");
  };

  reader.onload = (evt) => {
    try {
      const data = new Uint8Array(evt.target.result);
      
      // Options de lecture robustes
      const workbook = XLSX.read(data, { 
        type: 'array', 
        cellDates: true, // Force la lecture des dates
        cellNF: true,    // Garde le formatage nombre
        cellText: true,  // Garde le texte brut (important pour "N28")
        sheetStubs: true // Lit même les cellules vides
      });

      if(!workbook.SheetNames || workbook.SheetNames.length === 0) {
        throw new Error("Aucune feuille de calcul trouvée.");
      }

      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      
      // Conversion en JSON brut (tableau de tableaux)
      const jsonData = XLSX.utils.sheet_to_json(firstSheet, { 
        header: 1, 
        raw: false, // Utilise le texte affiché
        dateNF: 'dd/mm/yyyy', 
        defval: "" // Remplace les vides par chaîne vide
      });

      if(jsonData.length === 0) {
        throw new Error("Le fichier semble vide.");
      }

      processExcelData(jsonData);
      
    } catch (err) {
      console.error("Erreur détaillée:", err);
      alert("❌ Erreur de lecture : " + err.message + "\n\n💡 Solution la plus fréquente :\n1. Ouvrez le fichier dans Excel.\n2. Faites 'Enregistrer sous'.\n3. Choisissez 'Classeur Excel (.xlsx)' (format standard).\n4. Réimportez ce nouveau fichier.");
    }
    $('fileInput').value = ''; 
  };
  
  reader.readAsArrayBuffer(file);
}

function processExcelData(rows) {
  // 1. Trouver la ligne d'en-tête contenant "N° / MEMO" ou "MEMO" et "JOUR/NUIT"
  let headerRowIndex = -1;
  let colIndex = { code: -1, type: -1, date: -1, name: -1 };
  
  // On scanne les 50 premières lignes pour trouver les en-têtes
  for(let i=0; i<Math.min(rows.length, 100); i++) {
    const row = rows[i].map(c => String(c||'').toUpperCase().trim());
    
    const memoIdx = row.findIndex(c => c.includes('MEMO') || c.includes('N°'));
    const typeIdx = row.findIndex(c => c.includes('JOUR') && c.includes('NUIT'));
    
    if(memoIdx !== -1 && typeIdx !== -1) {
      headerRowIndex = i;
      colIndex.code = memoIdx;
      colIndex.type = typeIdx;
      
      // La date est souvent la colonne juste avant le code ou une colonne nommée DATE
      colIndex.date = row.findIndex(c => c.includes('DATE'));
      if(colIndex.date === -1) colIndex.date = colIndex.code - 1;
      
      // Le nom est souvent en première colonne ou colonne "AGENT"
      const nameIdx = row.findIndex(c => c.includes('AGENT') || c.includes('NOM') || c.includes('MATRICULE'));
      colIndex.name = nameIdx !== -1 ? nameIdx : 0;
      break;
    }
  }

  if(headerRowIndex === -1 || colIndex.code === -1 || colIndex.type === -1) {
    alert("❌ Structure Excel non reconnue.\n\nAssurez-vous que le fichier contient bien les colonnes :\n- 'N° / MEMO' (ou 'MEMO')\n- 'Jour/Nuit'");
    return;
  }

  // 2. Construire le dictionnaire Code (ex: N28) -> Type (Nuit/Jour)
  // On lit toute la section "Mémo" pour créer la correspondance
  const codeMap = {};
  for(let i=headerRowIndex+1; i<rows.length; i++) {
    const row = rows[i];
    // Si la ligne est vide ou ne contient pas de code, on skip
    if(!row[colIndex.code]) continue;

    const code = String(row[colIndex.code]).trim();
    const typeVal = row[colIndex.type] ? String(row[colIndex.type]).toUpperCase().trim() : '';
    
    // On évite d'écraser si déjà vu, sauf si vide
    if(code && !codeMap[code]) {
      if(typeVal.includes('NUIT')) codeMap[code] = 'nuit';
      else if(typeVal.includes('JOUR')) codeMap[code] = 'jour';
      else if(typeVal.includes('REPOS')) codeMap[code] = 'repos';
      else codeMap[code] = 'autre';
    }
  }

  // 3. Filtrer les lignes par Votre Nom (Keyword)
  const keyword = prefs.importKeyword.toUpperCase();
  const foundServices = [];

  for(let i=headerRowIndex+1; i<rows.length; i++) {
    const row = rows[i];
    // Vérifie si la ligne contient le nom dans la colonne identifiée
    const nameCell = row[colIndex.name] ? String(row[colIndex.name]).toUpperCase().trim() : '';
    
    // On matche si le nom correspond EXACTEMENT ou contient le keyword (si keyword > 3 lettres)
    const isMatch = nameCell === keyword || (keyword.length > 3 && nameCell.includes(keyword));

    if(isMatch) {
      const dateVal = row[colIndex.date];
      const codeVal = row[colIndex.code] ? String(row[colIndex.code]).trim() : '';
      
      if(dateVal && codeVal) {
        let dateObj;
        if(dateVal instanceof Date) {
          dateObj = dateVal;
        } else {
          dateObj = new Date(dateVal);
          // Si la date n'est pas valide (NaN), on essaie de parser manuellement si c'est un string "Lundi 12..."
          if(isNaN(dateObj.getTime())) {
             // Cas rare où Excel lit mal la date, on skip pour l'instant
             continue; 
          }
        }

        if(!isNaN(dateObj.getTime())) {
          const status = codeMap[codeVal] || 'autre';
          const dayName = dateObj.toLocaleDateString('fr-FR', { weekday: 'long' }).toUpperCase();
          
          foundServices.push({
            dateKey: keyFor(dateObj),
            dateObj: dateObj,
            dayName: dayName,
            code: codeVal,
            status: status,
            note: `Import: ${codeVal}`
          });
        }
      }
    }
  }

  if(foundServices.length === 0) {
    alert(`Aucun service trouvé pour le nom "${keyword}".\n\nVérifiez :\n1. L'orthographe dans les Réglages > Import.\n2. Que votre nom apparaît bien dans la colonne identifiée du fichier.`);
    return;
  }

  showImportPreview(foundServices);
}

function showImportPreview(services) {
  pendingImport = services;
  const list = $('importPreviewList');
  const summary = $('importSummary');
  list.innerHTML = '';
  
  summary.textContent = `${services.length} services trouvés pour "${prefs.importKeyword}".`;
  
  services.forEach(s => {
    const div = document.createElement('div');
    div.style.cssText = "padding:8px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center; font-size:13px;";
    div.innerHTML = `
      <span><b>${s.dayName}</b> ${s.dateObj.toLocaleDateString()}</span>
      <span style="background:var(--surface); padding:4px 8px; border-radius:6px; font-weight:700; color:var(--accent); border:1px solid var(--border);">
        ${s.status.toUpperCase()} (${s.code})
      </span>
    `;
    list.appendChild(div);
  });

  $('backdropImport').classList.add('show');
  $('sheetImport').classList.add('show');
}

function confirmImport() {
  if(!user) {
    alert("Veuillez vous connecter pour importer des données.");
    $('gate').classList.add('show');
    return;
  }

  let count = 0;
  const batch = [];

  pendingImport.forEach(item => {
    // Mise à jour locale immédiate
    entries.set(item.dateKey, {
      status: item.status,
      note: item.note,
      custom_label: item.code,
      imported: true
    });
    
    const cell = cellCache.get(item.dateKey);
    if(cell) {
      cell.className = `day ${cell.classList.contains('out')?'out':''} ${item.status}`;
      cell.style.borderStyle = 'dashed';
      cell.style.borderWidth = '2px';
      cell.style.borderColor = 'var(--accent)';
    }
    
    batch.push({
      user_id: user.id,
      work_date: item.dateKey,
      status: item.status,
      note: item.note,
      custom_label: item.code,
      imported: true
    });
    count++;
  });

  renderTotals();
  renderGrid(); // Rafraîchir pour afficher les pointillés

  // Sauvegarde en masse (par lots séquentiels pour éviter les limites)
  const saveBatch = async (items) => {
    for(const item of items) {
      await supabase.from("work_calendar_entries").upsert(item, { onConflict: "user_id,work_date" });
    }
  };

  saveBatch(batch).then(() => {
    alert(`✅ ${count} services importés avec succès !\nLes cases importées sont entourées en pointillés.`);
    closeImportModal();
  }).catch(err => {
    console.error(err);
    alert("Erreur lors de la sauvegarde. Vérifiez votre connexion Internet.");
  });
}

function closeImportModal() {
  $('sheetImport').classList.remove('show');
  $('backdropImport').classList.remove('show');
  pendingImport = [];
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
  dataRows.push(["Date", "Jour", "Statut", "Code Chantier", "Estimation (€)"]);
  
  let totalVariable = 0;
  let current = parseKey(startStr);
  while(current <= parseKey(endStr)) {
    const k = keyFor(current);
    const entry = entries.get(k);
    const status = entry?.status || "";
    const code = entry?.custom_label || "";
    let dailyVal = 0;
    if(status === 'jour') dailyVal = prefs.rateDay;
    if(status === 'nuit') dailyVal = prefs.rateNightFull;
    
    totalVariable += dailyVal;
    dataRows.push([k, current.toLocaleDateString('fr-FR'), LABELS[status]||"", code, dailyVal > 0 ? dailyVal : ""]);
    current.setDate(current.getDate() + 1);
  }
  
  dataRows.push([]);
  dataRows.push(["Salaire de Base", "", "", "", BASE_SALARY]);
  dataRows.push(["Total Variables", "", "", "", totalVariable]);
  dataRows.push(["ESTIMATION TOTALE BRUTE", "", "", "", BASE_SALARY + totalVariable]);

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

  // --- IMPORT EVENTS ---
  if($('btnImport')) $('btnImport').onclick = triggerImport;
  if($('fileInput')) $('fileInput').onchange = handleFileSelect;
  if($('btnConfirmImport')) $('btnConfirmImport').onclick = confirmImport;
  if($('btnCancelImport')) $('btnCancelImport').onclick = closeImportModal;
  if($('backdropImport')) $('backdropImport').onclick = closeImportModal;

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
  
  // Sauvegarde du mot-clé d'import
  if($('btnSaveImportConfig')) $('btnSaveImportConfig').onclick = () => {
    const val = $('importKeyword').value.trim();
    if(val) {
      prefs.importKeyword = val;
      savePrefs();
      alert("✅ Nom enregistré localement. Vous pouvez maintenant importer vos fichiers Excel en toute confidentialité.");
      $('settingsPop').classList.remove('show');
    } else {
      alert("Veuillez entrer un nom ou un identifiant.");
    }
  };

  function savePrefs() { localStorage.setItem('prefs_v2', JSON.stringify(prefs)); }

  // Authentification
  const tabLogin = $('tabLogin'), tabSignup = $('tabSignup');
  const paneLogin = $('paneLogin'), paneSignup = $('paneSignup');

  if(tabLogin && tabSignup && paneLogin && paneSignup) {
    tabLogin.onclick = () => {
      paneLogin.style.display = 'block'; paneSignup.style.display = 'none';
      tabLogin.classList.add('active'); tabSignup.classList.remove('active');
    };
    tabSignup.onclick = () => {
      paneLogin.style.display = 'none'; paneSignup.style.display = 'block';
      tabSignup.classList.add('active'); tabLogin.classList.remove('active');
    };
    if($('btnBackLogin')) $('btnBackLogin').onclick = tabLogin.onclick;
  }

  const btnLogin = $('btnLogin');
  if(btnLogin) {
    btnLogin.onclick = async () => {
      const email = $('loginEmail').value;
      const pass = $('loginPass').value;
      const hint = $('loginHint');
      if(!email || !pass) { hint.textContent = "Champs requis"; hint.style.color="#f43f5e"; return; }
      hint.textContent = "Connexion..."; hint.style.color="var(--text-muted)";
      btnLogin.disabled = true; btnLogin.style.opacity = "0.7";
      
      const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
      if(error) { 
        hint.textContent = "Erreur: " + error.message; hint.style.color="#f43f5e";
        btnLogin.disabled = false; btnLogin.style.opacity = "1";
      } else { checkAuth(); }
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
      else { alert("Compte créé ! Connectez-vous."); tabLogin.onclick(); }
    };
  }

  const btnReset = $('btnReset');
  if(btnReset) {
    btnReset.onclick = async () => {
      const email = $('loginEmail').value;
      if(!email) return alert("Entrez email");
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
