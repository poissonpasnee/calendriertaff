import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://dstmyvzjirgyuwuojwnk.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRzdG15dnpqaXJneXV3dW9qd25rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk3NzY4NTUsImV4cCI6MjA4NTM1Mjg1NX0.Cl6WAvK0elHkKXnXRtrFFiBlGABnK5RTFdawq3NGDJk";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

let user = null;
let entries = new Map();
let state = { year: 2026, month: 0, selected: null };
let prefs = { theme: 'dark', rateDay: 35.0, rateNightFull: 82.0 };
let cellCache = new Map();
let pendingImport = [];

const MONTHS = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
const LABELS = { jour:"Jour", nuit:"Nuit", repos:"Repos", conges:"Congés", autre:"Autre" };
const BASE_SALARY = 2093.06;
const DAYS_FR = ["DIMANCHE", "LUNDI", "MARDI", "MERCREDI", "JEUDI", "VENDREDI", "SAMEDI"];

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const parseKey = (k) => { const [y,m,d] = k.split('-').map(Number); return new Date(y, m-1, d); };
const keyFor = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const clean = (txt) => { if(!txt) return ""; return String(txt).toUpperCase().replace(/[^A-Z0-9]/g, ""); };

// --- MOTEUR ---
function calculateMonthSalary(year, month) {
  let total = 0;
  const end = new Date(year, month + 1, 0);
  for(let d=1; d<=end.getDate(); d++) {
    const k = keyFor(new Date(year, month, d));
    const e = entries.get(k);
    if(e?.status === 'jour') total += prefs.rateDay;
    if(e?.status === 'nuit') total += prefs.rateNightFull;
  }
  return BASE_SALARY + total;
}

async function init() {
  loadLocal();
  applyPrefs();
  renderGrid();
  updateUI();
  await checkAuth();
  setupEvents();
}

function loadLocal() {
  const p = localStorage.getItem('prefs'); if(p) prefs = {...prefs, ...JSON.parse(p)};
  const s = localStorage.getItem('state'); if(s) state = {...state, ...JSON.parse(s)};
  else { const n=new Date(); state.year=n.getFullYear(); state.month=n.getMonth(); state.selected=keyFor(n); }
}

function applyPrefs() {
  document.documentElement.setAttribute('data-theme', prefs.theme);
  if($('rateDay')) $('rateDay').value = prefs.rateDay;
  if($('rateNightFull')) $('rateNightFull').value = prefs.rateNightFull;
  $('themeLight').classList.toggle('active', prefs.theme==='light');
  $('themeDark').classList.toggle('active', prefs.theme==='dark');
}

async function checkAuth() {
  const { data } = await supabase.auth.getSession();
  if(!data?.session) { $('gate').classList.add('show'); $('topSub').textContent="Invité"; return; }
  user = data.session.user;
  $('gate').classList.remove('show');
  $('topSub').textContent = user.email.split('@')[0];
  await loadEntries();
  renderGrid();
  updateUI();
}

async function loadEntries() {
  if(!user) return;
  const start = keyFor(new Date(state.year, state.month-1, 1));
  const end = keyFor(new Date(state.year, state.month+2, 0));
  const { data, error } = await supabase.from("work_calendar_entries").select("*").gte("work_date", start).lte("work_date", end);
  if(error) return;
  entries.clear();
  data.forEach(r => entries.set(r.work_date, { status: r.status, note: r.note, custom_label: r.custom_label, imported: r.imported }));
}

