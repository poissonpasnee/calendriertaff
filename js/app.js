import { createClient } from “https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm”;

// ═══════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════
const SUPABASE_URL  = “https://dstmyvzjirgyuwuojwnk.supabase.co”;
const SUPABASE_ANON = “eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRzdG15dnpqaXJneXV3dW9qd25rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk3NzY4NTUsImV4cCI6MjA4NTM1Mjg1NX0.Cl6WAvK0elHkKXnXRtrFFiBlGABnK5RTFdawq3NGDJk”;
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
theme:         ‘dark’,
agentName:     ‘’,
agentMatricule:’’,
rateDay:        35.0,
rateNightFull:  82.0,
rateNightSolo:  41.0,
rateMN:         15.0
};

// ═══════════════════════════════════════════════════════
// CONSTANTES
// ═══════════════════════════════════════════════════════
const MONTHS   = [“Janvier”,“Février”,“Mars”,“Avril”,“Mai”,“Juin”,“Juillet”,“Août”,“Septembre”,“Octobre”,“Novembre”,“Décembre”];
const BASE_SALARY = 2093.06;

const STATUS_LABELS = {
jour:   “Jour”,
nuit:   “Nuit”,
mn:     “MN”,
repos:  “Repos”,
conges: “Congés”,
autre:  “Autre”
};

const STATUS_EMOJI = {
jour:   “☀️”,
nuit:   “🌙”,
mn:     “🌅”,
repos:  “🏠”,
conges: “🏖️”,
autre:  “⚙️”
};

// ═══════════════════════════════════════════════════════
// UTILITAIRES
// ═══════════════════════════════════════════════════════
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, ‘0’);
const keyFor = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parseKey = k => { const [y,m,d] = k.split(’-’).map(Number); return new Date(y, m-1, d); };

// Normalise une chaîne : MAJUSCULES, sans accents, sans caractères spéciaux
const normalize = txt => {
if (!txt && txt !== 0) return “”;
return String(txt)
.toUpperCase()
.normalize(“NFD”)
.replace(/[\u0300-\u036f]/g, “”)
.trim();
};

// Normalise et vire aussi les espaces/ponctuation (pour comparaisons strictes)
const clean = txt => normalize(txt).replace(/[^A-Z0-9]/g, “”);

// Affiche un toast
function showToast(msg, duration = 2500) {
const t = $(‘toast’);
if (!t) return;
t.textContent = msg;
t.classList.add(‘show’);
setTimeout(() => t.classList.remove(‘show’), duration);
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
if (e.status === ‘jour’)  bonus += parseFloat(prefs.rateDay)       || 0;
if (e.status === ‘nuit’)  bonus += parseFloat(prefs.rateNightFull) || 0;
if (e.status === ‘mn’)    bonus += parseFloat(prefs.rateMN)        || 0;
}
return BASE_SALARY + bonus;
}

// ═══════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════
async function init() {
loadLocal();
applyPrefs();
if (!state.selected) state.selected = keyFor(new Date());
setupPWA();
await checkAuth();
renderGrid();
updateUI();
setupEvents();
}

function loadLocal() {
try {
const p = localStorage.getItem(‘ms_prefs’);
if (p) prefs = { …prefs, …JSON.parse(p) };
const s = localStorage.getItem(‘ms_state’);
if (s) state = { …state, …JSON.parse(s) };
} catch(e) { console.warn(“Erreur localStorage:”, e); }
}

function savePrefs() {
localStorage.setItem(‘ms_prefs’, JSON.stringify(prefs));
}

function applyPrefs() {
document.documentElement.setAttribute(‘data-theme’, prefs.theme);

// Boutons theme
$(‘themeLight’)?.classList.toggle(‘active’, prefs.theme === ‘light’);
$(‘themeDark’)?.classList.toggle(‘active’,  prefs.theme === ‘dark’);

// Champs identité
if ($(‘agentName’))       $(‘agentName’).value       = prefs.agentName || ‘’;
if ($(‘agentMatricule’))  $(‘agentMatricule’).value  = prefs.agentMatricule || ‘’;

// Taux
if ($(‘rateDay’))       $(‘rateDay’).value       = prefs.rateDay;
if ($(‘rateNightFull’)) $(‘rateNightFull’).value  = prefs.rateNightFull;
if ($(‘rateNightSolo’)) $(‘rateNightSolo’).value  = prefs.rateNightSolo;
if ($(‘rateMN’))        $(‘rateMN’).value         = prefs.rateMN;
}

// ═══════════════════════════════════════════════════════
// PWA
// ═══════════════════════════════════════════════════════
function setupPWA() {
window.addEventListener(‘beforeinstallprompt’, e => {
e.preventDefault();
pwaInstallPrompt = e;
$(‘pwaInstallRow’) && ($(‘pwaInstallRow’).style.display = ‘block’);
});
$(‘btnInstallPWA’)?.addEventListener(‘click’, async () => {
if (!pwaInstallPrompt) return;
pwaInstallPrompt.prompt();
const { outcome } = await pwaInstallPrompt.userChoice;
if (outcome === ‘accepted’) {
$(‘pwaInstallRow’).style.display = ‘none’;
showToast(“✅ App installée !”);
}
pwaInstallPrompt = null;
});
}

