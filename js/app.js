import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL  = "https://dstmyvzjirgyuwuojwnk.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRzdG15dnpqaXJneXV3dW9qd25rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk3NzY4NTUsImV4cCI6MjA4NTM1Mjg1NX0.Cl6WAvK0elHkKXnXRtrFFiBlGABnK5RTFdawq3NGDJk";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

let user = null;
let entries = new Map();
let cellCache = new Map();
let pendingImport = [];
let pwaInstallPrompt = null;

let state = { year: new Date().getFullYear(), month: new Date().getMonth(), selected: null };
let prefs = { theme: 'dark', agentName: '', agentMatricule: '', rateDay: 35.0, rateNightFull: 82.0, rateNightSolo: 41.0, rateMN: 15.0 };

const MONTHS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const DAY_HEADERS = ["Di/Lu", "Lu/Ma", "Ma/Me", "Me/Je", "Je/Ve", "Ve/Sa", "Sa/Di"];
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
  const t = $('toast'); if(!t) return; t.textContent = msg; t.classList.add('show');
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
  } catch(e) {}
}
function savePrefs() { localStorage.setItem('ms_prefs', JSON.stringify(prefs)); }
function applyPrefs() {
  document.documentElement.setAttribute('data-theme', prefs.theme);
  $('themeLight')?.classList.toggle('active', prefs.theme === 'light');
  $('themeDark')?.classList.toggle('active', prefs.theme === 'dark');
  if ($('agentName')) $('agentName').value = prefs.agentName || '';
  if ($('agentMatricule')) $('agentMatricule').value = prefs.agentMatricule || '';
  if ($('rateDay')) $('rateDay').value = prefs.rateDay;
  if ($('rateNightFull')) $('rateNightFull').value = prefs.rateNightFull;
  if ($('rateNightSolo')) $('rateNightSolo').value = prefs.rateNightSolo;
  if ($('rateMN')) $('rateMN').value = prefs.rateMN;
}

function setupPWA() {
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); pwaInstallPrompt = e; if($('pwaInstallRow')) $('pwaInstallRow').style.display = 'block'; });
  $('btnInstallPWA')?.addEventListener('click', async () => {
    if (!pwaInstallPrompt) return; pwaInstallPrompt.prompt();
    const { outcome } = await pwaInstallPrompt.userChoice;
    if (outcome === 'accepted') { $('pwaInstallRow').style.display = 'none'; showToast("✅ Installée"); }
    pwaInstallPrompt = null;
  });
}

async function checkAuth() {
  const gate = $('gate'); if (!gate) return;
  try {
    const { data } = await supabase.auth.getSession();
    if (!data?.session) {
      user = null; if($('topSub')) $('topSub').textContent = "Invité";
      gate.style.display = 'grid'; setTimeout(() => gate.classList.add('show'), 50);
      return;
    }
    user = data.session.user;
    if($('topSub')) $('topSub').textContent = prefs.agentName || user.email.split('@')[0];
    gate.classList.remove('show'); setTimeout(() => { if(!gate.classList.contains('show')) gate.style.display = 'none'; }, 300);
    await loadEntries();
  } catch (e) { user = null; gate.style.display = 'grid'; setTimeout(() => gate.classList.add('show'), 50); }
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
  const grid = $('grid'), header = $('.calendar-head'); if (!grid || !header) return;
  grid.innerHTML = ''; cellCache.clear();
  $('navMonth') && ($('navMonth').textContent = MONTHS[state.month]);
  $('navYear') && ($('navYear').textContent = state.year);
  
  const hChildren = header.children;
  for (let i = 1; i < hChildren.length; i++) hChildren[i].textContent = DAY_HEADERS[i-1];

  const first = new Date(state.year, state.month, 1);
  let offset = (first.getDay() + 6) % 7;
  const start = new Date(first); start.setDate(1 - offset);

  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const k = keyFor(d);
    if (i % 7 === 0) {
      const wnEl = document.createElement('div'); wnEl.className = 'weeknum'; wnEl.textContent = getISOWeek(d); grid.appendChild(wnEl);
    }
    const cell = document.createElement('div'); cell.className = 'day';
    if (d.getMonth() !== state.month) cell.classList.add('out');
    if (k === keyFor(new Date())) cell.classList.add('today');
    cell.dataset.key = k;
    const entry = entries.get(k);
    if (entry?.status) { cell.classList.add(entry.status); if (entry.imported) cell.classList.add('imported'); }
    
    const num = document.createElement('span'); num.className = 'day-num'; num.textContent = d.getDate(); cell.appendChild(num);
    if (entry?.status && entry.status !== 'repos') {
      const lbl = document.createElement('span'); lbl.className = 'day-label'; lbl.textContent = entry.custom_label || STATUS_LABELS[entry.status]; cell.appendChild(lbl);
    }
    if (entry?.note) { const dot = document.createElement('div'); dot.className = 'dot'; cell.appendChild(dot); }
    if (k === state.selected) cell.classList.add('selected');
    
    cell.onclick = () => { state.selected = k; localStorage.setItem('ms_state', JSON.stringify(state)); cellCache.forEach((c, ck) => c.classList.toggle('selected', ck === k)); updateDockInfo(); };
    grid.appendChild(cell); cellCache.set(k, cell);
  }
  updateUI();
}

