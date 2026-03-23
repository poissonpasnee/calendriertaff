import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// --- CONFIGURATION ---
const SUPABASE_URL = "https://dstmyvzjirgyuwuojwnk.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRzdG15dnpqaXJneXV3dW9qd25rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk3NzY4NTUsImV4cCI6MjA4NTM1Mjg1NX0.Cl6WAvK0elHkKXnXRtrFFiBlGABnK5RTFdawq3NGDJk";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// --- ÉTAT GLOBAL ---
let user = null;
let entries = new Map();
let state = { year: new Date().getFullYear(), month: new Date().getMonth(), selected: null };
let prefs = { theme: 'dark', rateDay: 35.0, rateNightFull: 82.0, rateNightSolo: 41.0 };
let cellCache = new Map();
let pendingImport = [];
let codeLegend = {}; // Stockera la légende lue dans l'Excel

const MONTHS = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
const LABELS = { jour:"Jour", nuit:"Nuit", repos:"Repos", conges:"Congés", autre:"Autre" };
const BASE_SALARY = 2093.06;
const DAYS_FR = ["DIMANCHE", "LUNDI", "MARDI", "MERCREDI", "JEUDI", "VENDREDI", "SAMEDI"];

// --- UTILITAIRES ---
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const keyFor = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parseKey = (k) => { const [y,m,d] = k.split('-').map(Number); return new Date(y, m-1, d); };

// Nettoie le texte : garde seulement Lettres et Chiffres, met en MAJUSCULE
const clean = (txt) => {
  if (txt === null || txt === undefined) return "";
  return String(txt).toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9]/g, "");
};

// --- MOTEUR DE PAIE ---
function calculateSalary() {
  let total = 0;
  const end = new Date(state.year, state.month + 1, 0);
  for (let d = 1; d <= end.getDate(); d++) {
    const k = keyFor(new Date(state.year, state.month, d));
    const e = entries.get(k);
    if (e?.status === 'jour') total += parseFloat(prefs.rateDay);
    if (e?.status === 'nuit') total += parseFloat(prefs.rateNightFull);
  }
  return BASE_SALARY + total;
}

// --- INITIALISATION ---
async function init() {
  loadLocal();
  applyPrefs();
  if (!state.selected) state.selected = keyFor(new Date());
  
  await checkAuth();
  renderGrid();
  updateUI();
  setupEvents();
}

function loadLocal() {
  const p = localStorage.getItem('ms_prefs');
  if (p) prefs = { ...prefs, ...JSON.parse(p) };
  const s = localStorage.getItem('ms_state');
  if (s) state = { ...state, ...JSON.parse(s) };
}

function applyPrefs() {
  document.documentElement.setAttribute('data-theme', prefs.theme);
  if ($('rateDay')) $('rateDay').value = prefs.rateDay;
  if ($('rateNightFull')) $('rateNightFull').value = prefs.rateNightFull;
  if ($('themeLight')) $('themeLight').classList.toggle('active', prefs.theme === 'light');
  if ($('themeDark')) $('themeDark').classList.toggle('active', prefs.theme === 'dark');
}

// --- AUTHENTIFICATION ---
async function checkAuth() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data?.session) {
    user = null;
    if ($('topSub')) $('topSub').textContent = "Invité";
    if ($('gate')) $('gate').classList.add('show');
    return;
  }
  user = data.session.user;
  if ($('topSub')) $('topSub').textContent = user.email.split('@')[0];
  if ($('gate')) $('gate').classList.remove('show');
  await loadEntries();
  renderGrid();
  updateUI();
}

async function loadEntries() {
  if (!user) return;
  const start = keyFor(new Date(state.year, state.month - 1, 1));
  const end = keyFor(new Date(state.year, state.month + 2, 0));
  
  const { data, error } = await supabase
    .from("work_calendar_entries")
    .select("*")
    .gte("work_date", start)
    .lte("work_date", end);

  if (error) { console.error("Erreur chargement:", error); return; }
  
  entries.clear();
  if (data) {
    data.forEach(r => entries.set(r.work_date, { 
      status: r.status, 
      note: r.note, 
      custom_label: r.custom_label, 
      imported: r.imported 
    }));
  }
}

