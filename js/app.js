import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// ═══════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════
const SUPABASE_URL  = "https://dstmyvzjirgyuwuojwnk.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRzdG15dnpqaXJneXV3dW9qd25rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk3NzY4NTUsImV4cCI6MjA4NTM1Mjg1NX0.Cl6WAvK0elHkKXnXRtrFFiBlGABnK5RTFdawq3NGDJk";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// ═══════════════════════════════════════════════════════
// ÉTAT GLOBAL
// ═══════════════════════════════════════════════════════
let user = null;
let entries  = new Map();
let cellCache = new Map();
let pendingImport = [];
let pwaInstallPrompt = null;

let state = {
  year:     new Date().getFullYear(),
  month:    new Date().getMonth(),
  selected: null
};

let prefs = {
  theme:         'dark',
  agentName:     '',
  agentMatricule:'',
  rateDay:        35.0,
  rateNightFull:  82.0,
  rateNightSolo:  41.0,
  rateMN:         15.0
};

// ═══════════════════════════════════════════════════════
// CONSTANTES
// ═══════════════════════════════════════════════════════
const MONTHS   = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const BASE_SALARY = 2093.06;

// NOUVEAUX EN-TÊTES : Intervalles de jours
const DAY_HEADERS = ["Di/Lu", "Lu/Ma", "Ma/Me", "Me/Je", "Je/Ve", "Ve/Sa", "Sa/Di"];

const STATUS_LABELS = {
  jour:   "Jour",
  nuit:   "Nuit",
  mn:     "MN",
  repos:  "Repos",
  conges: "Congés",
  autre:  "Autre"
};

const STATUS_EMOJI = {
  jour:   "☀️",
  nuit:   "🌙",
  mn:     "🌅",
  repos:  "🏠",
  conges: "🏖️",
  autre:  "⚙️"
};