function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function updateUI() { updateDockInfo(); updateStats(); }
function updateDockInfo() {
  if (!state.selected) return;
  const d = parseKey(state.selected), entry = entries.get(state.selected);
  $('selDate') && ($('selDate').textContent = `${['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'][(d.getDay()+6)%7]} ${d.getDate()} ${MONTHS[d.getMonth()]}`);
  const badge = $('selState');
  if (badge) { const s = entry?.status; badge.textContent = s ? `${STATUS_EMOJI[s]} ${STATUS_LABELS[s]}` : "Libre"; badge.className = `sel-badge ${s||''}`; }
}
function updateStats() {
  let j=0,n=0,r=0,m=0,c=0; const end = new Date(state.year, state.month+1, 0);
  for (let d=1; d<=end.getDate(); d++) {
    const e = entries.get(keyFor(new Date(state.year, state.month, d))); if(!e) continue;
    if(e.status==='jour') j++; if(e.status==='nuit') n++; if(e.status==='repos') r++; if(e.status==='mn') m++; if(e.status==='conges') c++;
  }
  $('statJour') && ($('statJour').textContent=j); $('statNuit') && ($('statNuit').textContent=n); $('statRepos') && ($('statRepos').textContent=r);
  $('salaryValue') && ($('salaryValue').textContent = calculateSalary().toLocaleString('fr-FR', {minimumFractionDigits:2}) + ' €');
}

function openStats() {
  const end = new Date(state.year, state.month+1, 0);
  const counts = {jour:0,nuit:0,mn:0,repos:0,conges:0,autre:0};
  for(let d=1; d<=end.getDate(); d++) { const e=entries.get(keyFor(new Date(state.year,state.month,d))); if(e?.status && counts[e.status]!==undefined) counts[e.status]++; }
  $('statsMonthLabel') && ($('statsMonthLabel').textContent = `${MONTHS[state.month]} ${state.year}`);
  const content = $('statsContent'); if(!content) return;
  const total = counts.jour+counts.nuit+counts.mn, sal = calculateSalary();
  content.innerHTML = `<div class="stats-grid">${Object.entries(counts).map(([k,v])=>`<div class="stats-row ${k}"><span class="stats-emoji">${STATUS_EMOJI[k]||'📌'}</span><span class="stats-name">${STATUS_LABELS[k]||k}</span><span class="stats-count">${v}</span><div class="stats-bar-mini"><div class="stats-bar-fill ${k}" style="width:${end.getDate()?(v/end.getDate()*100).toFixed(0):0}%"></div></div></div>`).join('')}</div><div class="stats-summary"><div class="summary-row"><span>Total services</span><strong>${total}</strong></div><div class="summary-row highlight"><span>Est. Brut</span><strong>${sal.toLocaleString('fr-FR',{minimumFractionDigits:2})} €</strong></div></div>`;
  $('backdropStats')?.classList.add('show'); $('sheetStats')?.classList.add('show');
}