// --- RENDU GRILLE ---
function renderGrid() {
  const grid = $('grid');
  if (!grid) return;
  grid.innerHTML = '';
  cellCache.clear();

  let dy = state.year;
  let dm = state.month;

  if ($('navMonth')) $('navMonth').textContent = MONTHS[dm];
  if ($('navYear')) $('navYear').textContent = dy;

  const first = new Date(dy, dm, 1);
  let startDay = first.getDay();
  const startDate = new Date(first);
  startDate.setDate(first.getDate() - startDay);

  for (let i = 0; i < 42; i++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    const k = keyFor(d);

    if (i % 7 === 0) {
      const wn = document.createElement('div');
      wn.className = 'weeknum';
      wn.textContent = Math.ceil(d.getDate() / 7);
      grid.appendChild(wn);
    }

    const cell = document.createElement('div');
    cell.className = 'day';
    if (d.getMonth() !== dm) cell.classList.add('out');
    cell.textContent = d.getDate();
    cell.dataset.key = k;

    const entry = entries.get(k);
    if (entry?.status) {
      cell.classList.add(entry.status);
      if (entry.imported) {
        cell.style.border = '2px dashed var(--accent)';
        cell.style.boxSizing = 'border-box';
      }
      if (entry.note) {
        const dot = document.createElement('div');
        dot.className = 'dot';
        cell.appendChild(dot);
      }
    }

    if (k === state.selected) cell.classList.add('selected');

    // CORRECTION : Clic simple sélectionne juste la case, n'ouvre rien
    cell.onclick = () => {
      state.selected = k;
      localStorage.setItem('ms_state', JSON.stringify(state));
      renderGrid();
      updateUI();
    };

    grid.appendChild(cell);
    cellCache.set(k, cell);
  }
}

function updateUI() {
  if (!state.selected) return;
  const d = parseKey(state.selected);
  if ($('selDate')) $('selDate').textContent = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  
  const entry = entries.get(state.selected);
  if ($('selState')) $('selState').textContent = entry?.status ? LABELS[entry.status] : "Libre";
  
  // Stats
  let count = 0;
  entries.forEach(e => { if (['jour', 'nuit', 'autre'].includes(e.status)) count++; });
  if ($('statCount')) $('statCount').textContent = count;
  
  if ($('salaryValue')) {
    const sal = calculateSalary();
    $('salaryValue').textContent = sal.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  }
}

// --- SAUVEGARDE ---
async function saveEntry(k, patch) {
  if (!user) {
    $('gate').classList.add('show');
    return;
  }

  const cur = entries.get(k) || { status: '', note: '', custom_label: '', imported: false };
  const next = { ...cur, ...patch };
  entries.set(k, next);

  const cell = cellCache.get(k);
  if (cell) {
    cell.className = `day ${cell.classList.contains('out') ? 'out' : ''} ${next.status || ''}`;
    if (next.imported) {
      cell.style.border = '2px dashed var(--accent)';
      cell.style.boxSizing = 'border-box';
    }
    // Gestion point note
    const oldDot = cell.querySelector('.dot');
    if (oldDot) oldDot.remove();
    if (next.note) {
      const dot = document.createElement('div');
      dot.className = 'dot';
      cell.appendChild(dot);
    }
  }

  updateUI();

  // Envoi Supabase
  try {
    const { error } = await supabase.from("work_calendar_entries").upsert({
      user_id: user.id,
      work_date: k,
      status: next.status,
      note: next.note,
      custom_label: next.custom_label,
      imported: next.imported
    }, { onConflict: "user_id,work_date" });

    if (error) throw error;
  } catch (e) {
    console.error("Erreur sauvegarde:", e);
    alert("Erreur de synchronisation: " + e.message);
    await loadEntries();
    renderGrid();
  }
}

// --- CERVEAU "IA" D'IMPORT (AVEC LECTURE LÉGENDE) ---

function triggerImport() {
  if (!user) {
    alert("Veuillez vous connecter d'abord.");
    $('gate').classList.add('show');
    return;
  }
  $('fileInput').click();
}

function handleFile(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const data = new Uint8Array(evt.target.result);
      const workbook = XLSX.read(data, { type: 'array', cellText: true, raw: false });
      
      if (!workbook.SheetNames.length) throw new Error("Fichier vide");
      
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
      
      analyzeData(rows);
    } catch (err) {
      console.error(err);
      alert("❌ Erreur lors de la lecture du fichier Excel.");
    }
    $('fileInput').value = '';
  };
  reader.readAsArrayBuffer(file);
}

