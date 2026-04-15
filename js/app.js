import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.0/+esm";

const SUPABASE_URL  = "https://dstmyvzjirgyuwuojwnk.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRzdG15dnpqaXJneXV3dW9qd25rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk3NzY4NTUsImV4cCI6MjA4NTM1Mjg1NX0.Cl6WAvK0elHkKXnXRtrFFiBlGABnK5RTFdawq3NGDJk";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

let user = null;
let entries  = new Map();
let cellCache = new Map();
let pendingImport = [];
let pwaInstallPrompt = null;

let state = { year: new Date().getFullYear(), month: new Date().getMonth(), selected: null };
let prefs = { theme: 'dark', agentName: '', agentMatricule:'', rateDay: 35.0, rateNightFull: 82.0, rateNightSolo: 41.0, rateMN: 15.0 };

const MONTHS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const WEEK_DAYS_SHORT = ["Di/Lu", "Lu/Ma", "Ma/Me", "Me/Je", "Je/Ve", "Ve/Sa", "Sa/Di"];
const BASE_SALARY = 2093.06;

const STATUS_LABELS = { jour: "Jour", nuit: "Nuit", mn: "MN", repos: "Repos", conges: "Congés", autre: "Autre" };
const STATUS_EMOJI = { jour: "☀️", nuit: "🌙", mn: "🌅", repos: "🏠", conges: "🏖️", autre: "⚙️" };

const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');
const keyFor = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parseKey = k => { const [y,m,d] = k.split('-').map(Number); return new Date(y, m-1, d); };
const normalize = txt => txt ? String(txt).toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim() : "";
const clean = txt => normalize(txt).replace(/[^A-Z0-9]/g, "");

function showToast(msg, duration = 2500) {
  const t = $('toast'); if (!t) return;
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}

function calculateSalary() {
  let bonus = 0;
  const end = new Date(state.year, state.month + 1, 0);
  for (let d = 1; d <= end.getDate(); d++) {
    const e = entries.get(keyFor(new Date(state.year, state.month, d)));
    if (!e) continue;
    if (e.status === 'jour') bonus += parseFloat(prefs.rateDay) || 0;
    if (e.status === 'nuit') bonus += parseFloat(prefs.rateNightFull) || 0;
    if (e.status === 'mn') bonus += parseFloat(prefs.rateMN) || 0;
  }
  return BASE_SALARY + bonus;
}

async function init() {
  loadLocal(); applyPrefs();
  if (!state.selected) state.selected = keyFor(new Date());
  setupPWA();
  await checkAuth();
  renderGrid(); updateUI(); setupEvents();
}

function loadLocal() {
  try {
    const p = localStorage.getItem('ms_prefs'); if (p) prefs = { ...prefs, ...JSON.parse(p) };
    const s = localStorage.getItem('ms_state'); if (s) state = { ...state, ...JSON.parse(s) };
  } catch(e) { console.warn(e); }
}
function savePrefs() { localStorage.setItem('ms_prefs', JSON.stringify(prefs)); }
function applyPrefs() {
  document.documentElement.setAttribute('data-theme', prefs.theme);
  $('themeLight')?.classList.toggle('active', prefs.theme === 'light');
  $('themeDark')?.classList.toggle('active', prefs.theme === 'dark');
  if ($('agentName')) $('agentName').value = prefs.agentName;
  if ($('rateDay')) $('rateDay').value = prefs.rateDay;
  if ($('rateNightFull')) $('rateNightFull').value = prefs.rateNightFull;
  if ($('rateNightSolo')) $('rateNightSolo').value = prefs.rateNightSolo;
  if ($('rateMN')) $('rateMN').value = prefs.rateMN;
}

function setupPWA() {
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); pwaInstallPrompt = e; if($('pwaInstallRow')) $('pwaInstallRow').style.display = 'block'; });
  $('btnInstallPWA')?.addEventListener('click', async () => {
    if (!pwaInstallPrompt) return;
    pwaInstallPrompt.prompt();
    const { outcome } = await pwaInstallPrompt.userChoice;
    if (outcome === 'accepted') { if($('pwaInstallRow')) $('pwaInstallRow').style.display = 'none'; showToast("✅ Installée"); }
    pwaInstallPrompt = null;
  });
}

