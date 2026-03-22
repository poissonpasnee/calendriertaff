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

const MONTHS = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
const LABELS = { jour:"Jour", nuit:"Nuit", repos:"Repos", conges:"Congés", autre:"Autre" };
const BASE_SALARY = 2093.06;

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
  if(!user) { if($('gate')) $('gate').classList.add('show'); return; }
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

// --- IMPORT EXCEL "UNIVERSAL READER" ---

function triggerImport() {
  if(!prefs.importKeyword || prefs.importKeyword.trim() === '') {
    alert("⚠️ Veuillez configurer votre NOM (ex: MARTIN) dans les Réglages (roue dentée) > section 'Import Sécurisé'.");
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
      // Lecture brute de TOUTES les cellules, sans interprétation
      const workbook = XLSX.read(data, { type: 'array', cellDates: false, cellText: true, sheetStubs: true });
      
      if(!workbook.SheetNames.length) throw new Error("Fichier vide");

      // On prend la première feuille
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      // Conversion en tableau complet (tableau de tableaux)
      const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });

      processUniversalData(rawData);
    } catch (err) {
      console.error(err);
      alert("❌ Erreur de lecture. Essayez d'enregistrer le fichier en '.xlsx' standard via Excel.");
    }
    $('fileInput').value = '';
  };
  reader.readAsArrayBuffer(file);
}