function analyzeData(rows) {
  console.log(`🔍 Analyse de ${rows.length} lignes...`);
  
  // 1. LIRE LA LÉGENDE EN BAS DU FICHIER (MEMO / N° /)
  codeLegend = {};
  let legendFound = false;
  // On scanne de la fin vers le début pour trouver la section légende
  for (let r = rows.length - 1; r >= 0; r--) {
    const rowText = rows[r].join(" ").toUpperCase();
    if (rowText.includes("MEMO") || rowText.includes("N° /") || rowText.includes("LÉGENDE") || rowText.includes("CODE")) {
      // On lit les lignes suivantes (qui sont techniquement après dans le fichier, donc index > r)
      // Mais comme on boucle à l'envers, on regarde les lignes r+1 à la fin
      for (let k = r + 1; k < Math.min(rows.length, r + 50); k++) {
        let currentCode = "";
        rows[k].forEach(cell => {
          const val = clean(cell);
          // Si c'est un code (ex: N28)
          if (/^[A-Z]{1,2}[0-9]{1,3}$/.test(val)) {
            currentCode = val;
          } 
          // Si c'est une description et qu'on a un code en attente
          else if (currentCode && val.length > 3) {
            if (val.includes("NUIT")) codeLegend[currentCode] = "nuit";
            else if (val.includes("JOUR")) codeLegend[currentCode] = "jour";
            else if (val.includes("REPOS") || val.includes("OFF")) codeLegend[currentCode] = "repos";
            else if (val.includes("CONG") || val.includes("CP")) codeLegend[currentCode] = "conges";
            else if (val.includes("IND")) codeLegend[currentCode] = "nuit"; // Exemple spécifique
          }
        });
      }
      legendFound = true;
      console.log("✅ Légende détectée :", codeLegend);
      break;
    }
  }

  // 2. TROUVER LA LIGNE DE PLANNING (CELLE AVEC LE PLUS DE CODES)
  let bestScore = -1;
  let bestRowIdx = -1;
  let bestRowData = [];

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    let score = 0;
    
    row.forEach(cell => {
      const val = clean(cell);
      const hasLetter = /[A-Z]/.test(val);
      const hasNumber = /[0-9]/.test(val);
      const isShort = val.length >= 2 && val.length <= 6;
      
      if (hasLetter && hasNumber && isShort) score++;
    });

    if (score > bestScore && score >= 3) {
      bestScore = score;
      bestRowIdx = r;
      bestRowData = row;
    }
  }

  if (bestScore === -1) {
    return alert("❌ Aucun code de chantier (type N28, J12, 36IND...) détecté dans le fichier.");
  }

  console.log(`✅ Ligne idéale trouvée : Index ${bestRowIdx} avec ${bestScore} codes.`);
  extractSchedule(rows, bestRowIdx, bestRowData);
}