// ═══════════════════════════════════════════════════════
// AUTHENTIFICATION
// ═══════════════════════════════════════════════════════
async function checkAuth() {
const { data } = await supabase.auth.getSession();
if (!data?.session) {
user = null;
$(‘topSub’) && ($(‘topSub’).textContent = “Invité”);
$(‘gate’)?.classList.add(‘show’);
return;
}
user = data.session.user;
$(‘topSub’) && ($(‘topSub’).textContent = prefs.agentName || user.email.split(’@’)[0]);
$(‘gate’)?.classList.remove(‘show’);
await loadEntries();
}

async function loadEntries() {
if (!user) return;
const start = keyFor(new Date(state.year, state.month - 1, 1));
const end   = keyFor(new Date(state.year, state.month + 2, 0));

const { data, error } = await supabase
.from(“work_calendar_entries”)
.select(”*”)
.gte(“work_date”, start)
.lte(“work_date”, end);

if (error) { console.error(“Erreur chargement:”, error); return; }
entries.clear();
data?.forEach(r => entries.set(r.work_date, {
status:       r.status,
note:         r.note,
custom_label: r.custom_label,
imported:     r.imported
}));
}

// ═══════════════════════════════════════════════════════
// RENDU GRILLE (semaine commence Lundi)
// ═══════════════════════════════════════════════════════
function renderGrid() {
const grid = $(‘grid’);
if (!grid) return;
grid.innerHTML = ‘’;
cellCache.clear();

$(‘navMonth’) && ($(‘navMonth’).textContent = MONTHS[state.month]);
$(‘navYear’)  && ($(‘navYear’).textContent  = state.year);

const first    = new Date(state.year, state.month, 1);
// Décalage pour commencer lundi (0=dim → 6, 1=lun → 0, …)
let startOffset = (first.getDay() + 6) % 7;
const startDate = new Date(first);
startDate.setDate(1 - startOffset);

for (let i = 0; i < 42; i++) {
const d = new Date(startDate);
d.setDate(startDate.getDate() + i);
const k = keyFor(d);

```
// Numéro de semaine ISO
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

// Aujourd'hui
const today = keyFor(new Date());
if (k === today) cell.classList.add('today');

cell.dataset.key = k;

const entry = entries.get(k);
if (entry?.status) {
  cell.classList.add(entry.status);
  if (entry.imported) cell.classList.add('imported');
}

// Numéro du jour
const numEl = document.createElement('span');
numEl.className = 'day-num';
numEl.textContent = d.getDate();
cell.appendChild(numEl);

// Label statut
if (entry?.status && entry.status !== 'repos') {
  const labelEl = document.createElement('span');
  labelEl.className = 'day-label';
  labelEl.textContent = entry.custom_label || STATUS_LABELS[entry.status] || entry.status;
  cell.appendChild(labelEl);
}

// Point note
if (entry?.note) {
  const dot = document.createElement('div');
  dot.className = 'dot';
  cell.appendChild(dot);
}

if (k === state.selected) cell.classList.add('selected');

cell.onclick = () => {
  state.selected = k;
  localStorage.setItem('ms_state', JSON.stringify(state));
  // Mettre à jour seulement la sélection visuelle (sans re-render complet)
  cellCache.forEach((c, ck) => c.classList.toggle('selected', ck === k));
  updateDockInfo();
};

grid.appendChild(cell);
cellCache.set(k, cell);
```

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
// MISE À JOUR UI
// ═══════════════════════════════════════════════════════
function updateUI() {
updateDockInfo();
updateStats();
}

function updateDockInfo() {
if (!state.selected) return;
const d = parseKey(state.selected);
const entry = entries.get(state.selected);

$(‘selDate’) && ($(‘selDate’).textContent =
`${['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'][(d.getDay()+6)%7]} ${d.getDate()} ${MONTHS[d.getMonth()]}`);

const badge = $(‘selState’);
if (badge) {
const s = entry?.status;
badge.textContent = s ? `${STATUS_EMOJI[s] || ''} ${STATUS_LABELS[s] || s}` : “Libre”;
badge.className = `sel-badge ${s || ''}`;
}
}

function updateStats() {
let jour = 0, nuit = 0, repos = 0, mn = 0, conges = 0;
const end = new Date(state.year, state.month + 1, 0);
for (let d = 1; d <= end.getDate(); d++) {
const e = entries.get(keyFor(new Date(state.year, state.month, d)));
if (!e) continue;
if (e.status === ‘jour’)   jour++;
if (e.status === ‘nuit’)   nuit++;
if (e.status === ‘repos’)  repos++;
if (e.status === ‘mn’)     mn++;
if (e.status === ‘conges’) conges++;
}

$(‘statJour’)  && ($(‘statJour’).textContent  = jour);
$(‘statNuit’)  && ($(‘statNuit’).textContent  = nuit);
$(‘statRepos’) && ($(‘statRepos’).textContent = repos);

const sal = calculateSalary();
$(‘salaryValue’) && ($(‘salaryValue’).textContent =
sal.toLocaleString(‘fr-FR’, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ’ €’);
}

// ═══════════════════════════════════════════════════════
// MODALE STATS DÉTAILLÉES
// ═══════════════════════════════════════════════════════
function openStats() {
const end = new Date(state.year, state.month + 1, 0);
const counts = { jour:0, nuit:0, mn:0, repos:0, conges:0, autre:0 };

for (let d = 1; d <= end.getDate(); d++) {
const e = entries.get(keyFor(new Date(state.year, state.month, d)));
if (e?.status && counts[e.status] !== undefined) counts[e.status]++;
}

$(‘statsMonthLabel’) && ($(‘statsMonthLabel’).textContent = `${MONTHS[state.month]} ${state.year}`);

const content = $(‘statsContent’);
if (!content) return;

const total = counts.jour + counts.nuit + counts.mn;
const sal   = calculateSalary();

content.innerHTML = `<div class="stats-grid"> ${Object.entries(counts).map(([k, v]) =>`
<div class="stats-row ${k}">
<span class="stats-emoji">${STATUS_EMOJI[k] || ‘📌’}</span>
<span class="stats-name">${STATUS_LABELS[k] || k}</span>
<span class="stats-count">${v}</span>
<div class="stats-bar-mini"><div class="stats-bar-fill ${k}" style="width:${end.getDate() ? (v/end.getDate()*100).toFixed(0) : 0}%"></div></div>
</div>
`).join('')} </div> <div class="stats-summary"> <div class="summary-row"> <span>Total services travaillés</span> <strong>${total}</strong> </div> <div class="summary-row highlight"> <span>Estimation brute mensuelle</span> <strong>${sal.toLocaleString('fr-FR', {minimumFractionDigits:2})} €</strong> </div> <div class="summary-row muted"> <span>Base fixe incluse</span> <span>${BASE_SALARY.toLocaleString('fr-FR', {minimumFractionDigits:2})} €</span> </div> </div> `;

$(‘backdropStats’).classList.add(‘show’);
$(‘sheetStats’).classList.add(‘show’);
}

// ═══════════════════════════════════════════════════════
// SAUVEGARDE ENTRÉE
// ═══════════════════════════════════════════════════════
async function saveEntry(k, patch) {
if (!user) { $(‘gate’)?.classList.add(‘show’); return; }

const cur  = entries.get(k) || { status:’’, note:’’, custom_label:’’, imported:false };
const next = { …cur, …patch };

// Reset complet si demandé
if (patch.status === null) {
entries.delete(k);
} else {
entries.set(k, next);
}

// Mettre à jour la cellule visuellement
const cell = cellCache.get(k);
if (cell) {
const isOut = cell.classList.contains(‘out’);
const isSel = cell.classList.contains(‘selected’);
const isToday = cell.classList.contains(‘today’);

```
cell.className = ['day', isOut?'out':'', isSel?'selected':'', isToday?'today':'',
  next.status || '', next.imported?'imported':''].filter(Boolean).join(' ');

// Reconstruire le contenu
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
```

}

updateUI();
showToast(patch.status === null ? “🗑️ Entrée effacée” : `✅ ${STATUS_LABELS[next.status] || 'Enregistré'}`);

// Sync Supabase
try {
if (patch.status === null) {
await supabase.from(“work_calendar_entries”)
.delete()
.eq(‘user_id’, user.id)
.eq(‘work_date’, k);
} else {
const payload = { user_id:user.id, work_date:k, status:next.status, note:next.note, custom_label:next.custom_label };
if (next.imported === true) payload.imported = true;

```
  const { error } = await supabase.from("work_calendar_entries")
    .upsert(payload, { onConflict:"user_id,work_date" });

  if (error) {
    if (error.message.includes('imported')) {
      delete payload.imported;
      const { error:e2 } = await supabase.from("work_calendar_entries")
        .upsert(payload, { onConflict:"user_id,work_date" });
      if (e2) throw e2;
    } else throw error;
  }
}
```

} catch(e) {
console.error(“Erreur sync:”, e);
showToast(“⚠️ Erreur de synchronisation”);
await loadEntries();
renderGrid();
}
}

// ═══════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════
//  MOTEUR D’IMPORT EXCEL — VERSION 2.0
//  Stratégie :
//  1. Extraire toutes les cellules avec leur position (row, col)
//  2. Détecter toutes les personnes (lignes contenant des noms)
//  3. Si prefs.agentName défini → chercher ce nom en priorité
//  4. Sinon → lister les agents trouvés et laisser l’utilisateur choisir
//  5. Une fois l’agent ciblé, mapper les dates depuis la ligne d’en-tête
//  6. Lire les codes sur la ligne de l’agent et les interpréter
// ════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════

function triggerImport() {
if (!user) {
showToast(“Connectez-vous d’abord.”);
$(‘gate’)?.classList.add(‘show’);
return;
}
$(‘fileInput’).click();
}

function handleFile(e) {
const file = e.target.files[0];
if (!file) return;
$(‘fileInput’).value = ‘’;

const reader = new FileReader();
reader.onload = evt => {
try {
const data = new Uint8Array(evt.target.result);
const wb   = XLSX.read(data, { type:‘array’, cellText:true, raw:false });
if (!wb.SheetNames.length) throw new Error(“Fichier vide”);

```
  // Analyser chaque feuille, prendre celle avec le plus de contenu
  let bestSheet = null;
  let bestScore = -1;
  wb.SheetNames.forEach(name => {
    const ws    = wb.Sheets[name];
    const rows  = XLSX.utils.sheet_to_json(ws, { header:1, defval:"" });
    const score = rows.reduce((s, r) => s + r.filter(c => String(c).trim()).length, 0);
    if (score > bestScore) { bestScore = score; bestSheet = rows; }
  });

  importAnalyze(bestSheet);
} catch(err) {
  console.error(err);
  showToast("❌ Erreur lecture Excel");
}
```

};
reader.readAsArrayBuffer(file);
}

// ─── ANALYSE PRINCIPALE ───────────────────────────────
function importAnalyze(rows) {
console.log(`📊 Import: ${rows.length} lignes`);

// ── 1. Trouver toutes les lignes contenant des dates ──
const dateRows = findDateRows(rows);
if (!dateRows.length) {
showToast(“❌ Aucune date trouvée dans le fichier”);
return;
}
console.log(“📅 Lignes de dates:”, dateRows.map(r => r.rowIdx));

// ── 2. Détection des agents (noms propres) ──
const agents = detectAgents(rows, dateRows);
console.log(“👤 Agents détectés:”, agents.map(a => a.name));

if (!agents.length) {
showToast(“❌ Aucun agent trouvé dans le fichier”);
return;
}

// ── 3. Filtrer par nom enregistré (si défini) ──
let targetAgent = null;
if (prefs.agentName && prefs.agentName.trim()) {
const searchName = normalize(prefs.agentName);
targetAgent = agents.find(a => {
const n = normalize(a.name);
return n.includes(searchName) || searchName.includes(n) ||
similarity(n, searchName) > 0.75;
});
if (targetAgent) console.log(“✅ Agent trouvé par préférences:”, targetAgent.name);
}

// ── 4. Construire les services pour l’agent ──
if (targetAgent) {
const services = buildServicesForAgent(targetAgent, dateRows, rows);
showImportPreview(services, agents, targetAgent.name);
} else {
// Afficher le sélecteur d’agent
showImportPreview([], agents, null);
}
}

// ─── DÉTECTION DES LIGNES DE DATES ────────────────────
function findDateRows(rows) {
const dateRows = [];

rows.forEach((row, rowIdx) => {
const dateMap = {};
let dateCount = 0;

```
row.forEach((cell, colIdx) => {
  const val = String(cell).trim();

  // Format JJ/MM ou JJ/MM/AAAA
  const m1 = val.match(/^(\d{1,2})[\/\-\.](\d{1,2})(?:[\/\-\.](\d{2,4}))?$/);
  if (m1) {
    const day = parseInt(m1[1]);
    const mo  = parseInt(m1[2]) - 1;
    const yr  = m1[3] ? (m1[3].length === 2 ? 2000+parseInt(m1[3]) : parseInt(m1[3])) : state.year;
    if (day >= 1 && day <= 31 && mo >= 0 && mo <= 11) {
      dateMap[colIdx] = new Date(yr, mo, day);
      dateCount++;
    }
    return;
  }

  // Nombre seul 1-31 (potentiellement un jour du mois)
  const m2 = val.match(/^(\d{1,2})$/);
  if (m2) {
    const n = parseInt(m2[1]);
    if (n >= 1 && n <= 31) {
      dateMap[colIdx] = { dayOnly: n }; // résolu plus tard avec le mois
      dateCount++;
    }
  }
});

if (dateCount >= 5) { // Au moins 5 dates dans la ligne
  dateRows.push({ rowIdx, dateMap, dateCount });
}
```

});

return dateRows;
}

// ─── DÉTECTION DES AGENTS ─────────────────────────────
function detectAgents(rows, dateRows) {
const agents   = [];
const dateRowIdxs = new Set(dateRows.map(d => d.rowIdx));

// Patterns de noms : 2 mots consécutifs de plus de 2 lettres
// On cherche dans toutes les lignes qui ne sont pas des lignes de dates
rows.forEach((row, rowIdx) => {
if (dateRowIdxs.has(rowIdx)) return;

```
row.forEach((cell, colIdx) => {
  const val = String(cell).trim();
  if (val.length < 4) return;

  // Détecter "Prénom NOM" ou "NOM Prénom" ou "NOM PRÉNOM" (≥2 mots, lettres seulement)
  const words = val.split(/\s+/).filter(w => /^[A-Za-zÀ-ÿ\-]{2,}$/.test(w));
  if (words.length >= 2 && words.length <= 4) {
    const hasUpper = words.some(w => w === w.toUpperCase() && w.length > 2);
    const hasAlpha = words.every(w => /^[A-Za-zÀ-ÿ\-]+$/.test(w));
    if (hasAlpha) {
      const existing = agents.find(a => normalize(a.name) === normalize(val));
      if (!existing) {
        agents.push({ name: val, rowIdx, colIdx, isUpperCase: hasUpper });
      }
    }
  }
});
```

});

// Trier : noms en MAJUSCULES en premier (plus probables d’être des agents)
return agents.sort((a, b) => (b.isUpperCase ? 1 : 0) - (a.isUpperCase ? 1 : 0));
}

// ─── CONSTRUCTION DES SERVICES POUR UN AGENT ──────────
function buildServicesForAgent(agent, dateRows, rows) {
console.log(`🔨 Construction services pour ${agent.name} (ligne ${agent.rowIdx})`);

// Trouver la ligne de dates la plus proche AU-DESSUS de l’agent
const relevantDateRow = dateRows
.filter(dr => dr.rowIdx <= agent.rowIdx)
.sort((a, b) => b.rowIdx - a.rowIdx)[0];

if (!relevantDateRow) {
console.warn(“Pas de ligne de dates trouvée au-dessus de l’agent”);
return [];
}

// Résoudre le mois des dates (chercher mention du mois dans les lignes proches)
const resolvedMonth = resolveMonth(rows, relevantDateRow.rowIdx);
console.log(`📅 Mois résolu: ${resolvedMonth}`);

// Construire la carte colonne → date
const colToDate = {};
Object.entries(relevantDateRow.dateMap).forEach(([col, val]) => {
const c = parseInt(col);
if (val instanceof Date) {
colToDate[c] = val;
} else if (val?.dayOnly) {
colToDate[c] = new Date(state.year, resolvedMonth, val.dayOnly);
}
});

// Lire la ligne de l’agent
const agentRow = rows[agent.rowIdx] || [];

// Chercher aussi les lignes adjacentes (l’agent peut être sur plusieurs lignes)
const rowsToScan = [agent.rowIdx];
// Scanner les 2 lignes suivantes au cas où les codes seraient en dessous du nom
for (let i = 1; i <= 3; i++) {
if (rows[agent.rowIdx + i]) rowsToScan.push(agent.rowIdx + i);
}

const services = [];
const usedDates = new Set();

rowsToScan.forEach(ri => {
const row = rows[ri] || [];
row.forEach((cell, colIdx) => {
const rawVal = String(cell).trim();
if (!rawVal || rawVal.length < 1) return;

```
  // Trouver la date associée à cette colonne
  let dateObj = colToDate[colIdx];
  if (!dateObj) {
    // Chercher la date la plus proche à gauche
    for (let c = colIdx; c >= 0; c--) {
      if (colToDate[c]) { dateObj = colToDate[c]; break; }
    }
  }
  if (!dateObj) return;

  const k = keyFor(dateObj);
  if (usedDates.has(k)) return;

  const status = interpretCode(rawVal);
  if (!status) return;

  usedDates.add(k);
  services.push({
    dateKey:  k,
    dateObj,
    dayName:  dateObj.toLocaleDateString('fr-FR', { weekday:'long' }),
    code:     rawVal.toUpperCase(),
    status,
    note:     `Import: ${rawVal.toUpperCase()}`
  });
});
```

});

// Appliquer les règles MN
applyMNRules(services);

// Trier par date
services.sort((a, b) => a.dateKey.localeCompare(b.dateKey));

console.log(`✅ ${services.length} services extraits`);
return services;
}

// ─── RÉSOLUTION DU MOIS ────────────────────────────────
function resolveMonth(rows, nearRow) {
const MONTHS_FR = [“JANVIER”,“FEVRIER”,“MARS”,“AVRIL”,“MAI”,“JUIN”,
“JUILLET”,“AOUT”,“SEPTEMBRE”,“OCTOBRE”,“NOVEMBRE”,“DECEMBRE”];

// Chercher dans les ~10 lignes autour
const start = Math.max(0, nearRow - 10);
const end   = Math.min(rows.length - 1, nearRow + 5);

for (let r = start; r <= end; r++) {
const text = normalize(rows[r].join(” “));
for (let i = 0; i < MONTHS_FR.length; i++) {
if (text.includes(MONTHS_FR[i])) return i;
}
}
return state.month; // Fallback sur le mois affiché
}

// ─── INTERPRÉTATION DES CODES ─────────────────────────
function interpretCode(raw) {
const val    = clean(raw);
const rawUp  = normalize(raw);

if (!val || val.length < 1) return null;

// Mots-clés explicites
if (rawUp.includes(“NUIT”) || rawUp.includes(“NUIT COMPL”)) return “nuit”;
if (rawUp.includes(“JOUR”))   return “jour”;
if (rawUp.includes(“REPOS”) || rawUp.includes(“OFF”)) return “repos”;
if (rawUp.includes(“CONG”) || rawUp.includes(” CP”) || rawUp === “CP”) return “conges”;
if (rawUp.includes(“MN”) || rawUp.includes(“MONTEE”))  return “mn”;

// Codes 1 lettre
if (val === “N”) return “nuit”;
if (val === “J”) return “jour”;
if (val === “R”) return “repos”;

// Codes commençant par une lettre + chiffres (ex: N01, J12, R3, MN5)
if (/^N\d+$/.test(val)) return “nuit”;
if (/^J\d+$/.test(val)) return “jour”;
if (/^R\d+$/.test(val)) return “repos”;
if (/^MN\d*$/.test(val)) return “mn”;
if (/^CP\d*$/.test(val)) return “conges”;

// Codes mixtes commençant par N/J/R
if (val.startsWith(“N”) && val.length <= 6) return “nuit”;
if (val.startsWith(“J”) && val.length <= 6) return “jour”;
if (val.startsWith(“R”) && val.length <= 6) return “repos”;

// Chantiers (codes alphanumériques 2-6 chars avec lettres ET chiffres)
if (/[A-Z]/.test(val) && /[0-9]/.test(val) && val.length >= 2 && val.length <= 6) {
return “autre”; // Chantier non catégorisé
}

return null; // Ignorer
}

// ─── RÈGLES MN ─────────────────────────────────────────
function applyMNRules(services) {
const nightKeys = services
.filter(s => s.status === “nuit”)
.map(s => s.dateKey);

nightKeys.forEach(k => {
const d = parseKey(k);
// Ne pas ajouter MN le lendemain d’une nuit du dimanche (fin lundi)
if (d.getDay() === 1) return; // Lundi

```
// Vérifier si MN déjà présente ce jour
if (!services.find(s => s.dateKey === k && s.status === "mn")) {
  services.push({
    dateKey: k,
    dateObj: d,
    dayName: d.toLocaleDateString('fr-FR', { weekday:'long' }),
    code:    "MN-AUTO",
    status:  "mn",
    note:    "MN Auto (05h-09h)"
  });
}
```

});
}

// ─── SIMILARITÉ ENTRE CHAÎNES (Jaccard) ───────────────
function similarity(a, b) {
const setA = new Set(a.split(’’));
const setB = new Set(b.split(’’));
const inter = […setA].filter(c => setB.has(c)).length;
const union = new Set([…setA, …setB]).size;
return union ? inter / union : 0;
}

// ─── APERÇU IMPORT ────────────────────────────────────
function showImportPreview(services, agents, selectedAgent) {
pendingImport = services;

// Remplir le sélecteur d’agents
const picker = $(‘agentPicker’);
const pickerSection = $(‘agentPickerSection’);

if (picker && pickerSection) {
picker.innerHTML = agents.map(a =>
`<option value="${a.name}" ${selectedAgent === a.name ? 'selected':''}> ${a.name} (ligne ${a.rowIdx + 1}) </option>`
).join(’’);
pickerSection.style.display = ‘block’;

```
// Quand on change d'agent → recalculer
picker.onchange = () => {
  const chosenName = picker.value;
  const chosenAgent = agents.find(a => a.name === chosenName);
  // On doit re-analyser... stocker rows dans une variable globale temporaire
  if (window._importRows && chosenAgent) {
    const svcs = buildServicesForAgent(chosenAgent, window._importDateRows, window._importRows);
    pendingImport = svcs;
    renderPreviewList(svcs);
    updateImportSummary(svcs);
  }
};
```

}

renderPreviewList(services);
updateImportSummary(services);

$(‘backdropImport’)?.classList.add(‘show’);
$(‘sheetImport’)?.classList.add(‘show’);
}

function renderPreviewList(services) {
const list = $(‘importPreviewList’);
if (!list) return;

if (!services.length) {
list.innerHTML = `<div class="preview-empty">Sélectionnez un agent pour voir ses services</div>`;
return;
}

list.innerHTML = services.map(s => `<div class="preview-row ${s.status}"> <div class="preview-date"> <span class="preview-day">${s.dayName.slice(0,3)}</span> <span class="preview-num">${s.dateObj.getDate()}/${s.dateObj.getMonth()+1}</span> </div> <div class="preview-code">${s.code}</div> <div class="preview-status">${STATUS_EMOJI[s.status] || '📌'} ${STATUS_LABELS[s.status] || s.status}</div> </div>`).join(’’);
}

function updateImportSummary(services) {
const jour   = services.filter(s => s.status === ‘jour’).length;
const nuit   = services.filter(s => s.status === ‘nuit’).length;
const repos  = services.filter(s => s.status === ‘repos’).length;
const mn     = services.filter(s => s.status === ‘mn’).length;
const total  = services.length;

$(‘importSummary’) && ($(‘importSummary’).textContent =
`${total} service(s) détecté(s) — ☀️${jour} 🌙${nuit} 🌅${mn} 🏠${repos}`);
}

function confirmImport() {
if (!user || !pendingImport.length) return;

pendingImport.forEach(item => {
entries.set(item.dateKey, {
status:       item.status,
note:         item.note,
custom_label: item.code,
imported:     true
});
});

$(‘sheetImport’)?.classList.remove(‘show’);
$(‘backdropImport’)?.classList.remove(‘show’);

renderGrid();
updateUI();
showToast(`✅ ${pendingImport.length} services importés !`);

// Sync asynchrone
(async () => {
let ok = 0;
for (const item of pendingImport) {
const payload = {
user_id:      user.id,
work_date:    item.dateKey,
status:       item.status,
note:         item.note,
custom_label: item.code,
imported:     true
};
const { error } = await supabase.from(“work_calendar_entries”)
.upsert(payload, { onConflict:“user_id,work_date” });

```
  if (!error) {
    ok++;
  } else if (error.message?.includes('imported')) {
    delete payload.imported;
    const { error:e2 } = await supabase.from("work_calendar_entries")
      .upsert(payload, { onConflict:"user_id,work_date" });
    if (!e2) ok++;
  }
}
console.log(`☁️ Synchro: ${ok}/${pendingImport.length} sauvegardés`);
```

})();
}

// ═══════════════════════════════════════════════════════
// MODALES
// ═══════════════════════════════════════════════════════
function openNoteModal() {
const entry = entries.get(state.selected);
const d = parseKey(state.selected);
$(‘sheetTitle’) && ($(‘sheetTitle’).textContent = `Note — ${d.getDate()} ${MONTHS[d.getMonth()]}`);
$(‘noteText’)   && ($(‘noteText’).value = entry?.note || ‘’);
$(‘sheetNote’) && ($(‘sheetNote’).style.display = ‘block’);
$(‘sheetOther’) && ($(‘sheetOther’).style.display = ‘none’);
$(‘backdrop’)?.classList.add(‘show’);
$(‘sheet’)?.classList.add(‘show’);
}

function openOtherModal() {
const d = parseKey(state.selected);
$(‘sheetTitle’) && ($(‘sheetTitle’).textContent = `Autre — ${d.getDate()} ${MONTHS[d.getMonth()]}`);
$(‘otherSelect’) && ($(‘otherSelect’).value = “OCP”);
$(‘otherCustom’) && ($(‘otherCustom’).style.display = ‘none’);
$(‘sheetNote’) && ($(‘sheetNote’).style.display = ‘none’);
$(‘sheetOther’) && ($(‘sheetOther’).style.display = ‘block’);
$(‘backdrop’)?.classList.add(‘show’);
$(‘sheet’)?.classList.add(‘show’);
}

function closeModal(backdropId, sheetId) {
$(backdropId)?.classList.remove(‘show’);
$(sheetId)?.classList.remove(‘show’);
}

// ═══════════════════════════════════════════════════════
// ÉVÉNEMENTS
// ═══════════════════════════════════════════════════════
function setupEvents() {

// ─── Navigation mois ───
$(‘btnPrevMonth’)?.addEventListener(‘click’, () => changeMonth(-1));
$(‘btnNextMonth’)?.addEventListener(‘click’, () => changeMonth(+1));
$(‘btnToday’)?.addEventListener(‘click’, () => {
const n = new Date();
state.year = n.getFullYear();
state.month = n.getMonth();
state.selected = keyFor(n);
localStorage.setItem(‘ms_state’, JSON.stringify(state));
loadEntries().then(() => { renderGrid(); updateUI(); });
});

// ─── Stats ───
$(‘btnStats’)?.addEventListener(‘click’, openStats);
$(‘btnCloseStats’)?.addEventListener(‘click’, () => closeModal(‘backdropStats’,‘sheetStats’));
$(‘backdropStats’)?.addEventListener(‘click’, () => closeModal(‘backdropStats’,‘sheetStats’));

// ─── Dock boutons ───
document.querySelectorAll(’[data-set]’).forEach(btn => {
btn.addEventListener(‘click’, () => {
if (!state.selected) return;
const action = btn.dataset.set;

```
  if (action === 'note')  { openNoteModal(); return; }
  if (action === 'autre') { openOtherModal(); return; }
  if (action === 'reset') {
    saveEntry(state.selected, { status: null });
    return;
  }

  const currentNote = entries.get(state.selected)?.note || '';
  saveEntry(state.selected, { status: action, note: currentNote });
});
```

});

// ─── Note ───
$(‘btnSaveNote’)?.addEventListener(‘click’, () => {
const currentStatus = entries.get(state.selected)?.status || ‘autre’;
saveEntry(state.selected, { status: currentStatus, note: $(‘noteText’).value });
closeModal(‘backdrop’,‘sheet’);
});
$(‘btnClearNote’)?.addEventListener(‘click’, () => {
const currentStatus = entries.get(state.selected)?.status || ‘autre’;
saveEntry(state.selected, { status: currentStatus, note: ‘’ });
closeModal(‘backdrop’,‘sheet’);
});
$(‘backdrop’)?.addEventListener(‘click’, () => closeModal(‘backdrop’,‘sheet’));

// ─── Autre ───
$(‘otherSelect’)?.addEventListener(‘change’, e => {
$(‘otherCustom’) && ($(‘otherCustom’).style.display = e.target.value === ‘custom’ ? ‘block’ : ‘none’);
});
$(‘btnApplyOther’)?.addEventListener(‘click’, () => {
const val    = $(‘otherSelect’).value;
const custom = $(‘otherCustom’).value;
const label  = val === ‘custom’ ? custom : val;
const note   = entries.get(state.selected)?.note || ‘’;
saveEntry(state.selected, { status:‘autre’, note, custom_label: label });
closeModal(‘backdrop’,‘sheet’);
});
$(‘btnCloseOther’)?.addEventListener(‘click’, () => closeModal(‘backdrop’,‘sheet’));

// ─── Import ───
$(‘btnImport’)?.addEventListener(‘click’, triggerImport);
$(‘fileInput’)?.addEventListener(‘change’, e => {
handleFile(e);
// Stocker les rows globalement pour le sélecteur d’agents
const file = e.target.files[0];
if (!file) return;
const reader = new FileReader();
reader.onload = evt => {
const data = new Uint8Array(evt.target.result);
const wb   = XLSX.read(data, { type:‘array’, cellText:true, raw:false });
if (!wb.SheetNames.length) return;
let bestSheet = null; let bestScore = -1;
wb.SheetNames.forEach(name => {
const ws = wb.Sheets[name];
const rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:”” });
const score = rows.reduce((s,r) => s + r.filter(c=>String(c).trim()).length, 0);
if (score > bestScore) { bestScore = score; bestSheet = rows; }
});
window._importRows     = bestSheet;
window._importDateRows = findDateRows(bestSheet);
};
reader.readAsArrayBuffer(file);
});
$(‘btnConfirmImport’)?.addEventListener(‘click’, () => {
// Si agent picker visible, recalculer avec l’agent sélectionné
const picker = $(‘agentPicker’);
if (picker && window._importRows) {
const agents  = detectAgents(window._importRows, window._importDateRows || []);
const chosen  = agents.find(a => a.name === picker.value);
if (chosen) {
pendingImport = buildServicesForAgent(chosen, window._importDateRows, window._importRows);
}
}
confirmImport();
});
$(‘btnCancelImport’)?.addEventListener(‘click’, () => closeModal(‘backdropImport’,‘sheetImport’));
$(‘backdropImport’)?.addEventListener(‘click’, () => closeModal(‘backdropImport’,‘sheetImport’));

// ─── Paramètres ───
$(‘btnSettings’)?.addEventListener(‘click’, e => {
e.stopPropagation();
$(‘settingsPop’)?.classList.toggle(‘show’);
});
$(‘btnCloseSettings’)?.addEventListener(‘click’, () => $(‘settingsPop’)?.classList.remove(‘show’));
$(‘settingsPop’)?.addEventListener(‘click’, e => e.stopPropagation());
document.addEventListener(‘click’, () => $(‘settingsPop’)?.classList.remove(‘show’));

$(‘themeLight’)?.addEventListener(‘click’, () => { prefs.theme = ‘light’; savePrefs(); applyPrefs(); });
$(‘themeDark’)?.addEventListener(‘click’,  () => { prefs.theme = ‘dark’;  savePrefs(); applyPrefs(); });

$(‘agentName’)?.addEventListener(‘change’, e => {
prefs.agentName = e.target.value.trim();
savePrefs();
if ($(‘topSub’)) $(‘topSub’).textContent = prefs.agentName || user?.email?.split(’@’)[0] || ‘Invité’;
showToast(“✅ Nom enregistré : “ + prefs.agentName);
});
$(‘agentMatricule’)?.addEventListener(‘change’, e => {
prefs.agentMatricule = e.target.value.trim();
savePrefs();
});

[‘rateDay’,‘rateNightFull’,‘rateNightSolo’,‘rateMN’].forEach(id => {
$(id)?.addEventListener(‘change’, e => {
prefs[id.replace(‘rate’,‘rate’)] = parseFloat(e.target.value) || 0;
// Correction mapping
const map = { rateDay:‘rateDay’, rateNightFull:‘rateNightFull’, rateNightSolo:‘rateNightSolo’, rateMN:‘rateMN’ };
prefs[map[id]] = parseFloat(e.target.value) || 0;
savePrefs();
updateUI();
});
});

// ─── Auth ───
$(‘btnLogin’)?.addEventListener(‘click’, async () => {
const email = $(‘loginEmail’).value;
const pass  = $(‘loginPass’).value;
if (!email || !pass) { $(‘loginHint’).textContent = “Email et mot de passe requis.”; return; }
$(‘loginHint’).textContent = “Connexion…”;
const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
if (error) $(‘loginHint’).textContent = “❌ “ + error.message;
else checkAuth();
});

$(‘btnSignup’)?.addEventListener(‘click’, async () => {
const email = $(‘signupEmail’).value;
const pass  = $(‘signupPass’).value;
if (!email || !pass) { $(‘signupHint’).textContent = “Champs requis.”; return; }
if (pass.length < 6) { $(‘signupHint’).textContent = “6 caractères min.”; return; }
$(‘signupHint’).textContent = “Création…”;
const { error } = await supabase.auth.signUp({ email, password: pass });
if (error) $(‘signupHint’).textContent = “❌ “ + error.message;
else { $(‘signupHint’).textContent = “✅ Vérifiez vos emails !”; }
});

$(‘tabSignup’)?.addEventListener(‘click’, () => {
$(‘formLogin’).style.display = ‘none’;
$(‘formSignup’).style.display = ‘block’;
});
$(‘tabLogin’)?.addEventListener(‘click’, () => {
$(‘formSignup’).style.display = ‘none’;
$(‘formLogin’).style.display = ‘block’;
});

$(‘btnLogout’)?.addEventListener(‘click’, async () => {
await supabase.auth.signOut();
user = null;
entries.clear();
checkAuth();
renderGrid();
});

// ─── Login avec Entrée ───
[$(‘loginEmail’), $(‘loginPass’)].forEach(el => {
el?.addEventListener(‘keydown’, e => { if (e.key === ‘Enter’) $(‘btnLogin’)?.click(); });
});
}

function changeMonth(delta) {
state.month += delta;
if (state.month < 0)  { state.month = 11; state.year–; }
if (state.month > 11) { state.month = 0;  state.year++; }
localStorage.setItem(‘ms_state’, JSON.stringify(state));
loadEntries().then(() => { renderGrid(); updateUI(); });
}

// ─── LANCEMENT ────────────────────────────────────────
init();