async function exportCalendar() {
  if (!user) { showToast("Connectez-vous"); return; }
  showToast("🔄 Génération...");
  const end = new Date(state.year, state.month+1, 0);
  const data = [["MyShift Export", "", "", "", ""], ["Agent", prefs.agentName||user.email, "", "Mois", `${MONTHS[state.month]} ${state.year}`], ["", "", "", "", ""], ["Date", "Jour", "Statut", "Code", "Note", "Prime"]];
  let bonus = 0;
  for (let d=1; d<=end.getDate(); d++) {
    const obj = new Date(state.year, state.month, d), k = keyFor(obj), e = entries.get(k);
    if (e && e.status && e.status !== 'repos') {
      let rate = 0; if(e.status==='jour') rate=prefs.rateDay; if(e.status==='nuit') rate=prefs.rateNightFull; if(e.status==='mn') rate=prefs.rateMN;
      bonus += rate;
      data.push([`${pad(d)}/${pad(state.month+1)}/${state.year}`, obj.toLocaleDateString('fr-FR',{weekday:'long'}), STATUS_LABELS[e.status], e.custom_label||'', e.note||'', rate>0?rate+'€':'-']);
    }
  }
  data.push(["", "", "", "", ""], ["TOTAL BASE", BASE_SALARY+"€"], ["TOTAL PRIMES", bonus+"€"], ["TOTAL GÉNÉRAL", (BASE_SALARY+bonus)+"€"]);
  const ws = XLSX.utils.aoa_to_sheet(data), wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Planning");
  XLSX.writeFile(wb, `MyShift_${MONTHS[state.month]}_${state.year}.xlsx`);
  showToast("✅ Téléchargé");
}
async function saveEntry(k, patch) {
  if (!user) { const g=$('gate'); if(g){g.style.display='grid';setTimeout(()=>g.classList.add('show'),50);} return; }
  const cur = entries.get(k) || {status:'',note:'',custom_label:'',imported:false}, next = {...cur, ...patch};
  if (patch.status === null) entries.delete(k); else entries.set(k, next);
  const cell = cellCache.get(k);
  if (cell) {
    const isOut=cell.classList.contains('out'), isSel=cell.classList.contains('selected'), isToday=cell.classList.contains('today');
    cell.className = ['day', isOut?'out':'', isSel?'selected':'', isToday?'today':'', next.status||'', next.imported?'imported':''].filter(Boolean).join(' ');
    cell.innerHTML = '';
    const num = document.createElement('span'); num.className='day-num'; num.textContent=parseKey(k).getDate(); cell.appendChild(num);
    if (next.status && next.status!=='repos' && patch.status!==null) { const l=document.createElement('span'); l.className='day-label'; l.textContent=next.custom_label||STATUS_LABELS[next.status]; cell.appendChild(l); }
    if (next.note && patch.status!==null) { const dot=document.createElement('div'); dot.className='dot'; cell.appendChild(dot); }
  }
  updateUI(); showToast(patch.status===null?"🗑️ Effacé":"✅ Enregistré");
  try {
    if (patch.status===null) await supabase.from("work_calendar_entries").delete().eq('user_id',user.id).eq('work_date',k);
    else {
      const p = {user_id:user.id, work_date:k, status:next.status, note:next.note, custom_label:next.custom_label};
      if(next.imported) p.imported=true;
      let {error} = await supabase.from("work_calendar_entries").upsert(p, {onConflict:"user_id,work_date"});
      if(error && error.message.includes('imported')) { delete p.imported; await supabase.from("work_calendar_entries").upsert(p, {onConflict:"user_id,work_date"}); }
    }
  } catch(e) { showToast("⚠️ Erreur sync"); await loadEntries(); renderGrid(); }
}