async function checkAuth() {
  const gate = $('gate'); if (!gate) return;
  try {
    const { data } = await supabase.auth.getSession();
    if (!data?.session) {
      user = null; if($('topSub')) $('topSub').textContent = "Invité";
      gate.style.display = 'grid'; setTimeout(() => gate.classList.add('show'), 10);
      return;
    }
    user = data.session.user;
    if($('topSub')) $('topSub').textContent = prefs.agentName || user.email.split('@')[0];
    gate.classList.remove('show');
    setTimeout(() => { if (!gate.classList.contains('show')) gate.style.display = 'none'; }, 300);
    await loadEntries();
  } catch (e) { user = null; gate.style.display = 'grid'; gate.classList.add('show'); }
}

async function loadEntries() {
  if (!user) return;
  const start = keyFor(new Date(state.year, state.month - 1, 1));
  const end = keyFor(new Date(state.year, state.month + 2, 0));
  const { data, error } = await supabase.from("work_calendar_entries").select("*").gte("work_date", start).lte("work_date", end);
  if (error) return;
  entries.clear();
  data?.forEach(r => entries.set(r.work_date, { status: r.status, note: r.note, custom_label: r.custom_label, imported: r.imported }));
}

function renderGrid() {
  const grid = $('grid'); if (!grid) return;
  grid.innerHTML = ''; cellCache.clear();
  $('navMonth').textContent = MONTHS[state.month];
  $('navYear').textContent = state.year;

  // Mise à jour des en-têtes L M M J...
  const headers = document.querySelectorAll('.calendar-head div:not(.sem-label)');
  headers.forEach((h, i) => { if(i<7) h.textContent = WEEK_DAYS_SHORT[i]; });

  const first = new Date(state.year, state.month, 1);
  let offset = (first.getDay() + 6) % 7;
  const start = new Date(first); start.setDate(1 - offset);

  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const k = keyFor(d);
    if (i % 7 === 0) {
      const wn = getISOWeek(d);
      const wnEl = document.createElement('div'); wnEl.className = 'weeknum'; wnEl.textContent = wn; grid.appendChild(wnEl);
    }
    const cell = document.createElement('div'); cell.className = 'day';
    if (d.getMonth() !== state.month) cell.classList.add('out');
    if (k === keyFor(new Date())) cell.classList.add('today');
    cell.dataset.key = k;
    const entry = entries.get(k);
    if (entry?.status) { cell.classList.add(entry.status); if(entry.imported) cell.classList.add('imported'); }
    
    const num = document.createElement('span'); num.className = 'day-num'; num.textContent = d.getDate(); cell.appendChild(num);
    if (entry?.status && entry.status !== 'repos') {
      const lbl = document.createElement('span'); lbl.className = 'day-label'; lbl.textContent = entry.custom_label || STATUS_LABELS[entry.status]; cell.appendChild(lbl);
    }
    if (entry?.note) { const dot = document.createElement('div'); dot.className = 'dot'; cell.appendChild(dot); }
    if (k === state.selected) cell.classList.add('selected');
    
    cell.onclick = () => {
      state.selected = k; localStorage.setItem('ms_state', JSON.stringify(state));
      cellCache.forEach((c, ck) => c.classList.toggle('selected', ck === k));
      updateDockInfo();
    };
    grid.appendChild(cell); cellCache.set(k, cell);
  }
  updateUI();
}

function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - start) / 86400000) + 1) / 7);
}

function updateUI() { updateDockInfo(); updateStats(); }