function extractSchedule(rows, rowIdx, rowData) {
  // 3. TROUVER L'EN-TÊTE DE DATES
  let headerIdx = -1;
  for (let r = rowIdx - 1; r >= 0; r--) {
    const rowText = rows[r].join(" ").toUpperCase();
    let dayCount = 0;
    DAYS_FR.forEach(d => { if (rowText.includes(d)) dayCount++; });
    if (dayCount >= 3) {
      headerIdx = r;
      break;
    }
  }

  if (headerIdx === -1) {
    return alert("❌ Impossible de trouver les jours de la semaine au-dessus de votre ligne.");
  }

  // 4. MAPPER LES DATES
  const monthsFr = ["JANVIER","FÉVRIER","MARS","AVRIL","MAI","JUIN","JUILLET","AOÛT","SEPTEMBRE","OCTOBRE","NOVEMBRE","DÉCEMBRE"];
  const currentYear = new Date().getFullYear();
  let detectedMonth = state.month;
  
  const headerText = rows[headerIdx].join(" ").toUpperCase();
  monthsFr.forEach((m, i) => { if (headerText.includes(m)) detectedMonth = i; });

  const dateMap = {};
  const headRow = rows[headerIdx];
  const subRow = rows[headerIdx + 1] || [];

  for (let c = 0; c < Math.max(headRow.length, subRow.length); c++) {
    const c1 = String(headRow[c] || "");
    const c2 = String(subRow[c] || "");
    let dateObj = null;

    const m1 = c1.match(/(\d{1,2})[/\-\.](\d{1,2})/);
    if (m1) dateObj = new Date(currentYear, parseInt(m1[2]) - 1, parseInt(m1[1]));

    if (!dateObj && /^\d{1,2}$/.test(c1.trim()) && c1.trim().length > 0) {
      dateObj = new Date(currentYear, detectedMonth, parseInt(c1.trim()));
    }

    if (!dateObj) {
      const m2 = c2.match(/(\d{1,2})[/\-\.](\d{1,2})/);
      if (m2) dateObj = new Date(currentYear, parseInt(m2[2]) - 1, parseInt(m2[1]));
      if (!dateObj && /^\d{1,2}$/.test(c2.trim()) && c2.trim().length > 0) {
        dateObj = new Date(currentYear, detectedMonth, parseInt(c2.trim()));
      }
    }

    if (dateObj && !isNaN(dateObj.getTime())) {
      dateMap[c] = dateObj;
    }
  }

  // 5. EXTRAIRE LES CODES ET DÉTERMINER LE STATUT
  const services = [];
  
  rowData.forEach((cell, colIndex) => {
    const rawVal = cell;
    const val = clean(cell);
    const hasLetter = /[A-Z]/.test(val);
    const hasNumber = /[0-9]/.test(val);
    const isShort = val.length >= 2 && val.length <= 6;

    if (hasLetter && hasNumber && isShort) {
      // Chercher la date associée
      let associatedDate = null;
      for (let back = colIndex; back >= 0; back--) {
        if (dateMap[back]) {
          associatedDate = dateMap[back];
          break;
        }
      }

      if (associatedDate) {
        // LOGIQUE DE DÉTERMINATION DU STATUT
        let status = "autre";
        
        // 1. Vérifier dans la légende lue (Priorité 1)
        if (codeLegend[val]) {
          status = codeLegend[val];
        } 
        // 2. Vérifier dans le texte brut de la cellule (Priorité 2)
        else if (rawVal && String(rawVal).toUpperCase().includes("NUIT")) status = "nuit";
        else if (rawVal && String(rawVal).toUpperCase().includes("JOUR")) status = "jour";
        else if (rawVal && String(rawVal).toUpperCase().includes("REPOS")) status = "repos";
        else if (rawVal && String(rawVal).toUpperCase().includes("CONG")) status = "conges";
        // 3. Déduction par la première lettre (Priorité 3)
        else {
          if (val.startsWith('N')) status = "nuit";
          else if (val.startsWith('J')) status = "jour";
          else if (val.startsWith('R')) status = "repos";
          else if (val.startsWith('C') || val.startsWith('CP')) status = "conges";
          else if (val.startsWith('IND')) status = "nuit"; // Cas spécifique IND
        }

        const k = keyFor(associatedDate);
        
        if (!services.find(s => s.dateKey === k)) {
          services.push({
            dateKey: k,
            dateObj: associatedDate,
            dayName: associatedDate.toLocaleDateString('fr-FR', { weekday: 'long' }),
            code: val,
            status: status,
            note: `Auto: ${val}`
          });
        }
      }
    }
  });

  if (services.length === 0) {
    return alert("⚠️ Codes détectés, mais aucune date correspondante trouvée.");
  }

  showPreview(services);
}

function showPreview(services) {
  pendingImport = services;
  const list = $('importPreviewList');
  const summary = $('importSummary');
  
  if (!list || !summary) return;
  
  list.innerHTML = '';
  summary.textContent = `🤖 Analyse terminée : ${services.length} services trouvés.`;
  
  services.forEach(s => {
    const div = document.createElement('div');
    div.style.cssText = "padding:8px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center; font-size:13px;";
    div.innerHTML = `
      <span><b>${s.dayName}</b> ${s.dateObj.getDate()}/${s.dateObj.getMonth()+1}</span>
      <span style="background:var(--surface); padding:4px 8px; border-radius:6px; font-weight:700; color:var(--accent); border:1px solid var(--border);">
        ${s.code} (${s.status})
      </span>
    `;
    list.appendChild(div);
  });

  $('backdropImport').classList.add('show');
  $('sheetImport').classList.add('show');
  
  const btnConfirm = $('btnConfirmImport');
  const btnCancel = $('btnCancelImport');
  
  if (btnConfirm) btnConfirm.onclick = confirmImport;
  if (btnCancel) btnCancel.onclick = () => {
    $('sheetImport').classList.remove('show');
    $('backdropImport').classList.remove('show');
  };
}