// IMPORT
function triggerImport() { if(!user){showToast("Connectez-vous");const g=$('gate');if(g){g.style.display='grid';setTimeout(()=>g.classList.add('show'),50);}return;} $('fileInput').click(); }
function handleFile(e) {
  const file = e.target.files[0]; if(!file) return; $('fileInput').value='';
  const reader = new FileReader();
  reader.onload = evt => {
    try {
      const wb = XLSX.read(new Uint8Array(evt.target.result), {type:'array',cellText:true});
      if(!wb.SheetNames.length) throw new Error("Vide");
      let best=null, score=-1;
      wb.SheetNames.forEach(n => { const r=XLSX.utils.sheet_to_json(wb.Sheets[n],{header:1}); const s=r.reduce((a,b)=>a+b.filter(c=>String(c).trim()).length,0); if(s>score){score=s;best=r;} });
      importAnalyze(best);
    } catch(err) { showToast("❌ Erreur Excel"); }
  };
  reader.readAsArrayBuffer(file);
}
function importAnalyze(rows) {
  const dateRows = findDateRows(rows); if(!dateRows.length){showToast("❌ Pas de dates");return;}
  const agents = detectAgents(rows, dateRows); if(!agents.length){showToast("❌ Pas d'agent");return;}
  let target = null;
  if(prefs.agentName) { const s=normalize(prefs.agentName); target=agents.find(a=>normalize(a.name).includes(s)); }
  showImportPreview(target?buildServicesForAgent(target,dateRows,rows):[], agents, target?target.name:null);
}
function findDateRows(rows) {
  const res=[]; rows.forEach((row, idx) => {
    const map={}, cnt=0;
    row.forEach((cell, c) => {
      const v=String(cell).trim(), m=v.match(/^(\d{1,2})[\/\-\.](\d{1,2})(?:[\/\-\.](\d{2,4}))?$/);
      if(m) { const d=parseInt(m[1]), mo=parseInt(m[2])-1, y=m[3]?(m[3].length==2?2000+parseInt(m[3]):parseInt(m[3])):state.year; if(d>=1&&d<=31&&mo>=0&&mo<=11){map[c]=new Date(y,mo,d);cnt++;} }
      else if(/^\d{1,2}$/.test(v)) { const n=parseInt(v); if(n>=1&&n<=31){map[c]={dayOnly:n};cnt++;} }
    });
    if(cnt>=5) res.push({rowIdx:idx, dateMap:map, count:cnt});
  }); return res;
}
function detectAgents(rows, dateRows) {
  const agents=[], dIdx=new Set(dateRows.map(d=>d.rowIdx));
  rows.forEach((row, idx) => { if(dIdx.has(idx))return; row.forEach(cell => { const v=String(cell).trim(); if(v.length<4)return; const w=v.split(/\s+/).filter(x=>/^[A-Za-zÀ-ÿ\-]{2,}$/.test(x)); if(w.length>=2&&w.length<=4&&!agents.find(a=>normalize(a.name)===normalize(v))) agents.push({name:v,rowIdx:idx,isUpper:v===v.toUpperCase()}); }); });
  return agents.sort((a,b)=>(b.isUpper?1:0)-(a.isUpper?1:0));
}
function buildServicesForAgent(agent, dateRows, rows) {
  const rel = dateRows.filter(d=>d.rowIdx<=agent.rowIdx).sort((a,b)=>b.rowIdx-a.rowIdx)[0]; if(!rel) return [];
  const month = resolveMonth(rows, rel.rowIdx);
  const cmap = {}; Object.entries(rel.dateMap).forEach(([c,v])=>{cmap[parseInt(c)]=(v instanceof Date)?v:new Date(state.year,month,v.dayOnly);});
  const svcs=[], used=new Set();
  for(let i=0;i<=3;i++) { const r=rows[agent.rowIdx+i]; if(!r)continue; r.forEach((cell,c) => { const raw=String(cell).trim(); if(!raw)return; let d=cmap[c]; if(!d) for(let k=c;k>=0;k--) if(cmap[k]){d=cmap[k];break;} if(!d)return; const k=keyFor(d); if(used.has(k))return; const st=interpretCode(raw); if(!st)return; used.add(k); svcs.push({dateKey:k,dateObj:d,dayName:d.toLocaleDateString('fr-FR',{weekday:'long'}),code:raw.toUpperCase(),status:st,note:`Import:${raw}`}); }); }
  applyMNRules(svcs); return svcs.sort((a,b)=>a.dateKey.localeCompare(b.dateKey));
}
function resolveMonth(rows, idx) { const ms=["JANVIER","FEVRIER","MARS","AVRIL","MAI","JUIN","JUILLET","AOUT","SEPTEMBRE","OCTOBRE","NOVEMBRE","DECEMBRE"]; for(let i=Math.max(0,idx-10);i<=Math.min(rows.length-1,idx+5);i++) { const t=normalize(rows[i].join(" ")); for(let j=0;j<12;j++) if(t.includes(ms[j])) return j; } return state.month; }
function interpretCode(raw) { const v=clean(raw), u=normalize(raw); if(!v)return null; if(u.includes("NUIT"))return "nuit"; if(u.includes("JOUR"))return "jour"; if(u.includes("REPOS")||u.includes("OFF"))return "repos"; if(u.includes("CONG")||u==="CP")return "conges"; if(u.includes("MN"))return "mn"; if(v==="N")return "nuit"; if(v==="J")return "jour"; if(v==="R")return "repos"; if(/^[NJR]\d+$/.test(v)) return v.startsWith('N')?"nuit":v.startsWith('J')?"jour":"repos"; if(/^[NJR]/.test(v)&&v.length<=6) return v.startsWith('N')?"nuit":v.startsWith('J')?"jour":"repos"; if(/[A-Z]/.test(v)&&/[0-9]/.test(v)) return "autre"; return null; }
function applyMNRules(svcs) { svcs.filter(s=>s.status==="nuit").forEach(s => { const d=parseKey(s.dateKey); if(d.getDay()===1)return; if(!svcs.find(x=>x.dateKey===s.dateKey&&x.status==="mn")) svcs.push({dateKey:s.dateKey,dateObj:d,dayName:"Lun",code:"AUTO",status:"mn",note:"MN Auto"}); }); }
function similarity(a,b) { const sA=new Set(a.split('')),sB=new Set(b.split('')),i=[...sA].filter(c=>sB.has(c)).length,u=new Set([...sA,...sB]).size; return u?i/u:0; }