function processUniversalData(rows) {
  const keyword = prefs.importKeyword.toUpperCase().trim();
  if(keyword.length < 2) {
    alert("Le mot-clé est trop court. Entrez au moins 3 lettres (ex: votre nom de famille).");
    return;
  }

  // 1. Construire le Dictionnaire des Codes (Memo -> Type)
  // On cherche n'importe où dans le fichier les mots "MEMO", "N°", "JOUR/NUIT"
  const codeMap = {};
  let inMemoSection = false;

  // On scanne tout le fichier pour trouver la légende
  for(let r=0; r<rows.length; r++) {
    const rowText = rows[r].join(" ").toUpperCase();
    
    // Détection du début de la section Mémo
    if(rowText.includes("MEMO") || rowText.includes("N° / MEMO")) {
      inMemoSection = true;
      continue;
    }
    // Si on est dans la section et qu'on trouve une ligne vide ou un nouveau titre, on arrête
    if(inMemoSection && (rowText.trim() === "" || rowText.includes("ACTIVITÉ") || rowText.includes("TOTAL"))) {
      // On continue car parfois la légende est longue, on s'arrêtera au prochain bloc logique ou fin de fichier
      // Pour simplifier, on considère que tout ce qui ressemble à "CODE = TYPE" est bon à prendre
    }

    if(inMemoSection) {
      // On cherche des motifs type "N28", "J12", "R45" suivis de "JOUR" ou "NUIT"
      // On récupère toutes les cellules de la ligne
      const cells = rows[r];
      let codeCandidate = "";
      let typeCandidate = "";

      for(let c=0; c<cells.length; c++) {
        const cell = String(cells[c]).toUpperCase().trim();
        // Si la cellule ressemble à un code (Lettre + Chiffre)
        if(/^[A-Z]{1,2}[0-9]{1,3}$/.test(cell)) {
          codeCandidate = cell;
        }
        // Si la cellule contient JOUR ou NUIT
        if(cell.includes("JOUR") && !cell.includes("JOURNÉE")) typeCandidate = "jour";
        if(cell.includes("NUIT")) typeCandidate = "nuit";
        if(cell.includes("REPOS")) typeCandidate = "repos";
      }

      if(codeCandidate && typeCandidate) {
        codeMap[codeCandidate] = typeCandidate;
      }
    }
  }

  // 2. Trouver VOTRE NOM et extraire vos services
  const foundServices = [];
  const daysFr = ["DIMANCHE", "LUNDI", "MARDI", "MERCREDI", "JEUDI", "VENDREDI", "SAMEDI"];
  
  // On scanne chaque ligne pour trouver le nom
  for(let r=0; r<rows.length; r++) {
    const row = rows[r];
    const rowText = row.join(" ").toUpperCase();

    // Vérifie si le nom est dans cette ligne
    if(rowText.includes(keyword)) {
      // On a trouvé une ligne potentielle. Maintenant on cherche la DATE et le CODE.
      
      let dateObj = null;
      let codeFound = "";
      let dayName = "";

      // Parcours des cellules de la ligne
      for(let c=0; c<row.length; c++) {
        const cell = String(row[c]).trim();
        const cellUpper = cell.toUpperCase();

        // A. Chercher la date (ex: "12/03/2026" ou "12 mars")
        if(!dateObj) {
          // Test format JJ/MM/AAAA
          const dateMatch = cell.match(/(\d{1,2})[/\-\.](\d{1,2})[/\-\.](\d{2,4})/);
          if(dateMatch) {
            const d = new Date(`${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`);
            if(!isNaN(d.getTime())) dateObj = d;
          }
          // Test format "LUNDI 12" (si Excel a gardé le texte)
          if(!dateObj) {
             for(let day of daysFr) {
               if(cellUpper.includes(day)) {
                 // Tentative d'extraction du chiffre à côté
                 const numMatch = cell.match(/(\d{1,2})/);
                 if(numMatch) {
                   // On essaie de construire une date avec le mois courant ou prochain
                   const currentMonth = new Date().getMonth();
                   const d = new Date(2026, currentMonth, parseInt(numMatch[1])); // Année par défaut 2026 à ajuster si besoin
                   if(!isNaN(d.getTime())) {
                     dateObj = d;
                     dayName = day;
                   }
                 }
               }
             }
          }
        }

        // B. Chercher le code chantier (ex: N28)
        if(!codeFound && /^[A-Z]{1,2}[0-9]{1,3}$/.test(cellUpper)) {
          // Vérifier que ce n'est pas une date ou autre chose
          if(!cellUpper.includes("LUNDI") && !cellUpper.includes("MARDI")) {
             codeFound = cellUpper;
          }
        }
        
        // C. Chercher le jour de la semaine explicite si pas trouvé dans la date
        if(!dayName) {
          for(let day of daysFr) {
            if(cellUpper.includes(day)) dayName = day;
          }
        }
      }

      // Si on a un code et une date (ou un jour), on valide
      if(codeFound && (dateObj || dayName)) {
        const status = codeMap[codeFound] || "autre";
        
        // Si pas de dateObj précise, on essaie de déduire l'année/mois du contexte (simplifié ici : on prend le mois en cours)
        if(!dateObj && dayName) {
           // Cas complexe : on a "LUNDI" et "N28" mais pas la date complète. 
           // On ne peut pas importer sans date précise. On skip ou on demande à l'utilisateur.
           // Pour l'instant, on skip les lignes sans date complète pour éviter les erreurs.
           continue; 
        }

        if(dateObj) {
          foundServices.push({
            dateKey: keyFor(dateObj),
            dateObj: dateObj,
            dayName: dayName || dateObj.toLocaleDateString('fr-FR', { weekday: 'long' }).toUpperCase(),
            code: codeFound,
            status: status,
            note: `Import: ${codeFound}`
          });
        }
      }
    }
  }

  if(foundServices.length === 0) {
    alert(`❌ Aucun service trouvé pour "${keyword}".\n\nVérifiez que :\n1. Votre nom est écrit exactement comme dans le fichier (ex: MARTIN).\n2. Le fichier contient bien des codes (ex: N28) et des jours.\n3. Les dates sont au format reconnu (JJ/MM/AAAA).`);
    return;
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
  if(!user) { alert("Connectez-vous pour importer."); $('gate').classList.add('show'); return; }

  let count = 0;
  const batch = [];
  pendingImport.forEach(item => {
    entries.set(item.dateKey, { status: item.status, note: item.note, custom_label: item.code, imported: true });
    const cell = cellCache.get(item.dateKey);
    if(cell) {
      cell.className = `day ${cell.classList.contains('out')?'out':''} ${item.status}`;
      cell.style.borderStyle = 'dashed';
      cell.style.borderWidth = '2px';
      cell.style.borderColor = 'var(--accent)';
    }
    batch.push({ user_id: user.id, work_date: item.dateKey, status: item.status, note: item.note, custom_label: item.code, imported: true });
    count++;
  });

  renderTotals();
  renderGrid();

  (async () => {
    for(const item of batch) {
      await supabase.from("work_calendar_entries").upsert(item, { onConflict: "user_id,work_date" });
    }
    alert(`✅ ${count} services importés !`);
    closeImportModal();
  })();
}

function closeImportModal() {
  $('sheetImport').classList.remove('show');
  $('backdropImport').classList.remove('show');
  pendingImport = [];
}

// --- EXPORT & EVENTS (Identiques) ---
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
  if($('btnPrevMonth')) $('btnPrevMonth').onclick = () => { state.month--; if(state.month<0){state.month=11;state.year--;} saveAndReload(); };
  if($('btnNextMonth')) $('btnNextMonth').onclick = () => { state.month++; if(state.month>11){state.month=0;state.year++;} saveAndReload(); };
  if($('btnToday')) $('btnToday').onclick = () => { const n=new Date(); state.year=n.getFullYear(); state.month=n.getMonth(); state.selected=keyFor(n); saveAndReload(); };
  function saveAndReload() { localStorage.setItem('state_v2', JSON.stringify(state)); loadEntries().then(() => { renderGrid(); updateSelectionUI(); renderTotals(); }); }

  document.querySelectorAll('[data-set]').forEach(btn => {
    btn.onclick = () => {
      if(!state.selected) return;
      if(btn.dataset.set === 'autre') {
        $('sheetOther').style.display = 'block'; $('sheetNote').style.display = 'none';
        $('backdrop').classList.add('show'); $('sheet').classList.add('show');
      } else saveEntry(state.selected, { status: btn.dataset.set, custom_label: '' });
    };
  });

  if($('btnNote')) $('btnNote').onclick = () => { $('sheetNote').style.display = 'block'; $('sheetOther').style.display = 'none'; $('backdrop').classList.add('show'); $('sheet').classList.add('show'); };
  const closeSheet = () => { $('sheet').classList.remove('show'); $('backdrop').classList.remove('show'); };
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
  if($('otherSelect')) $('otherSelect').onchange = (e) => { if($('otherCustom')) $('otherCustom').style.display = e.target.value==='custom'?'block':'none'; };

  // Import Events
  if($('btnImport')) $('btnImport').onclick = triggerImport;
  if($('fileInput')) $('fileInput').onchange = handleFileSelect;
  if($('btnConfirmImport')) $('btnConfirmImport').onclick = confirmImport;
  if($('btnCancelImport')) $('btnCancelImport').onclick = closeImportModal;
  if($('backdropImport')) $('backdropImport').onclick = closeImportModal;

  // Export Events
  if($('btnExportXLSX')) $('btnExportXLSX').onclick = openExportModal;
  if($('btnCloseExport')) $('btnCloseExport').onclick = closeExportModal;
  if($('backdropExport')) $('backdropExport').onclick = closeExportModal;
  if($('btnGenerateXLSX')) $('btnGenerateXLSX').onclick = generateExcel;

  // Settings
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
  
  if($('btnSaveImportConfig')) $('btnSaveImportConfig').onclick = () => {
    const val = $('importKeyword').value.trim();
    if(val) { prefs.importKeyword = val; savePrefs(); alert("✅ Nom enregistré localement."); $('settingsPop').classList.remove('show'); }
    else alert("Entrez un nom.");
  };
  function savePrefs() { localStorage.setItem('prefs_v2', JSON.stringify(prefs)); }

  // Auth
  const tabLogin = $('tabLogin'), tabSignup = $('tabSignup');
  const paneLogin = $('paneLogin'), paneSignup = $('paneSignup');
  if(tabLogin && tabSignup) {
    tabLogin.onclick = () => { paneLogin.style.display='block'; paneSignup.style.display='none'; tabLogin.classList.add('active'); tabSignup.classList.remove('active'); };
    tabSignup.onclick = () => { paneLogin.style.display='none'; paneSignup.style.display='block'; tabSignup.classList.add('active'); tabLogin.classList.remove('active'); };
    if($('btnBackLogin')) $('btnBackLogin').onclick = tabLogin.onclick;
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