function confirmImport() {
  if (!user) return;
  
  let count = 0;
  pendingImport.forEach(item => {
    entries.set(item.dateKey, { 
      status: item.status, 
      note: item.note, 
      custom_label: item.code, 
      imported: true 
    });
    
    const cell = cellCache.get(item.dateKey);
    if (cell) {
      cell.className = `day ${cell.classList.contains('out') ? 'out' : ''} ${item.status}`;
      cell.style.border = '2px dashed var(--accent)';
      cell.style.boxSizing = 'border-box';
    }
    count++;
  });
  
  renderGrid();
  updateUI();
  
  $('sheetImport').classList.remove('show');
  $('backdropImport').classList.remove('show');

  (async () => {
    let successCount = 0;
    for (const item of pendingImport) {
      const { error } = await supabase.from("work_calendar_entries").upsert({
        user_id: user.id,
        work_date: item.dateKey,
        status: item.status,
        note: item.note,
        custom_label: item.code,
        imported: true
      }, { onConflict: "user_id,work_date" });
      
      if (!error) successCount++;
    }
    alert(`✅ ${successCount} services importés !`);
  })();
}

// --- GESTION MODALES & EVENTS ---

// Ouverture modale NOTE uniquement
function openNoteModal() {
  const entry = entries.get(state.selected);
  const d = parseKey(state.selected);
  
  if ($('sheetTitle')) $('sheetTitle').textContent = `Note du ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  if ($('noteText')) $('noteText').value = entry?.note || '';
  
  $('backdrop').classList.add('show');
  $('sheet').classList.add('show');
}

// Ouverture modale AUTRE uniquement
function openOtherModal() {
  const entry = entries.get(state.selected);
  const d = parseKey(state.selected);
  
  if ($('sheetTitle')) $('sheetTitle').textContent = `Type de service : ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  
  // Reset select
  if ($('otherSelect')) $('otherSelect').value = "OCP";
  if ($('otherCustom')) {
    $('otherCustom').value = "";
    $('otherCustom').style.display = "none";
  }
  
  $('backdrop').classList.add('show');
  $('sheet').classList.add('show');
  // On affiche la section "Autre" et on cache la section "Note"
  // Note: Dans le HTML fourni précédemment, il faut s'assurer que la structure permet cela.
  // Ici on suppose que le JS gère l'affichage via les IDs sheetNote et sheetOther
  if ($('sheetNote')) $('sheetNote').style.display = 'none';
  if ($('sheetOther')) $('sheetOther').style.display = 'block';
}

function closeModals() {
  $('sheet').classList.remove('show');
  $('backdrop').classList.remove('show');
}