function showImportPreview(svcs, agents, sel) {
  pendingImport = svcs; const pick=$('agentPicker'), sec=$('agentPickerSection');
  if(pick&&sec) { pick.innerHTML=agents.map(a=>`<option value="${a.name}" ${sel===a.name?'selected':''}>${a.name}</option>`).join(''); sec.style.display='block'; pick.onchange=()=>{const ag=agents.find(x=>x.name===pick.value); if(ag&&window._importRows){pendingImport=buildServicesForAgent(ag,window._importDateRows,window._importRows);renderPreviewList(pendingImport);updateImportSummary(pendingImport);}}; }
  renderPreviewList(svcs); updateImportSummary(svcs);
  $('backdropImport')?.classList.add('show'); $('sheetImport')?.classList.add('show');
}
function renderPreviewList(svcs) { const l=$('importPreviewList'); if(!l)return; if(!svcs.length){l.innerHTML='<div class="preview-empty">Sélectionnez un agent</div>';return;} l.innerHTML=svcs.map(s=>`<div class="preview-row ${s.status}"><div class="preview-date"><span class="preview-day">${s.dayName.slice(0,3)}</span><span class="preview-num">${s.dateObj.getDate()}/${s.dateObj.getMonth()+1}</span></div><div class="preview-code">${s.code}</div><div class="preview-status">${STATUS_EMOJI[s.status]} ${STATUS_LABELS[s.status]}</div></div>`).join(''); }
function updateImportSummary(svcs) { const j=svcs.filter(s=>s.status==='jour').length,n=svcs.filter(s=>s.status==='nuit').length,r=svcs.filter(s=>s.status==='repos').length,m=svcs.filter(s=>s.status==='mn').length; $('importSummary')&&($('importSummary').textContent=`${svcs.length} svc — ☀️${j} 🌙${n} 🌅${m} 🏠${r}`); }
function confirmImport() { if(!user||!pendingImport.length)return; pendingImport.forEach(it=>entries.set(it.dateKey,{status:it.status,note:it.note,custom_label:it.code,imported:true})); $('sheetImport')?.classList.remove('show'); $('backdropImport')?.classList.remove('show'); renderGrid(); updateUI(); showToast(`✅ ${pendingImport.length} importés`); (async()=>{ for(const it of pendingImport){const p={user_id:user.id,work_date:it.dateKey,status:it.status,note:it.note,custom_label:it.code,imported:true}; let{error}=await supabase.from("work_calendar_entries").upsert(p,{onConflict:"user_id,work_date"}); if(error&&error.message.includes('imported')){delete p.imported;await supabase.from("work_calendar_entries").upsert(p,{onConflict:"user_id,work_date"});} } })(); }