function updateDockInfo() {
  if (!state.selected) return;
  const d = parseKey(state.selected);
  const entry = entries.get(state.selected);
  const dayIdx = (d.getDay() + 6) % 7;
  $('selDate').textContent = `${WEEK_DAYS_SHORT[dayIdx]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  const badge = $('selState');
  badge.textContent = entry?.status ? `${STATUS_EMOJI[entry.status]} ${STATUS_LABELS[entry.status]}` : "Libre";
  badge.className = `sel-badge ${entry?.status || ''}`;
}

function updateStats() {
  let j=0, n=0, r=0, m=0;
  const end = new Date(state.year, state.month + 1, 0);
  for (let i = 1; i <= end.getDate(); i++) {
    const e = entries.get(keyFor(new Date(state.year, state.month, i)));
    if (!e) continue;
    if (e.status==='jour') j++; if (e.status==='nuit') n++; if (e.status==='repos') r++; if (e.status==='mn') m++;
  }
  $('statJour').textContent = j; $('statNuit').textContent = n; $('statRepos').textContent = r;
  $('salaryValue').textContent = calculateSalary().toLocaleString('fr-FR', {minimumFractionDigits:2}) + ' €';
}

function openStats() {
  const end = new Date(state.year, state.month + 1, 0);
  const counts = {jour:0,nuit:0,mn:0,repos:0,conges:0,autre:0};
  for (let i=1; i<=end.getDate(); i++) { const e=entries.get(keyFor(new Date(state.year,state.month,i))); if(e&&counts[e.status]!==undefined) counts[e.status]++; }
  $('statsMonthLabel').textContent = `${MONTHS[state.month]} ${state.year}`;
  const total = counts.jour+counts.nuit+counts.mn;
  $('statsContent').innerHTML = `
    <div class="stats-grid">${Object.entries(counts).map(([k,v])=>`<div class="stats-row ${k}"><span>${STATUS_EMOJI[k]}</span><span>${STATUS_LABELS[k]}</span><span>${v}</span><div class="stats-bar-mini"><div class="stats-bar-fill ${k}" style="width:${(v/end.getDate()*100).toFixed(0)}%"></div></div></div>`).join('')}</div>
    <div class="stats-summary"><div class="summary-row"><span>Total</span><strong>${total}</strong></div><div class="summary-row highlight"><span>Brut Est.</span><strong>${calculateSalary().toLocaleString('fr-FR',{minimumFractionDigits:2})} €</strong></div></div>`;
  $('backdropStats').classList.add('show'); $('sheetStats').classList.add('show');
}

async function saveEntry(k, patch) {
  if (!user) { const g=$('gate'); if(g){g.style.display='grid';g.classList.add('show');} return; }
  const cur = entries.get(k) || {status:'',note:'',custom_label:'',imported:false};
  const next = {...cur, ...patch};
  if (patch.status===null) entries.delete(k); else entries.set(k, next);
  
  const cell = cellCache.get(k);
  if (cell) {
    cell.className = ['day', cell.classList.contains('out')?'out':'', cell.classList.contains('selected')?'selected':'', cell.classList.contains('today')?'today':'', next.status||'', next.imported?'imported':''].join(' ');
    cell.innerHTML = `<span class="day-num">${parseKey(k).getDate()}</span>`;
    if (next.status && next.status!=='repos') cell.innerHTML += `<span class="day-label">${next.custom_label||STATUS_LABELS[next.status]}</span>`;
    if (next.note) cell.innerHTML += `<div class="dot"></div>`;
  }
  updateUI();
  showToast(patch.status===null?"Effacé":"Sauvegardé");
  
  try {
    if (patch.status===null) await supabase.from("work_calendar_entries").delete().eq('user_id',user.id).eq('work_date',k);
    else {
      const p = {user_id:user.id, work_date:k, status:next.status, note:next.note, custom_label:next.custom_label};
      if(next.imported) p.imported=true;
      let {error} = await supabase.from("work_calendar_entries").upsert(p,{onConflict:"user_id,work_date"});
      if(error && error.message.includes('imported')) { delete p.imported; await supabase.from("work_calendar_entries").upsert(p,{onConflict:"user_id,work_date"}); }
    }
  } catch(e) { console.error(e); }
}

// --- IMPORT ---
function triggerImport() { if(!user){showToast("Connectez-vous");return;} $('fileInput').click(); }
function handleFile(e) {
  const file = e.target.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = evt => {
    try {
      const wb = XLSX.read(new Uint8Array(evt.target.result), {type:'array'});
      let best=null, score=-1;
      wb.SheetNames.forEach(n => { const r=XLSX.utils.sheet_to_json(wb.Sheets[n],{header:1}); const s=r.reduce((a,b)=>a+b.filter(c=>String(c).trim()).length,0); if(s>score){score=s;best=r;} });
      importAnalyze(best);
    } catch(err) { showToast("Erreur Excel"); }
  };
  reader.readAsArrayBuffer(file);
}
function importAnalyze(rows) {
  const dateRows = findDateRows(rows);
  if(!dateRows.length) {showToast("Pas de dates");return;}
  const agents = detectAgents(rows, dateRows);
  if(!agents.length) {showToast("Pas d'agent");return;}
  let target = prefs.agentName ? agents.find(a=>normalize(a.name).includes(normalize(prefs.agentName))) : null;
  if(target) showImportPreview(buildServicesForAgent(target, dateRows, rows), agents, target.name);
  else showImportPreview([], agents, null);
}
function findDateRows(rows) {
  const res = [];
  rows.forEach((row, idx) => {
    const map={}, cnt=0;
    row.forEach((c, i) => {
      const v=String(c).trim();
      const m=v.match(/^(\d{1,2})[\/\-\.](\d{1,2})/);
      if(m) { map[i]=new Date(state.year, parseInt(m[2])-1, parseInt(m[1])); cnt++; }
      else if(/^\d{1,2}$/.test(v) && v<=31) { map[i]={dayOnly:parseInt(v)}; cnt++; }
    });
    if(cnt>=5) res.push({rowIdx:idx, dateMap:map});
  });
  return res;
}
function detectAgents(rows, dRows) {
  const idxs = new Set(dRows.map(d=>d.rowIdx));
  const ags = [];
  rows.forEach((r,i) => {
    if(idxs.has(i)) return;
    r.forEach(c => {
      const v=String(c).trim();
      if(v.length>3 && /^[A-Za-zÀ-ÿ\s\-]+$/.test(v)) {
        const w=v.split(/\s+/).filter(x=>x.length>1);
        if(w.length>=2 && !ags.find(a=>normalize(a.name)===normalize(v))) ags.push({name:v, rowIdx:i});
      }
    });
  });
  return ags;
}
function buildServicesForAgent(ag, dRows, rows) {
  const dR = dRows.filter(d=>d.rowIdx<=ag.rowIdx).sort((a,b)=>b.rowIdx-a.rowIdx)[0];
  if(!dR) return [];
  const m = resolveMonth(rows, dR.rowIdx);
  const cmap = {};
  Object.entries(dR.dateMap).forEach(([i,v]) => { cmap[parseInt(i)] = (v instanceof Date)?v:new Date(state.year,m,v.dayOnly); });
  const svcs=[], used=new Set();
  for(let k=0;k<=3;k++) {
    const row = rows[ag.rowIdx+k]; if(!row) continue;
    row.forEach((c, i) => {
      const raw=String(c).trim(); if(!raw) return;
      let d=cmap[i]; if(!d) for(let j=i;j>=0;j--) if(cmap[j]){d=cmap[j];break;}
      if(!d) return;
      const key=keyFor(d); if(used.has(key)) return;
      const st = interpretCode(raw); if(!st) return;
      used.add(key);
      svcs.push({dateKey:key, dateObj:d, code:raw, status:st, note:`Import:${raw}`});
    });
  }
  return svcs.sort((a,b)=>a.dateKey.localeCompare(b.dateKey));
}
function resolveMonth(rows, idx) {
  const ms=["JANVIER","FEVRIER","MARS","AVRIL","MAI","JUIN","JUILLET","AOUT","SEPTEMBRE","OCTOBRE","NOVEMBRE","DECEMBRE"];
  for(let i=idx-10; i<=idx+5; i++) {
    if(i<0||i>=rows.length) continue;
    const t=normalize(rows[i].join(' '));
    for(let j=0;j<12;j++) if(t.includes(ms[j])) return j;
  }
  return state.month;
}
function interpretCode(r) {
  const v=clean(r), u=normalize(r);
  if(u.includes("NUIT")) return "nuit"; if(u.includes("JOUR")) return "jour";
  if(u.includes("REPOS")||u.includes("OFF")) return "repos";
  if(u.includes("CONG")||u==="CP") return "conges";
  if(u.includes("MN")) return "mn";
  if(v==="N") return "nuit"; if(v==="J") return "jour"; if(v==="R") return "repos";
  if(/^[NJR]/.test(v)) return v.startsWith('N')?"nuit":v.startsWith('J')?"jour":"repos";
  if(/[A-Z]/.test(v)&&/[0-9]/.test(v)) return "autre";
  return null;
}
function similarity(a,b) { const sA=new Set(a),sB=new Set(b); const i=[...sA].filter(c=>sB.has(c)).length; const u=new Set([...sA,...sB]).size; return u?i/u:0; }
function showImportPreview(svcs, ags, sel) {
  pendingImport=svcs;
  const p=$('agentPicker'), s=$('agentPickerSection');
  if(p&&s) {
    p.innerHTML=ags.map(a=>`<option value="${a.name}"${sel===a.name?' selected':''}>${a.name}</option>`).join('');
    s.style.display='block';
    p.onchange=()=>{ const ag=ags.find(x=>x.name===p.value); if(ag&&window._importRows){pendingImport=buildServicesForAgent(ag,window._importDateRows,window._importRows);renderPreviewList(pendingImport);updateImportSummary(pendingImport);} };
  }
  renderPreviewList(svcs); updateImportSummary(svcs);
  $('backdropImport').classList.add('show'); $('sheetImport').classList.add('show');
}
function renderPreviewList(svcs) {
  const l=$('importPreviewList'); if(!l) return;
  if(!svcs.length) {l.innerHTML='<div class="preview-empty">Choisissez un agent</div>';return;}
  l.innerHTML=svcs.map(s=>`<div class="preview-row ${s.status}"><div>${s.dateObj.getDate()}/${s.dateObj.getMonth()+1}</div><div>${s.code}</div><div>${STATUS_LABELS[s.status]}</div></div>`).join('');
}
function updateImportSummary(svcs) {
  const j=svcs.filter(s=>s.status==='jour').length, n=svcs.filter(s=>s.status==='nuit').length;
  $('importSummary').textContent=`${svcs.length} svc — ☀️${j} 🌙${n}`;
}
function confirmImport() {
  if(!user||!pendingImport.length) return;
  pendingImport.forEach(it=>entries.set(it.dateKey,{status:it.status,note:it.note,custom_label:it.code,imported:true}));
  $('sheetImport').classList.remove('show'); $('backdropImport').classList.remove('show');
  renderGrid(); updateUI(); showToast("Importé !");
  (async()=>{ for(const it of pendingImport){const p={user_id:user.id,work_date:it.dateKey,status:it.status,note:it.note,custom_label:it.code,imported:true}; let{error}=await supabase.from("work_calendar_entries").upsert(p,{onConflict:"user_id,work_date"}); if(error&&error.message.includes('imported')){delete p.imported;await supabase.from("work_calendar_entries").upsert(p,{onConflict:"user_id,work_date"});} }})();
}

// --- EVENTS ---
function openNoteModal() {
  const e=entries.get(state.selected), d=parseKey(state.selected);
  $('sheetTitle').textContent=`Note ${d.getDate()}`; $('noteText').value=e?.note||'';
  $('sheetNote').style.display='block'; $('sheetOther').style.display='none';
  $('backdrop').classList.add('show'); $('sheet').classList.add('show');
}
function openOtherModal() {
  $('sheetNote').style.display='none'; $('sheetOther').style.display='block';
  $('backdrop').classList.add('show'); $('sheet').classList.add('show');
}
function closeModal(b,s) { $(b)?.classList.remove('show'); $(s)?.classList.remove('show'); }

function setupEvents() {
  $('btnPrevMonth')?.addEventListener('click',()=>changeMonth(-1));
  $('btnNextMonth')?.addEventListener('click',()=>changeMonth(1));
  $('btnToday')?.addEventListener('click',()=>{const n=new Date();state.year=n.getFullYear();state.month=n.getMonth();state.selected=keyFor(n);localStorage.setItem('ms_state',JSON.stringify(state));loadEntries().then(()=>{renderGrid();updateUI();});});
  $('btnStats')?.addEventListener('click',openStats);
  $('btnCloseStats')?.addEventListener('click',()=>closeModal('backdropStats','sheetStats'));
  
  document.querySelectorAll('[data-set]').forEach(b=>{
    b.addEventListener('click',()=>{
      if(!state.selected) return;
      const a=b.dataset.set;
      if(a==='note') {openNoteModal();return;}
      if(a==='autre') {openOtherModal();return;}
      if(a==='reset') {saveEntry(state.selected,{status:null});return;}
      saveEntry(state.selected,{status:a,note:entries.get(state.selected)?.note||''});
    });
  });
  
  $('btnSaveNote')?.addEventListener('click',()=>{saveEntry(state.selected,{status:entries.get(state.selected)?.status||'autre',note:$('noteText').value});closeModal('backdrop','sheet');});
  $('btnClearNote')?.addEventListener('click',()=>{saveEntry(state.selected,{status:entries.get(state.selected)?.status||'autre',note:''});closeModal('backdrop','sheet');});
  $('backdrop')?.addEventListener('click',()=>closeModal('backdrop','sheet'));
  
  $('btnApplyOther')?.addEventListener('click',()=>{const v=$('otherSelect').value; saveEntry(state.selected,{status:'autre',custom_label:v});closeModal('backdrop','sheet');});
  $('btnCloseOther')?.addEventListener('click',()=>closeModal('backdrop','sheet'));
  
  $('btnImport')?.addEventListener('click',triggerImport);
  $('fileInput')?.addEventListener('change',e=>{handleFile(e);if(e.target.files[0]){const r=new FileReader();r.onload=ev=>{const wb=XLSX.read(new Uint8Array(ev.target.result),{type:'array'});let best=null,sc=-1;wb.SheetNames.forEach(n=>{const row=XLSX.utils.sheet_to_json(wb.Sheets[n],{header:1});const s=row.reduce((a,b)=>a+b.filter(c=>String(c).trim()).length,0);if(s>sc){sc=s;best=row;}});window._importRows=best;window._importDateRows=findDateRows(best);};r.readAsArrayBuffer(e.target.files[0]);}});
  $('btnConfirmImport')?.addEventListener('click',confirmImport);
  $('btnCancelImport')?.addEventListener('click',()=>closeModal('backdropImport','sheetImport'));
  
  $('btnSettings')?.addEventListener('click',e=>{e.stopPropagation();$('settingsPop')?.classList.toggle('show');});
  $('btnCloseSettings')?.addEventListener('click',()=>$('settingsPop')?.classList.remove('show'));
  document.addEventListener('click',()=>$('settingsPop')?.classList.remove('show'));
  
  $('themeLight')?.addEventListener('click',()=>{prefs.theme='light';savePrefs();applyPrefs();});
  $('themeDark')?.addEventListener('click',()=>{prefs.theme='dark';savePrefs();applyPrefs();});
  $('agentName')?.addEventListener('change',e=>{prefs.agentName=e.target.value.trim();savePrefs();showToast("Nom enregistré");});
  ['rateDay','rateNightFull','rateNightSolo','rateMN'].forEach(id=>{$(id)?.addEventListener('change',e=>{prefs[id]=parseFloat(e.target.value)||0;savePrefs();updateUI();});});
  
  $('btnLogin')?.addEventListener('click',async()=>{const em=$('loginEmail').value,pw=$('loginPass').value;if(!em||!pw){$('loginHint').textContent="Champs requis";return;}const{error}=await supabase.auth.signInWithPassword({email:em,password:pw});if(error)$('loginHint').textContent=error.message;else checkAuth();});
  $('btnSignup')?.addEventListener('click',async()=>{const em=$('signupEmail').value,pw=$('signupPass').value;if(pw.length<6){$('signupHint').textContent="6 car. min";return;}const{error}=await supabase.auth.signUp({email:em,password:pw});if(error)$('signupHint').textContent=error.message;else $('signupHint').textContent="Vérifiez vos emails";});
  $('tabSignup')?.addEventListener('click',()=>{$('formLogin').style.display='none';$('formSignup').style.display='block';});
  $('tabLogin')?.addEventListener('click',()=>{$('formSignup').style.display='none';$('formLogin').style.display='block';});
  $('btnLogout')?.addEventListener('click',async()=>{await supabase.auth.signOut();user=null;entries.clear();checkAuth();renderGrid();});
}

function changeMonth(d) {
  state.month += d;
  if (state.month<0) {state.month=11;state.year--;}
  if (state.month>11) {state.month=0;state.year++;}
  localStorage.setItem('ms_state', JSON.stringify(state));
  loadEntries().then(()=>{renderGrid();updateUI();});
}

init();