// --- RENDU ---
function renderGrid() {
  const grid = $('grid'); if(!grid) return; grid.innerHTML = ''; cellCache.clear();
  let dy = state.year, dm = state.month;
  if($('navMonth')) $('navMonth').textContent = MONTHS[dm];
  if($('navYear')) $('navYear').textContent = dy;
  
  const first = new Date(dy, dm, 1);
  let start = new Date(first); start.setDate(first.getDate() - first.getDay());
  
  for(let i=0; i<42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const k = keyFor(d);
    if(i%7===0) { const wn = document.createElement('div'); wn.className='weeknum'; wn.textContent = Math.ceil(d.getDate()/7); grid.appendChild(wn); }
    
    const cell = document.createElement('div'); cell.className = 'day';
    if(d.getMonth() !== dm) cell.classList.add('out');
    cell.textContent = d.getDate(); cell.dataset.key = k;
    
    const e = entries.get(k);
    if(e?.status) {
      cell.classList.add(e.status);
      if(e.imported) { cell.style.border = '2px dashed var(--accent)'; }
      if(e.note) { const dot=document.createElement('div'); dot.className='dot'; cell.appendChild(dot); }
    }
    if(k === state.selected) cell.classList.add('selected');
    cell.onclick = () => { state.selected=k; localStorage.setItem('state', JSON.stringify(state)); renderGrid(); updateUI(); };
    grid.appendChild(cell); cellCache.set(k, cell);
  }
}

function updateUI() {
  const d = parseKey(state.selected);
  $('selDate').textContent = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  const e = entries.get(state.selected);
  $('selState').textContent = e?.status ? LABELS[e.status] : "Libre";
  $('statCount').textContent = Array.from(entries.values()).filter(x=>['jour','nuit','autre'].includes(x.status)).length;
  $('salaryValue').textContent = calculateMonthSalary(state.year, state.month).toFixed(2) + ' €';
}

async function saveEntry(k, patch) {
  if(!user) return;
  const cur = entries.get(k) || { status:'', note:'', custom_label:'', imported:false };
  const next = { ...cur, ...patch };
  entries.set(k, next);
  
  const cell = cellCache.get(k);
  if(cell) {
    cell.className = `day ${cell.classList.contains('out')?'out':''} ${next.status||''}`;
    if(next.imported) cell.style.border = '2px dashed var(--accent)';
    // Dot logic omitted for brevity
  }
  updateUI();
  
  await supabase.from("work_calendar_entries").upsert({
    user_id: user.id, work_date: k, status: next.status, note: next.note, custom_label: next.custom_label, imported: next.imported
  }, { onConflict: "user_id,work_date" });
}

// --- IA "DATA MINING" ---
function triggerImport() { $('fileInput').click(); }

function handleFile(e) {
  const file = e.target.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const wb = XLSX.read(new Uint8Array(evt.target.result), { type:'array', cellText:true, raw:false });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header:1, defval:"" });
      findBestRow(rows);
    } catch(err) { alert("Erreur de lecture"); }
    $('fileInput').value = '';
  };
  reader.readAsArrayBuffer(file);
}

function findBestRow(rows) {
  let bestScore = -1;
  let bestRowIdx = -1;
  let bestRowData = [];

  // 1. Scanner toutes les lignes pour trouver celle avec le plus de codes
  for(let r=0; r<rows.length; r++) {
    const row = rows[r];
    let score = 0;
    row.forEach(cell => {
      const val = clean(cell);
      // Un code = 1 lettre + chiffres, longueur 2-5
      if(/[A-Z]/.test(val) && /[0-9]/.test(val) && val.length>=2 && val.length<=5) score++;
    });
    
    if(score > bestScore) {
      bestScore = score;
      bestRowIdx = r;
      bestRowData = row;
    }
  }

  if(bestScore === 0) return alert("❌ Aucun code de chantier (N28, J12...) détecté dans le fichier.");

  console.log(`✅ Ligne idéale trouvée à l'index ${bestRowIdx} avec un score de ${bestScore} codes.`);
  extractData(rows, bestRowIdx, bestRowData);
}