// MODALES & EVENTS
function openNoteModal() { const e=entries.get(state.selected), d=parseKey(state.selected); $('sheetTitle').textContent=`Note — ${d.getDate()} ${MONTHS[d.getMonth()]}`; $('noteText').value=e?.note||''; $('sheetNote').style.display='block'; $('sheetOther').style.display='none'; $('backdrop')?.classList.add('show'); $('sheet')?.classList.add('show'); }
function openOtherModal() { const d=parseKey(state.selected); $('sheetTitle').textContent=`Autre — ${d.getDate()} ${MONTHS[d.getMonth()]}`; $('otherSelect').value="OCP"; $('otherCustom').style.display='none'; $('sheetNote').style.display='none'; $('sheetOther').style.display='block'; $('backdrop')?.classList.add('show'); $('sheet')?.classList.add('show'); }
function closeModal(b,s) { $(b)?.classList.remove('show'); $(s)?.classList.remove('show'); }

function setupEvents() {
  $('btnPrevMonth')?.addEventListener('click', ()=>changeMonth(-1));
  $('btnNextMonth')?.addEventListener('click', ()=>changeMonth(1));
  $('btnToday')?.addEventListener('click', ()=>{ const n=new Date(); state.year=n.getFullYear(); state.month=n.getMonth(); state.selected=keyFor(n); localStorage.setItem('ms_state',JSON.stringify(state)); loadEntries().then(()=>{renderGrid();updateUI();}); });
  $('btnStats')?.addEventListener('click', openStats);
  $('btnCloseStats')?.addEventListener('click', ()=>closeModal('backdropStats','sheetStats'));
  $('backdropStats')?.addEventListener('click', ()=>closeModal('backdropStats','sheetStats'));

  document.querySelectorAll('[data-set]').forEach(btn => {
    btn.addEventListener('click', () => {
      if(!state.selected) return; const act=btn.dataset.set;
      if(act==='note'){openNoteModal();return;} if(act==='autre'){openOtherModal();return;} if(act==='reset'){saveEntry(state.selected,{status:null});return;}
      saveEntry(state.selected, {status:act, note:entries.get(state.selected)?.note||''});
    });
  });

  $('btnSaveNote')?.addEventListener('click', ()=>{ saveEntry(state.selected,{status:entries.get(state.selected)?.status||'autre',note:$('noteText').value}); closeModal('backdrop','sheet'); });
  $('btnClearNote')?.addEventListener('click', ()=>{ saveEntry(state.selected,{status:entries.get(state.selected)?.status||'autre',note:''}); closeModal('backdrop','sheet'); });
  $('backdrop')?.addEventListener('click', ()=>closeModal('backdrop','sheet'));
  $('otherSelect')?.addEventListener('change', e=>$('otherCustom').style.display=e.target.value==='custom'?'block':'none');
  $('btnApplyOther')?.addEventListener('click', ()=>{ const v=$('otherSelect').value,c=$('otherCustom').value; saveEntry(state.selected,{status:'autre',note:entries.get(state.selected)?.note||'',custom_label:v==='custom'?c:v}); closeModal('backdrop','sheet'); });
  $('btnCloseOther')?.addEventListener('click', ()=>closeModal('backdrop','sheet'));

  $('btnImport')?.addEventListener('click', triggerImport);
  $('fileInput')?.addEventListener('change', e=>{ handleFile(e); if(!e.target.files[0])return; const reader=new FileReader(); reader.onload=ev=>{ const wb=XLSX.read(new Uint8Array(ev.target.result),{type:'array'}); let best=null,score=-1; wb.SheetNames.forEach(n=>{const r=XLSX.utils.sheet_to_json(wb.Sheets[n],{header:1});const s=r.reduce((a,b)=>a+b.filter(c=>String(c).trim()).length,0);if(s>score){score=s;best=r;}}); window._importRows=best; window._importDateRows=findDateRows(best); }; reader.readAsArrayBuffer(e.target.files[0]); });
  $('btnConfirmImport')?.addEventListener('click', ()=>{ const p=$('agentPicker'); if(p&&window._importRows){const ags=detectAgents(window._importRows,window._importDateRows||[]);const ag=ags.find(a=>a.name===p.value);if(ag)pendingImport=buildServicesForAgent(ag,window._importDateRows,window._importRows);} confirmImport(); });
  $('btnCancelImport')?.addEventListener('click', ()=>closeModal('backdropImport','sheetImport'));
  $('backdropImport')?.addEventListener('click', ()=>closeModal('backdropImport','sheetImport'));

  $('btnExport')?.addEventListener('click', exportCalendar);

  $('btnSettings')?.addEventListener('click', e=>{e.stopPropagation();$('settingsPop')?.classList.toggle('show');});
  $('btnCloseSettings')?.addEventListener('click', ()=>$('settingsPop')?.classList.remove('show'));
  $('settingsPop')?.addEventListener('click', e=>e.stopPropagation());
  document.addEventListener('click', ()=>{const p=$('settingsPop');if(p&&p.classList.contains('show'))p.classList.remove('show');});

  $('themeLight')?.addEventListener('click', ()=>{prefs.theme='light';savePrefs();applyPrefs();});
  $('themeDark')?.addEventListener('click', ()=>{prefs.theme='dark';savePrefs();applyPrefs();});
  $('agentName')?.addEventListener('change', e=>{prefs.agentName=e.target.value.trim();savePrefs();if($('topSub'))$('topSub').textContent=prefs.agentName||user?.email.split('@')[0];showToast("✅ Nom enregistré");});
  $('agentMatricule')?.addEventListener('change', e=>{prefs.agentMatricule=e.target.value.trim();savePrefs();});
  ['rateDay','rateNightFull','rateNightSolo','rateMN'].forEach(id=>{$(id)?.addEventListener('change',e=>{prefs[id]=parseFloat(e.target.value)||0;savePrefs();updateUI();});});
  
  $('btnResetRates')?.addEventListener('click', ()=>{if(confirm("Réinitialiser les taux ?")){prefs.rateDay=35;prefs.rateNightFull=82;prefs.rateNightSolo=41;prefs.rateMN=15;savePrefs();applyPrefs();updateUI();showToast("✅ Taux réinitialisés");}});
  $('btnClearData')?.addEventListener('click', async ()=>{if(confirm("⚠️ Effacer TOUTES les données ?")){if(confirm("Vraiment ? Irréversible.")){entries.clear();if(user)await supabase.from("work_calendar_entries").delete().eq('user_id',user.id);renderGrid();updateUI();showToast("🗑️ Effacé");$('settingsPop')?.classList.remove('show');}}});

  $('btnLogin')?.addEventListener('click', async ()=>{const em=$('loginEmail').value,pw=$('loginPass').value;if(!em||!pw){$('loginHint').textContent="Champs requis";return;}$('loginHint').textContent="Connexion...";const{error}=await supabase.auth.signInWithPassword({email:em,password:pw});if(error)$('loginHint').textContent="❌ "+error.message;else checkAuth();});
  $('btnSignup')?.addEventListener('click', async ()=>{const em=$('signupEmail').value,pw=$('signupPass').value;if(!em||!pw){$('signupHint').textContent="Requis";return;}if(pw.length<6){$('signupHint').textContent="6 car. min";return;}$('signupHint').textContent="Création...";const{error}=await supabase.auth.signUp({email:em,password:pw});if(error)$('signupHint').textContent="❌ "+error.message;else $('signupHint').textContent="✅ Vérifiez emails";});
  $('tabSignup')?.addEventListener('click', ()=>{$('formLogin').style.display='none';$('formSignup').style.display='block';});
  $('tabLogin')?.addEventListener('click', ()=>{$('formSignup').style.display='none';$('formLogin').style.display='block';});
  $('btnLogout')?.addEventListener('click', async ()=>{await supabase.auth.signOut();user=null;entries.clear();checkAuth();renderGrid();});
  ['loginEmail','loginPass','signupEmail','signupPass'].forEach(id=>{$(id)?.addEventListener('keydown',e=>{if(e.key==='Enter')$('btnLogin')?.click();});});
}

function changeMonth(d) { state.month+=d; if(state.month<0){state.month=11;state.year--;} if(state.month>11){state.month=0;state.year++;} localStorage.setItem('ms_state',JSON.stringify(state)); loadEntries().then(()=>{renderGrid();updateUI();}); }

init();