function setupEvents() {
  // Navigation
  if ($('btnPrevMonth')) $('btnPrevMonth').onclick = () => {
    state.month--;
    if (state.month < 0) { state.month = 11; state.year--; }
    localStorage.setItem('ms_state', JSON.stringify(state));
    loadEntries().then(() => { renderGrid(); updateUI(); });
  };
  
  if ($('btnNextMonth')) $('btnNextMonth').onclick = () => {
    state.month++;
    if (state.month > 11) { state.month = 0; state.year++; }
    localStorage.setItem('ms_state', JSON.stringify(state));
    loadEntries().then(() => { renderGrid(); updateUI(); });
  };
  
  if ($('btnToday')) $('btnToday').onclick = () => {
    const n = new Date();
    state.year = n.getFullYear();
    state.month = n.getMonth();
    state.selected = keyFor(n);
    localStorage.setItem('ms_state', JSON.stringify(state));
    loadEntries().then(() => { renderGrid(); updateUI(); });
  };

  // Actions Dock (CORRIGÉ : Pas d'ouverture automatique)
  document.querySelectorAll('[data-set]').forEach(btn => {
    btn.onclick = () => {
      if (!state.selected) return;
      
      const action = btn.dataset.set;
      
      if (action === 'note') {
        openNoteModal();
      } else if (action === 'autre') {
        openOtherModal();
      } else {
        // Action directe (Jour, Nuit, Repos, Congés)
        const currentNote = entries.get(state.selected)?.note || '';
        saveEntry(state.selected, { status: action, note: currentNote });
      }
    };
  });

  // Gestion Modale Note
  if ($('btnSaveNote')) $('btnSaveNote').onclick = () => {
    const currentStatus = entries.get(state.selected)?.status || 'autre';
    saveEntry(state.selected, { status: currentStatus, note: $('noteText').value });
    closeModals();
  };
  if ($('btnClearNote')) $('btnClearNote').onclick = () => {
    const currentStatus = entries.get(state.selected)?.status || 'autre';
    saveEntry(state.selected, { status: currentStatus, note: '' });
    closeModals();
  };

  // Gestion Modale Autre
  if ($('btnApplyOther')) $('btnApplyOther').onclick = () => {
    const val = $('otherSelect').value;
    const custom = $('otherCustom').value;
    const finalLabel = (val === 'custom') ? custom : val;
    const currentNote = entries.get(state.selected)?.note || '';
    
    saveEntry(state.selected, { status: 'autre', note: currentNote, custom_label: finalLabel });
    closeModals();
  };
  
  if ($('otherSelect')) {
    $('otherSelect').onchange = (e) => {
      if ($('otherCustom')) {
        $('otherCustom').style.display = (e.target.value === 'custom') ? 'block' : 'none';
      }
    };
  }

  // Fermeture backdrop
  if ($('backdrop')) $('backdrop').onclick = closeModals;

  // Import
  if ($('btnImport')) $('btnImport').onclick = triggerImport;
  if ($('fileInput')) $('fileInput').onchange = handleFile;
  
  // Paramètres
  if ($('btnSettings')) $('btnSettings').onclick = (e) => {
    e.stopPropagation();
    $('settingsPop').classList.toggle('show');
  };
  document.onclick = () => $('settingsPop').classList.remove('show');
  if ($('settingsPop')) $('settingsPop').onclick = (e) => e.stopPropagation();

  if ($('themeLight')) $('themeLight').onclick = () => {
    prefs.theme = 'light';
    localStorage.setItem('ms_prefs', JSON.stringify(prefs));
    applyPrefs();
  };
  if ($('themeDark')) $('themeDark').onclick = () => {
    prefs.theme = 'dark';
    localStorage.setItem('ms_prefs', JSON.stringify(prefs));
    applyPrefs();
  };
  if ($('rateDay')) $('rateDay').onchange = (e) => {
    prefs.rateDay = parseFloat(e.target.value) || 0;
    localStorage.setItem('ms_prefs', JSON.stringify(prefs));
    updateUI();
  };
  if ($('rateNightFull')) $('rateNightFull').onchange = (e) => {
    prefs.rateNightFull = parseFloat(e.target.value) || 0;
    localStorage.setItem('ms_prefs', JSON.stringify(prefs));
    updateUI();
  };

  // Logout
  if ($('btnLogout')) $('btnLogout').onclick = async () => {
    await supabase.auth.signOut();
    checkAuth();
  };

  // Login
  if ($('btnLogin')) $('btnLogin').onclick = async () => {
    const email = $('loginEmail').value;
    const pass = $('loginPass').value;
    if (!email || !pass) {
      $('loginHint').textContent = "Email et mot de passe requis.";
      return;
    }
    $('loginHint').textContent = "Connexion...";
    const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
    if (error) {
      $('loginHint').textContent = "Erreur: " + error.message;
    } else {
      checkAuth();
    }
  };

  // Export
  if ($('btnExportXLSX')) $('btnExportXLSX').onclick = () => {
    const start = new Date(state.year, state.month, 1);
    const end = new Date(state.year, state.month + 1, 0);
    if ($('exportStart')) $('exportStart').value = keyFor(start);
    if ($('exportEnd')) $('exportEnd').value = keyFor(end);
    $('backdropExport').classList.add('show');
    $('sheetExport').classList.add('show');
  };
  if ($('btnCloseExport')) $('btnCloseExport').onclick = () => {
    $('sheetExport').classList.remove('show');
    $('backdropExport').classList.remove('show');
  };
  if ($('btnGenerateXLSX')) $('btnGenerateXLSX').onclick = () => {
    alert("Export Excel généré (Fonctionnalité complète à intégrer)");
    $('sheetExport').classList.remove('show');
    $('backdropExport').classList.remove('show');
  };
}

// Lancement
init();