function extractData(rows, rowIdx, rowData) {
  // 2. Trouver l'en-tête de dates au-dessus de cette ligne
  let headerIdx = -1;
  for(let r=rowIdx-1; r>=0; r--) {
    const txt = rows[r].join(" ").toUpperCase();
    let days = 0;
    DAYS_FR.forEach(d => { if(txt.includes(d)) days++; });
    if(days >= 3) { headerIdx = r; break; }
  }

  if(headerIdx === -1) return alert("❌ Impossible de trouver les jours de la semaine au-dessus de votre ligne.");

  // 3. Mapper les dates
  const monthsFr = ["JANVIER","FÉVRIER","MARS","AVRIL","MAI","JUIN","JUILLET","AOÛT","SEPTEMBRE","OCTOBRE","NOVEMBRE","DÉCEMBRE"];
  const year = new Date().getFullYear();
  let month = state.month;
  const headTxt = rows[headerIdx].join(" ").toUpperCase();
  monthsFr.forEach((m,i) => { if(headTxt.includes(m)) month=i; });

  const dateMap = {};
  const headRow = rows[headerIdx];
  const subRow = rows[headerIdx+1] || [];
  
  for(let c=0; c<Math.max(headRow.length, subRow.length); c++) {
    const c1 = String(headRow[c]||""); const c2 = String(subRow[c]||"");
    let date = null;
    const m1 = c1.match(/(\d{1,2})[/\-\.](\d{1,2})/);
    if(m1) date = new Date(year, parseInt(m1[2])-1, parseInt(m1[1]));
    if(!date && /^\d{1,2}$/.test(c1.trim())) date = new Date(year, month, parseInt(c1.trim()));
    if(!date) {
      const m2 = c2.match(/(\d{1,2})[/\-\.](\d{1,2})/);
      if(m2) date = new Date(year, parseInt(m2[2])-1, parseInt(m2[1]));
    }
    if(date && !isNaN(date)) dateMap[c] = date;
  }

  // 4. Extraire les codes de la ligne idéale
  const services = [];
  rowData.forEach((cell, c) => {
    const val = clean(cell);
    if(/[A-Z]/.test(val) && /[0-9]/.test(val) && val.length>=2 && val.length<=5) {
      // Chercher date à gauche
      let d = null;
      for(let back=c; back>=0; back--) if(dateMap[back]) { d=dateMap[back]; break; }
      
      if(d && d.getMonth() === state.month) {
        let status = 'autre';
        if(val.startsWith('N')) status='nuit';
        else if(val.startsWith('J')) status='jour';
        else if(val.startsWith('R')) status='repos';
        
        const k = keyFor(d);
        if(!services.find(s=>s.dateKey===k)) {
          services.push({ dateKey:k, dateObj:d, dayName:d.toLocaleDateString('fr-FR',{weekday:'long'}), code:val, status, note:`Auto: ${val}` });
        }
      }
    }
  });

  if(services.length === 0) return alert("⚠️ Codes trouvés, mais aucune date correspondante dans ce mois.");
  showPreview(services);
}

function showPreview(services) {
  pendingImport = services;
  const list = $('importPreviewList'); list.innerHTML = '';
  $('importSummary').textContent = `🤖 J'ai trouvé la ligne avec ${services.length} services.`;
  services.forEach(s => {
    const div = document.createElement('div');
    div.style.cssText = "padding:8px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; font-size:13px;";
    div.innerHTML = `<span><b>${s.dayName}</b> ${s.dateObj.getDate()}/${s.dateObj.getMonth()+1}</span> <b style="color:var(--accent)">${s.code}</b>`;
    list.appendChild(div);
  });
  $('backdropImport').classList.add('show');
  $('sheetImport').classList.add('show');
  $('btnConfirmImport').onclick = confirmImport;
  $('btnCancelImport').onclick = () => { $('sheetImport').classList.remove('show'); $('backdropImport').classList.remove('show'); };
}