// ═══════════════════════════════════════════════════════
// UTILITAIRES
// ═══════════════════════════════════════════════════════
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');
const keyFor = d => `$${d.getFullYear()}-$${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parseKey = k => { const [y,m,d] = k.split('-').map(Number); return new Date(y, m-1, d); };

const normalize = txt => {
  if (!txt && txt !== 0) return "";
  return String(txt)
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
};

const clean = txt => normalize(txt).replace(/[^A-Z0-9]/g, "");

function showToast(msg, duration = 2500) {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}

// ═══════════════════════════════════════════════════════
// CALCUL SALAIRE
// ═══════════════════════════════════════════════════════
function calculateSalary() {
  let bonus = 0;
  const end = new Date(state.year, state.month + 1, 0);
  for (let d = 1; d <= end.getDate(); d++) {
    const k = keyFor(new Date(state.year, state.month, d));
    const e = entries.get(k);
    if (!e) continue;
    if (e.status === 'jour')  bonus += parseFloat(prefs.rateDay)       || 0;
    if (e.status === 'nuit')  bonus += parseFloat(prefs.rateNightFull) || 0;
    if (e.status === 'mn')    bonus += parseFloat(prefs.rateMN)        || 0;
  }
  return BASE_SALARY + bonus;
}

// ═══════════════════════════════════════════════════════
// INITIALISATION
// ═══════════════════════════════════════════════════════
async function init() {
  console.log("🚀 Initialisation...");
  loadLocal();
  applyPrefs();
  if (!state.selected) state.selected = keyFor(new Date());
  setupPWA();
  await checkAuth();
  renderGrid();
  updateUI();
  setupEvents();
  console.log("✅ Prêt.");
}

function loadLocal() {
  try {
    const p = localStorage.getItem('ms_prefs');
    if (p) prefs = { ...prefs, ...JSON.parse(p) };
    const s = localStorage.getItem('ms_state');
    if (s) state = { ...state, ...JSON.parse(s) };
  } catch(e) { console.warn("Erreur localStorage:", e); }
}

function savePrefs() {
  localStorage.setItem('ms_prefs', JSON.stringify(prefs));
}

function applyPrefs() {
  document.documentElement.setAttribute('data-theme', prefs.theme);
  $('themeLight')?.classList.toggle('active', prefs.theme === 'light');
  $('themeDark')?.classList.toggle('active',  prefs.theme === 'dark');
  if ($$('agentName'))       $$('agentName').value       = prefs.agentName || '';
  if ($$('agentMatricule'))  $$('agentMatricule').value  = prefs.agentMatricule || '';
  if ($$('rateDay'))       $$('rateDay').value       = prefs.rateDay;
  if ($$('rateNightFull')) $$('rateNightFull').value  = prefs.rateNightFull;
  if ($$('rateNightSolo')) $$('rateNightSolo').value  = prefs.rateNightSolo;
  if ($$('rateMN'))        $$('rateMN').value         = prefs.rateMN;
}

// ═══════════════════════════════════════════════════════
// PWA
// ═══════════════════════════════════════════════════════
function setupPWA() {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    pwaInstallPrompt = e;
    const row = $('pwaInstallRow');
    if (row) row.style.display = 'block';
  });
  $('btnInstallPWA')?.addEventListener('click', async () => {
    if (!pwaInstallPrompt) return;
    pwaInstallPrompt.prompt();
    const { outcome } = await pwaInstallPrompt.userChoice;
    if (outcome === 'accepted') {
      const row = $('pwaInstallRow');
      if (row) row.style.display = 'none';
      showToast("✅ App installée !");
    }
    pwaInstallPrompt = null;
  });
}

// ═══════════════════════════════════════════════════════
// AUTHENTIFICATION
// ═══════════════════════════════════════════════════════
async function checkAuth() {
  console.log("🔐 Vérification auth...");
  const gate = $('gate');
  if (!gate) { console.error("Gate introuvable"); return; }

  try {
    const { data, error } = await supabase.auth.getSession();
    
    if (error || !data?.session) {
      console.log("🔒 Non connecté. Affichage login.");
      user = null;
      const topSub = $('topSub');
      if (topSub) topSub.textContent = "Invité";
      gate.style.display = 'grid';
      setTimeout(() => gate.classList.add('show'), 10);
      return;
    }

    console.log("✅ Connecté:", data.session.user.email);
    user = data.session.user;
    const topSub = $('topSub');
    if (topSub) topSub.textContent = prefs.agentName || user.email.split('@')[0];
    
    gate.classList.remove('show');
    setTimeout(() => {
        if (!gate.classList.contains('show')) gate.style.display = 'none';
    }, 300);

    await loadEntries();
  } catch (err) {
    console.error("⚠️ Erreur auth:", err);
    user = null;
    gate.style.display = 'grid';
    setTimeout(() => gate.classList.add('show'), 10);
  }
}

async function loadEntries() {
  if (!user) return;
  const start = keyFor(new Date(state.year, state.month - 1, 1));
  const end   = keyFor(new Date(state.year, state.month + 2, 0));

  const { data, error } = await supabase
    .from("work_calendar_entries")
    .select("*")
    .gte("work_date", start)
    .lte("work_date", end);

  if (error) { console.error("Erreur chargement:", error); return; }
  entries.clear();
  data?.forEach(r => entries.set(r.work_date, {
    status:       r.status,
    note:         r.note,
    custom_label: r.custom_label,
    imported:     r.imported
  }));
}

// ═══════════════════════════════════════════════════════
// RENDU GRILLE (MODIFIÉ POUR LES EN-TÊTES PAIRES)
// ═══════════════════════════════════════════════════════
function renderGrid() {
  const grid = $('grid');
  const header = $('.calendar-head');
  if (!grid || !header) return;
  
  grid.innerHTML = '';
  cellCache.clear();

  // Mise à jour du titre du mois
  $$('navMonth') && ($$('navMonth').textContent = MONTHS[state.month]);
  $$('navYear')  && ($$('navYear').textContent  = state.year);

  // Mise à jour des en-têtes (Di/Lu, Lu/Ma, etc.)
  // On garde la première cellule pour "Sem", puis les 7 jours
  const headerChildren = header.children;
  for (let i = 1; i < headerChildren.length; i++) {
    headerChildren[i].textContent = DAY_HEADERS[i-1];
  }

  const first    = new Date(state.year, state.month, 1);
  // Décalage pour commencer Lundi (0=Dim -> 6, 1=Lun -> 0)
  let startOffset = (first.getDay() + 6) % 7;
  const startDate = new Date(first);
  startDate.setDate(1 - startOffset);

  for (let i = 0; i < 42; i++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    const k = keyFor(d);

    // Numéro de semaine
    if (i % 7 === 0) {
      const wn = getISOWeek(d);
      const wnEl = document.createElement('div');
      wnEl.className = 'weeknum';
      wnEl.textContent = wn;
      grid.appendChild(wnEl);
    }

    const cell = document.createElement('div');
    cell.className = 'day';
    if (d.getMonth() !== state.month) cell.classList.add('out');

    const today = keyFor(new Date());
    if (k === today) cell.classList.add('today');

    cell.dataset.key = k;

    const entry = entries.get(k);
    if (entry?.status) {
      cell.classList.add(entry.status);
      if (entry.imported) cell.classList.add('imported');
    }

    const numEl = document.createElement('span');
    numEl.className = 'day-num';
    numEl.textContent = d.getDate();
    cell.appendChild(numEl);

    if (entry?.status && entry.status !== 'repos') {
      const labelEl = document.createElement('span');
      labelEl.className = 'day-label';
      labelEl.textContent = entry.custom_label || STATUS_LABELS[entry.status] || entry.status;
      cell.appendChild(labelEl);
    }

    if (entry?.note) {
      const dot = document.createElement('div');
      dot.className = 'dot';
      cell.appendChild(dot);
    }

    if (k === state.selected) cell.classList.add('selected');

    cell.onclick = () => {
      state.selected = k;
      localStorage.setItem('ms_state', JSON.stringify(state));
      cellCache.forEach((c, ck) => c.classList.toggle('selected', ck === k));
      updateDockInfo();
    };

    grid.appendChild(cell);
    cellCache.set(k, cell);
  }
  updateUI();
}

function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

// ═══════════════════════════════════════════════════════
// UI UPDATES
// ═══════════════════════════════════════════════════════
function updateUI() {
  updateDockInfo();
  updateStats();
}

function updateDockInfo() {
  if (!state.selected) return;
  const d = parseKey(state.selected);
  const entry = entries.get(state.selected);

  $$('selDate') && ($$('selDate').textContent =
    `$${['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'][(d.getDay()+6)%7]} $${d.getDate()} ${MONTHS[d.getMonth()]}`);

  const badge = $('selState');
  if (badge) {
    const s = entry?.status;
    badge.textContent = s ? `$${STATUS_EMOJI[s] || ''} $${STATUS_LABELS[s] || s}` : "Libre";
    badge.className = `sel-badge ${s || ''}`;
  }
}

function updateStats() {
  let jour = 0, nuit = 0, repos = 0, mn = 0, conges = 0;
  const end = new Date(state.year, state.month + 1, 0);
  for (let d = 1; d <= end.getDate(); d++) {
    const e = entries.get(keyFor(new Date(state.year, state.month, d)));
    if (!e) continue;
    if (e.status === 'jour')   jour++;
    if (e.status === 'nuit')   nuit++;
    if (e.status === 'repos')  repos++;
    if (e.status === 'mn')     mn++;
    if (e.status === 'conges') conges++;
  }

  $$('statJour')  && ($$('statJour').textContent  = jour);
  $$('statNuit')  && ($$('statNuit').textContent  = nuit);
  $$('statRepos') && ($$('statRepos').textContent = repos);

  const sal = calculateSalary();
  $$('salaryValue') && ($$('salaryValue').textContent =
    sal.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €');
}

// ═══════════════════════════════════════════════════════
// STATS MODAL
// ═══════════════════════════════════════════════════════
function openStats() {
  const end = new Date(state.year, state.month + 1, 0);
  const counts = { jour:0, nuit:0, mn:0, repos:0, conges:0, autre:0 };

  for (let d = 1; d <= end.getDate(); d++) {
    const e = entries.get(keyFor(new Date(state.year, state.month, d)));
    if (e?.status && counts[e.status] !== undefined) counts[e.status]++;
  }

  $$('statsMonthLabel') && ($$('statsMonthLabel').textContent = `$${MONTHS[state.month]} $${state.year}`);

  const content = $('statsContent');
  if (!content) return;

  const total = counts.jour + counts.nuit + counts.mn;
  const sal   = calculateSalary();

  content.innerHTML = `
    <div class="stats-grid">
      ${Object.entries(counts).map(([k, v]) => `
        <div class="stats-row ${k}">
          <span class="stats-emoji">${STATUS_EMOJI[k] || '📌'}</span>
          <span class="stats-name">${STATUS_LABELS[k] || k}</span>
          <span class="stats-count">${v}</span>
          <div class="stats-bar-mini"><div class="stats-bar-fill $${k}" style="width:$${end.getDate() ? (v/end.getDate()*100).toFixed(0) : 0}%"></div></div>
        </div>
      `).join('')}
    </div>
    <div class="stats-summary">
      <div class="summary-row">
        <span>Total services travaillés</span>
        <strong>${total}</strong>
      </div>
      <div class="summary-row highlight">
        <span>Estimation brute mensuelle</span>
        <strong>${sal.toLocaleString('fr-FR', {minimumFractionDigits:2})} €</strong>
      </div>
      <div class="summary-row muted">
        <span>Base fixe incluse</span>
        <span>${BASE_SALARY.toLocaleString('fr-FR', {minimumFractionDigits:2})} €</span>
      </div>
    </div>
  `;

  $('backdropStats').classList.add('show');
  $('sheetStats').classList.add('show');
}

// ═══════════════════════════════════════════════════════
// EXPORT EXCEL (NOUVEAU)
// ═══════════════════════════════════════════════════════
async function exportCalendar() {
  if (!user) { showToast("Connectez-vous pour exporter"); return; }
  
  showToast("🔄 Génération du fichier...");
  
  const end = new Date(state.year, state.month + 1, 0);
  const data = [];
  
  // En-têtes du fichier Excel
  data.push(["MyShift AI - Export", "", "", "", ""]);
  data.push(["Agent", prefs.agentName || user.email, "", "Mois", `$${MONTHS[state.month]} $${state.year}`]);
  data.push(["", "", "", "", ""]);
  data.push(["Date", "Jour", "Statut", "Code", "Note", "Salaire Estimé"]);
  
  let totalBonus = 0;
  
  for (let d = 1; d <= end.getDate(); d++) {
    const dateObj = new Date(state.year, state.month, d);
    const k = keyFor(dateObj);
    const e = entries.get(k);
    
    if (e && e.status && e.status !== 'repos') {
      let dailyRate = 0;
      if (e.status === 'jour') dailyRate = prefs.rateDay;
      if (e.status === 'nuit') dailyRate = prefs.rateNightFull;
      if (e.status === 'mn') dailyRate = prefs.rateMN;
      
      totalBonus += dailyRate;
      
      data.push([
        `$${pad(d)}/$${pad(state.month+1)}/${state.year}`,
        dateObj.toLocaleDateString('fr-FR', { weekday: 'long' }),
        STATUS_LABELS[e.status] || e.status,
        e.custom_label || '',
        e.note || '',
        dailyRate > 0 ? dailyRate + ' €' : '-'
      ]);
    }
  }
  
  data.push(["", "", "", "", ""]);
  data.push(["RÉCAPITULATIF", "", "", "", ""]);
  data.push(["Salaire de base", BASE_SALARY + " €", "", "", ""]);
  data.push(["Primes estimées", totalBonus + " €", "", "", ""]);
  data.push(["TOTAL ESTIMÉ", (BASE_SALARY + totalBonus) + " €", "", "", ""]);

  // Création du fichier Excel
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Planning");
  
  // Nom du fichier : MyShift_Export_Janvier_2026.xlsx
  const filename = `MyShift_Export_$${MONTHS[state.month]}_$${state.year}.xlsx`;
  
  XLSX.writeFile(wb, filename);
  showToast("✅ Fichier téléchargé !");
}

// ═══════════════════════════════════════════════════════
// SAUVEGARDE
// ═══════════════════════════════════════════════════════
async function saveEntry(k, patch) {
  if (!user) { 
    const gate = $('gate');
    if(gate) { gate.style.display = 'grid'; setTimeout(() => gate.classList.add('show'), 10); }
    return; 
  }

  const cur  = entries.get(k) || { status:'', note:'', custom_label:'', imported:false };
  const next = { ...cur, ...patch };

  if (patch.status === null) {
    entries.delete(k);
  } else {
    entries.set(k, next);
  }

  const cell = cellCache.get(k);
  if (cell) {
    const isOut = cell.classList.contains('out');
    const isSel = cell.classList.contains('selected');
    const isToday = cell.classList.contains('today');

    cell.className = ['day', isOut?'out':'', isSel?'selected':'', isToday?'today':'',
      next.status || '', next.imported?'imported':''].filter(Boolean).join(' ');

    cell.innerHTML = '';
    const numEl = document.createElement('span');
    numEl.className = 'day-num';
    numEl.textContent = parseKey(k).getDate();
    cell.appendChild(numEl);

    if (next.status && next.status !== 'repos' && patch.status !== null) {
      const labelEl = document.createElement('span');
      labelEl.className = 'day-label';
      labelEl.textContent = next.custom_label || STATUS_LABELS[next.status] || next.status;
      cell.appendChild(labelEl);
    }

    if (next.note && patch.status !== null) {
      const dot = document.createElement('div');
      dot.className = 'dot';
      cell.appendChild(dot);
    }
  }

  updateUI();
  showToast(patch.status === null ? "🗑️ Effacé" : `✅ ${STATUS_LABELS[next.status] || 'OK'}`);

  try {
    if (patch.status === null) {
      await supabase.from("work_calendar_entries").delete().eq('user_id', user.id).eq('work_date', k);
    } else {
      const payload = { user_id:user.id, work_date:k, status:next.status, note:next.note, custom_label:next.custom_label };
      if (next.imported === true) payload.imported = true;

      const { error } = await supabase.from("work_calendar_entries").upsert(payload, { onConflict:"user_id,work_date" });

      if (error) {
        if (error.message.includes('imported')) {
          delete payload.imported;
          await supabase.from("work_calendar_entries").upsert(payload, { onConflict:"user_id,work_date" });
        } else throw error;
      }
    }
  } catch(e) {
    console.error("Erreur sync:", e);
    showToast("⚠️ Erreur sync");
    await loadEntries();
    renderGrid();
  }
}

// ═══════════════════════════════════════════════════════
// IMPORT EXCEL
// ═══════════════════════════════════════════════════════
function triggerImport() {
  if (!user) {
    showToast("Connectez-vous d'abord.");
    const gate = $('gate');
    if(gate) { gate.style.display = 'grid'; setTimeout(() => gate.classList.add('show'), 10); }
    return;
  }
  $('fileInput').click();
}

function handleFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  $('fileInput').value = '';
  const reader = new FileReader();
  reader.onload = evt => {
    try {
      const data = new Uint8Array(evt.target.result);
      const wb   = XLSX.read(data, { type:'array', cellText:true, raw:false });
      if (!wb.SheetNames.length) throw new Error("Fichier vide");
      let bestSheet = null, bestScore = -1;
      wb.SheetNames.forEach(name => {
        const ws = wb.Sheets[name];
        const rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:"" });
        const score = rows.reduce((s, r) => s + r.filter(c => String(c).trim()).length, 0);
        if (score > bestScore) { bestScore = score; bestSheet = rows; }
      });
      importAnalyze(bestSheet);
    } catch(err) {
      console.error(err);
      showToast("❌ Erreur Excel");
    }
  };
  reader.readAsArrayBuffer(file);
}

function importAnalyze(rows) {
  const dateRows = findDateRows(rows);
  if (!dateRows.length) { showToast("❌ Pas de dates"); return; }
  const agents = detectAgents(rows, dateRows);
  if (!agents.length) { showToast("❌ Pas d'agent"); return; }

  let targetAgent = null;
  if (prefs.agentName) {
    const searchName = normalize(prefs.agentName);
    targetAgent = agents.find(a => normalize(a.name).includes(searchName) || similarity(normalize(a.name), searchName) > 0.75);
  }

  if (targetAgent) {
    showImportPreview(buildServicesForAgent(targetAgent, dateRows, rows), agents, targetAgent.name);
  } else {
    showImportPreview([], agents, null);
  }
}

function findDateRows(rows) {
  const dateRows = [];
  rows.forEach((row, rowIdx) => {
    const dateMap = {};
    let count = 0;
    row.forEach((cell, colIdx) => {
      const val = String(cell).trim();
      const m = val.match(/^(\d{1,2})[\/\-\.](\d{1,2})(?:[\/\-\.](\d{2,4}))?$/);
      if (m) {
        const day = parseInt(m[1]), mo = parseInt(m[2]) - 1;
        const yr = m[3] ? (m[3].length===2?2000+parseInt(m[3]):parseInt(m[3])) : state.year;
        if (day>=1 && day<=31 && mo>=0 && mo<=11) { dateMap[colIdx] = new Date(yr, mo, day); count++; }
      } else if (/^\d{1,2}$/.test(val)) {
        const n = parseInt(val);
        if (n>=1 && n<=31) { dateMap[colIdx] = { dayOnly: n }; count++; }
      }
    });
    if (count >= 5) dateRows.push({ rowIdx, dateMap, count });
  });
  return dateRows;
}

function detectAgents(rows, dateRows) {
  const agents = [];
  const dateIdx = new Set(dateRows.map(d => d.rowIdx));
  rows.forEach((row, idx) => {
    if (dateIdx.has(idx)) return;
    row.forEach(cell => {
      const val = String(cell).trim();
      if (val.length < 4) return;
      const words = val.split(/\s+/).filter(w => /^[A-Za-zÀ-ÿ\-]{2,}$/.test(w));
      if (words.length >= 2 && words.length <= 4) {
        if (!agents.find(a => normalize(a.name) === normalize(val))) {
          agents.push({ name: val, rowIdx: idx, isUpperCase: val === val.toUpperCase() });
        }
      }
    });
  });
  return agents.sort((a,b) => (b.isUpperCase?1:0) - (a.isUpperCase?1:0));
}

function buildServicesForAgent(agent, dateRows, rows) {
  const relDate = dateRows.filter(d => d.rowIdx <= agent.rowIdx).sort((a,b)=>b.rowIdx-a.rowIdx)[0];
  if (!relDate) return [];
  const month = resolveMonth(rows, relDate.rowIdx);
  const colMap = {};
  Object.entries(relDate.dateMap).forEach(([c, v]) => {
    const idx = parseInt(c);
    colMap[idx] = (v instanceof Date) ? v : new Date(state.year, month, v.dayOnly);
  });

  const services = [];
  const used = new Set();
  for (let i = 0; i <= 3; i++) {
    const r = rows[agent.rowIdx + i];
    if (!r) continue;
    r.forEach((cell, cIdx) => {
      const raw = String(cell).trim();
      if (!raw) return;
      let d = colMap[cIdx];
      if (!d) { for (let k=cIdx; k>=0; k--) if (colMap[k]) { d=colMap[k]; break; } }
      if (!d) return;
      const k = keyFor(d);
      if (used.has(k)) return;
      const status = interpretCode(raw);
      if (!status) return;
      used.add(k);
      services.push({ dateKey:k, dateObj:d, dayName:d.toLocaleDateString('fr-FR',{weekday:'long'}), code:raw.toUpperCase(), status, note:`Import: ${raw}` });
    });
  }
  applyMNRules(services);
  return services.sort((a,b) => a.dateKey.localeCompare(b.dateKey));
}

function resolveMonth(rows, idx) {
  const months = ["JANVIER","FEVRIER","MARS","AVRIL","MAI","JUIN","JUILLET","AOUT","SEPTEMBRE","OCTOBRE","NOVEMBRE","DECEMBRE"];
  for (let i=Math.max(0,idx-10); i<=Math.min(rows.length-1,idx+5); i++) {
    const t = normalize(rows[i].join(" "));
    for (let j=0; j<12; j++) if (t.includes(months[j])) return j;
  }
  return state.month;
}

function interpretCode(raw) {
  const v = clean(raw), up = normalize(raw);
  if (!v) return null;
  if (up.includes("NUIT")) return "nuit";
  if (up.includes("JOUR")) return "jour";
  if (up.includes("REPOS") || up.includes("OFF")) return "repos";
  if (up.includes("CONG") || up==="CP") return "conges";
  if (up.includes("MN")) return "mn";
  if (v==="N") return "nuit"; if (v==="J") return "jour"; if (v==="R") return "repos";
  if (/^[NJR]\d+$/.test(v)) return v.startsWith('N')?"nuit":v.startsWith('J')?"jour":"repos";
  if (/^[NJR]/.test(v) && v.length<=6) return v.startsWith('N')?"nuit":v.startsWith('J')?"jour":"repos";
  if (/[A-Z]/.test(v) && /[0-9]/.test(v)) return "autre";
  return null;
}

function applyMNRules(svcs) {
  svcs.filter(s=>s.status==="nuit").forEach(s => {
    const d = parseKey(s.dateKey);
    if (d.getDay()===1) return;
    if (!svcs.find(x=>x.dateKey===s.dateKey && x.status==="mn")) {
      svcs.push({ dateKey:s.dateKey, dateObj:d, dayName:"Lun", code:"AUTO", status:"mn", note:"MN Auto" });
    }
  });
}

function similarity(a, b) {
  const sA = new Set(a.split('')), sB = new Set(b.split(''));
  const i = [...sA].filter(c=>sB.has(c)).length;
  const u = new Set([...sA, ...sB]).size;
  return u ? i/u : 0;
}

function showImportPreview(svcs, agents, selected) {
  pendingImport = svcs;
  const pick = $$('agentPicker'), sec = $$('agentPickerSection');
  if (pick && sec) {
    pick.innerHTML = agents.map(a => `<option value="$${a.name}" $${selected===a.name?'selected':''}>${a.name}</option>`).join('');
    sec.style.display = 'block';
    pick.onchange = () => {
      const ag = agents.find(x=>x.name===pick.value);
      if (ag && window._importRows) {
        pendingImport = buildServicesForAgent(ag, window._importDateRows, window._importRows);
        renderPreviewList(pendingImport);
        updateImportSummary(pendingImport);
      }
    };
  }
  renderPreviewList(svcs);
  updateImportSummary(svcs);
  $('backdropImport')?.classList.add('show');
  $('sheetImport')?.classList.add('show');
}

function renderPreviewList(svcs) {
  const l = $('importPreviewList');
  if (!l) return;
  if (!svcs.length) { l.innerHTML = '<div class="preview-empty">Sélectionnez un agent</div>'; return; }
  l.innerHTML = svcs.map(s => `<div class="preview-row $${s.status}"><div class="preview-date"><span class="preview-day">$${s.dayName.slice(0,3)}</span><span class="preview-num">$${s.dateObj.getDate()}/$${s.dateObj.getMonth()+1}</span></div><div class="preview-code">$${s.code}</div><div class="preview-status">$${STATUS_EMOJI[s.status]} ${STATUS_LABELS[s.status]}</div></div>`).join('');
}

function updateImportSummary(svcs) {
  const j=svcs.filter(s=>s.status==='jour').length, n=svcs.filter(s=>s.status==='nuit').length, r=svcs.filter(s=>s.status==='repos').length, m=svcs.filter(s=>s.status==='mn').length;
  $$('importSummary') && ($$('importSummary').textContent = `$${svcs.length} svc — ☀️$${j} 🌙$${n} 🌅$${m} 🏠${r}`);
}

function confirmImport() {
  if (!user || !pendingImport.length) return;
  pendingImport.forEach(it => entries.set(it.dateKey, { status:it.status, note:it.note, custom_label:it.code, imported:true }));
  $('sheetImport')?.classList.remove('show');
  $('backdropImport')?.classList.remove('show');
  renderGrid(); updateUI();
  showToast(`✅ ${pendingImport.length} importés`);
  (async () => {
    for (const it of pendingImport) {
      const p = { user_id:user.id, work_date:it.dateKey, status:it.status, note:it.note, custom_label:it.code, imported:true };
      let { error } = await supabase.from("work_calendar_entries").upsert(p, {onConflict:"user_id,work_date"});
      if (error && error.message.includes('imported')) { delete p.imported; await supabase.from("work_calendar_entries").upsert(p, {onConflict:"user_id,work_date"}); }
    }
  })();
}

// ═══════════════════════════════════════════════════════
// MODALES & EVENTS
// ═══════════════════════════════════════════════════════
function openNoteModal() {
  const e = entries.get(state.selected), d = parseKey(state.selected);
  $$('sheetTitle').textContent = `Note — $${d.getDate()} ${MONTHS[d.getMonth()]}`;
  $('noteText').value = e?.note || '';
  $('sheetNote').style.display = 'block';
  $('sheetOther').style.display = 'none';
  $('backdrop').classList.add('show');
  $('sheet').classList.add('show');
}

function openOtherModal() {
  const d = parseKey(state.selected);
  $$('sheetTitle').textContent = `Autre — $${d.getDate()} ${MONTHS[d.getMonth()]}`;
  $('otherSelect').value = "OCP";
  $('otherCustom').style.display = 'none';
  $('sheetNote').style.display = 'none';
  $('sheetOther').style.display = 'block';
  $('backdrop').classList.add('show');
  $('sheet').classList.add('show');
}

function closeModal(b, s) { $$(b)?.classList.remove('show'); $$(s)?.classList.remove('show'); }

function setupEvents() {
  $('btnPrevMonth')?.addEventListener('click', () => changeMonth(-1));
  $('btnNextMonth')?.addEventListener('click', () => changeMonth(1));
  $('btnToday')?.addEventListener('click', () => {
    const n = new Date(); state.year=n.getFullYear(); state.month=n.getMonth(); state.selected=keyFor(n);
    localStorage.setItem('ms_state', JSON.stringify(state));
    loadEntries().then(()=>{renderGrid();updateUI();});
  });
  $('btnStats')?.addEventListener('click', openStats);
  $('btnCloseStats')?.addEventListener('click', ()=>closeModal('backdropStats','sheetStats'));
  $('backdropStats')?.addEventListener('click', ()=>closeModal('backdropStats','sheetStats'));

  document.querySelectorAll('[data-set]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!state.selected) return;
      const act = btn.dataset.set;
      if (act==='note') { openNoteModal(); return; }
      if (act==='autre') { openOtherModal(); return; }
      if (act==='reset') { saveEntry(state.selected, {status:null}); return; }
      saveEntry(state.selected, { status:act, note: entries.get(state.selected)?.note||'' });
    });
  });

  $('btnSaveNote')?.addEventListener('click', () => {
    saveEntry(state.selected, { status: entries.get(state.selected)?.status||'autre', note:$('noteText').value });
    closeModal('backdrop','sheet');
  });
  $('btnClearNote')?.addEventListener('click', () => {
    saveEntry(state.selected, { status: entries.get(state.selected)?.status||'autre', note:'' });
    closeModal('backdrop','sheet');
  });
  $('backdrop')?.addEventListener('click', ()=>closeModal('backdrop','sheet'));

  $$('otherSelect')?.addEventListener('change', e => $$('otherCustom').style.display = e.target.value==='custom'?'block':'none');
  $('btnApplyOther')?.addEventListener('click', () => {
    const v=$$('otherSelect').value, c=$$('otherCustom').value;
    saveEntry(state.selected, { status:'autre', note:entries.get(state.selected)?.note||'', custom_label: v==='custom'?c:v });
    closeModal('backdrop','sheet');
  });
  $('btnCloseOther')?.addEventListener('click', ()=>closeModal('backdrop','sheet'));

  $('btnImport')?.addEventListener('click', triggerImport);
  $('fileInput')?.addEventListener('change', e => {
    handleFile(e);
    if (!e.target.files[0]) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const data = new Uint8Array(ev.target.result);
      const wb = XLSX.read(data, {type:'array'});
      let best=null, score=-1;
      wb.SheetNames.forEach(n => {
        const r = XLSX.utils.sheet_to_json(wb.Sheets[n], {header:1});
        const s = r.reduce((a,b)=>a+b.filter(c=>String(c).trim()).length,0);
        if(s>score){score=s;best=r;}
      });
      window._importRows = best;
      window._importDateRows = findDateRows(best);
    };
    reader.readAsArrayBuffer(e.target.files[0]);
  });
  $('btnConfirmImport')?.addEventListener('click', () => {
    const p = $('agentPicker');
    if (p && window._importRows) {
      const ags = detectAgents(window._importRows, window._importDateRows||[]);
      const ag = ags.find(a=>a.name===p.value);
      if (ag) pendingImport = buildServicesForAgent(ag, window._importDateRows, window._importRows);
    }
    confirmImport();
  });
  $('btnCancelImport')?.addEventListener('click', ()=>closeModal('backdropImport','sheetImport'));
  $('backdrop