function confirmImport() {
  if(!user) return;
  let count = 0;
  pendingImport.forEach(item => {
    entries.set(item.dateKey, { status: item.status, note: item.note, custom_label: item.code, imported: true });
    const cell = cellCache.get(item.dateKey);
    if(cell) { cell.className = `day ${cell.classList.contains('out')?'out':''} ${item.status}`; cell.style.border='2px dashed var(--accent)'; }
    count++;
  });
  renderGrid(); updateUI();
  
  (async () => {
    for(const item of pendingImport) {
      await supabase.from("work_calendar_entries").upsert({
        user_id: user.id, work_date: item.dateKey, status: item.status, note: item.note, custom_label: item.code, imported: true
      }, { onConflict: "user_id,work_date" });
    }
    alert(`✅ ${count} services importés !`);
    $('sheetImport').classList.remove('show'); $('backdropImport').classList.remove('show');
  })();
}

// --- EVENTS ---
function setupEvents() {
  $('btnPrevMonth').onclick = () => { state.month--; if(state.month<0){state.month=11;state.year--;} localStorage.setItem('state', JSON.stringify(state)); loadEntries().then(()=>{renderGrid();updateUI();}); };
  $('btnNextMonth').onclick = () => { state.month++; if(state.month>11){state.month=0;state.year++;} localStorage.setItem('state', JSON.stringify(state)); loadEntries().then(()=>{renderGrid();updateUI();}); };
  $('btnToday').onclick = () => { const n=new Date(); state.year=n.getFullYear(); state.month=n.getMonth(); state.selected=keyFor(n); localStorage.setItem('state', JSON.stringify(state)); loadEntries().then(()=>{renderGrid();updateUI();}); };
  
  document.querySelectorAll('[data-set]').forEach(btn => {
    btn.onclick = () => { if(!state.selected) return; saveEntry(state.selected, { status: btn.dataset.set, note:'' }); };
  });
  
  $('btnSaveNote').onclick = () => { saveEntry(state.selected, { note: $('noteText').value }); $('sheet').classList.remove('show'); $('backdrop').classList.remove('show'); };
  $('btnClearNote').onclick = () => { saveEntry(state.selected, { note: '' }); $('sheet').classList.remove('show'); $('backdrop').classList.remove('show'); };
  cellCache.get(state.selected)?.click(); // Open note modal on load fix
  
  $('btnImport').onclick = triggerImport;
  $('fileInput').onchange = handleFile;
  
  $('btnSettings').onclick = (e) => { e.stopPropagation(); $('settingsPop').classList.toggle('show'); };
  document.onclick = () => $('settingsPop').classList.remove('show');
  $('settingsPop').onclick = e => e.stopPropagation();
  
  $('themeLight').onclick = () => { prefs.theme='light'; localStorage.setItem('prefs', JSON.stringify(prefs)); applyPrefs(); };
  $('themeDark').onclick = () => { prefs.theme='dark'; localStorage.setItem('prefs', JSON.stringify(prefs)); applyPrefs(); };
  $('rateDay').onchange = e => { prefs.rateDay=parseFloat(e.target.value); localStorage.setItem('prefs', JSON.stringify(prefs)); updateUI(); };
  $('rateNightFull').onchange = e => { prefs.rateNightFull=parseFloat(e.target.value); localStorage.setItem('prefs', JSON.stringify(prefs)); updateUI(); };
  
  $('btnLogout').onclick = async () => { await supabase.auth.signOut(); checkAuth(); };
  
  $('btnLogin').onclick = async () => {
    const { error } = await supabase.auth.signInWithPassword({ email: $('loginEmail').value, password: $('loginPass').value });
    if(error) $('loginHint').textContent = error.message; else checkAuth();
  };
  
  $('btnExportXLSX').onclick = () => { 
    $('exportStart').value = keyFor(new Date(state.year, state.month, 1));
    $('exportEnd').value = keyFor(new Date(state.year, state.month+1, 0));
    $('backdropExport').classList.add('show'); $('sheetExport').classList.add('show');
  };
  $('btnCloseExport').onclick = () => { $('sheetExport').classList.remove('show'); $('backdropExport').classList.remove('show'); };
  $('btnGenerateXLSX').onclick = () => {
    // Simple export logic
    alert("Fonction export prête (à implémenter selon besoin)");
    $('sheetExport').classList.remove('show'); $('backdropExport').classList.remove('show');
  };
}

init();
