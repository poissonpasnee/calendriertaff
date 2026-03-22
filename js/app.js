import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://dstmyvzjirgyuwuojwnk.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRzdG15dnpqaXJneXV3dW9qd25rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk3NzY4NTUsImV4cCI6MjA4NTM1Mjg1NX0.Cl6WAvK0elHkKXnXRtrFFiBlGABnK5RTFdawq3NGDJk";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

let user = null;
let entries = new Map();
let state = { year: 2026, month: 0, selected: null };
let prefs = { theme: 'dark', quickTap: false, confirmLogout: true, rateDay: 35.0, rateNightFull: 82.0, rateNightSolo: 41.0, payrollShift: false };
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
const clean = (txt) => { if (!txt) return ""; return String(txt).toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9]/g, "").trim(); };

// --- MOTEUR & AUTH (Identique) ---
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

async function init() { loadLocalData(); applyPrefs(); renderGrid(); updateSelectionUI(); renderTotals(); await checkAuth(); setupEvents(); }
function loadLocalData() {
  const p = localStorage.getItem('prefs_v2'); if(p) prefs = {...prefs, ...JSON.parse(p)};
  const s = localStorage.getItem('state_v2'); if(s) state = {...state, ...JSON.parse(s)};
  else { const now = new Date(); state.year = now.getFullYear(); state.month = now.getMonth(); state.selected = keyFor(now); }
}
function applyPrefs() {
  document.documentElement.setAttribute('data-theme', prefs.theme);
  if($('rateDay')) $('rateDay').value = prefs.rateDay;
  if($('rateNightFull')) $('rateNightFull').value = prefs.rateNightFull;
  if($('rateNightSolo')) $('rateNightSolo').value = prefs.rateNightSolo;
  const btnLight = $('themeLight'), btnDark = $('themeDark');
  if(btnLight) btnLight.classList.toggle('active', prefs.theme === 'light');
  if(btnDark) btnDark.classList.toggle('active', prefs.theme === 'dark');
}
async function checkAuth() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data?.session) {
    user = null; if($('topSub')) $('topSub').textContent = "Invité"; if($('gate')) $('gate').classList.add('show'); return;
  }
  user = data.session.user; if($('topSub')) $('topSub').textContent = user.email.split('@')[0]; if($('gate')) $('gate').classList.remove('show');
  await loadEntries(); renderGrid(); renderTotals(); updateSelectionUI();
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
function renderGrid() {
  const grid = $('grid'); if(!grid) return; grid.innerHTML = ''; cellCache.clear();
  let displayYear = state.year, displayMonth = state.month;
  if (prefs.payrollShift) { displayMonth--; if (displayMonth < 0) { displayMonth = 11; displayYear--; } }
  if($('navMonth')) $('navMonth').textContent = MONTHS[displayMonth] + (prefs.payrollShift ? ' (N-1)' : '');
  if($('navYear')) $('navYear').textContent = displayYear;
  const headers = ["D/L", "L/M", "M/M", "M/J", "J/V", "V/S", "S/D"];
  for(let i=0; i<7; i++) if($(`h${i}`)) $(`h${i}`).textContent = headers[i];
  const first = new Date(displayYear, displayMonth, 1);
  let startDay = first.getDay(); const startDate = new Date(first); startDate.setDate(first.getDate() - startDay);
  for(let i=0; i<42; i++) {
    const d = new Date(startDate); d.setDate(startDate.getDate() + i); const k = keyFor(d);
    if(i%7===0) { const wn = document.createElement('div'); wn.className = 'weeknum'; wn.textContent = getWeekNum(d); grid.appendChild(wn); }
    const cell = document.createElement('div'); cell.className = 'day';
    if(d.getMonth() !== displayMonth) cell.classList.add('out');
    cell.textContent = d.getDate(); cell.dataset.key = k;
    const entry = entries.get(k);
    if(entry?.status) {
      cell.classList.add(entry.status);
      if(entry.imported) { cell.style.borderStyle = 'dashed'; cell.style.borderWidth = '2px'; cell.style.borderColor = 'var(--accent)'; }
      if(entry.note) { const dot = document.createElement('div'); dot.className='dot'; cell.appendChild(dot); }
    }
    if(k === state.selected) cell.classList.add('selected');
    cell.onclick = () => handleCellClick(k); grid.appendChild(cell); cellCache.set(k, cell);
  }
}
function getWeekNum(d) { const date = new Date(d); date.setHours(0,0,0,0); date.setDate(date.getDate() + 3 - (date.getDay()+6)%7); const week1 = new Date(date.getFullYear(), 0, 4); return 1 + Math.round(((date-week1)/86400000 - 3 + (week1.getDay()+6)%7)/7); }
function handleCellClick(k) { state.selected = k; localStorage.setItem('state_v2', JSON.stringify(state)); const entry = entries.get(k); if(prefs.quickTap && !entry?.status) { saveEntry(k, { status: 'jour' }); renderGrid(); updateSelectionUI(); return; } renderGrid(); updateSelectionUI(); }
function updateSelectionUI() { const d = parseKey(state.selected); const entry = entries.get(state.selected); if($('selDate')) $('selDate').textContent = `${d.getDate()} ${MONTHS[d.getMonth()]}`; if($('selState')) $('selState').textContent = entry?.status ? LABELS[entry.status] : "Libre"; if($('sheetTitle')) $('sheetTitle').textContent = `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; if($('noteText')) $('noteText').value = entry?.note || ''; }
function renderTotals() { const counts = { jour:0, nuit:0, repos:0, conges:0, autre:0 }; entries.forEach(e => { if(e.status) counts[e.status]++; }); if($('statCount')) $('statCount').textContent = counts.jour + counts.nuit + counts.autre; if($('salaryValue')) { const salary = calculateMonthSalary(state.year, state.month); $('salaryValue').textContent = salary.toLocaleString('fr-FR', {minimumFractionDigits: 2, maximumFractionDigits: 2}) + ' €'; } }

async function saveEntry(k, patch) {
  if(!user) { $('gate').classList.add('show'); return; }
  const cur = entries.get(k) || { status:'', note:'', custom_label:'', imported:false };
  const next = { ...cur, ...patch };
  entries.set(k, next);
  const cell = cellCache.get(k);
  if(cell) {
    cell.className = `day ${cell.classList.contains('out')?'out':''} ${next.status||''}`;
    if(next.imported) { cell.style.borderStyle = 'dashed'; cell.style.borderWidth = '2px'; cell.style.borderColor = 'var(--accent)'; }
    const existingDot = cell.querySelector('.dot'); if(existingDot) existingDot.remove();
    if(next.note) { const dot=document.createElement('div'); dot.className='dot'; cell.appendChild(dot); }
  }
  if(state.selected === k) updateSelectionUI();
  renderTotals();
  
  const { error } = await supabase.from("work_calendar_entries").upsert({
    user_id: user.id, work_date: k, status: next.status, note: next.note, custom_label: next.custom_label, imported: next.imported
  }, { onConflict: "user_id,work_date" });
  
  if(error) { console.error("Erreur sauvegarde:", error); alert("Erreur: " + error.message); loadEntries().then(renderGrid); }
}

// --- NOUVELLE MÉTHODE : IMPORT PAR COLLAGE ---

function triggerPasteImport() {
  if(!user) { alert("Connectez-vous d'abord."); $('gate').classList.add('show'); return; }
  $('pasteArea').value = '';
  $('pastePreview').innerHTML = '';
  $('pastePreview').style.display = 'none';
  $('btnConfirmPaste').style.display = 'none';
  $('backdropPaste').classList.add('show');
  $('sheetPaste').classList.add('show');
  setTimeout(() => $('pasteArea').focus(), 100);
}

function processPaste() {
  const rawText = $('pasteArea').value;
  if(!rawText.trim()) return alert("Veuillez coller du texte d'abord.");

  // On découpe par tabulation (copie Excel standard) ou par espaces multiples
  const cells = rawText.split(/\t+/); 
  const foundServices = [];
  
  const monthsFr = ["JANVIER","FÉVRIER","MARS","AVRIL","MAI","JUIN","JUILLET","AOÛT","SEPTEMBRE","OCTOBRE","NOVEMBRE","DÉCEMBRE"];
  const currentYear = new Date().getFullYear();
  let currentMonth = state.month; // On utilise le mois affiché dans le calendrier
  
  // On essaie de détecter le mois si présent dans le texte collé
  const upperText = rawText.toUpperCase();
  monthsFr.forEach((m, i) => { if(upperText.includes(m)) currentMonth = i; });

  let currentDate = new Date(currentYear, currentMonth, 1);
  
  // Parcours des cellules collées
  cells.forEach(cell => {
    const val = clean(cell);
    
    // 1. Est-ce une date ? (ex: "23/03" ou "23")
    const dateMatch = val.match(/^(\d{1,2})[/\-\.]?(\d{1,2})?$/);
    if(dateMatch) {
      const day = parseInt(dateMatch[1]);
      const month = dateMatch[2] ? parseInt(dateMatch[2])-1 : currentMonth;
      currentDate = new Date(currentYear, month, day);
      return; // On passe à la suite, on a juste mis à jour la date courante
    }

    // 2. Est-ce un code chantier ? (Lettre + Chiffre, court)
    const hasLetter = /[A-Z]/.test(val);
    const hasNumber = /[0-9]/.test(val);
    const isShort = val.length >= 2 && val.length <= 5;
    
    if(hasLetter && hasNumber && isShort) {
      // C'est un code ! On l'associe à la date courante
      let status = "autre";
      if(val.startsWith('N')) status = "nuit";
      else if(val.startsWith('J')) status = "jour";
      else if(val.startsWith('R')) status = "repos";
      else if(val.startsWith('C')) status = "conges";
      
      // Vérifier si la date est dans le bon mois affiché
      if(currentDate.getMonth() === state.month && currentDate.getFullYear() === state.year) {
        const k = keyFor(currentDate);
        if(!foundServices.find(s => s.dateKey === k)) {
          foundServices.push({
            dateKey: k,
            dateObj: new Date(currentDate),
            dayName: currentDate.toLocaleDateString('fr-FR', {weekday:'long'}),
            code: val,
            status: status,
            note: `Import: ${val}`
          });
        }
      }
    }
  });

  if(foundServices.length === 0) {
    return alert("Aucun code (N28, J12...) détecté dans le texte collé.\nAssurez-vous d'avoir copié la ligne contenant les codes.");
  }

  // Affichage prévisualisation
  pendingImport = foundServices;
  const preview = $('pastePreview');
  preview.innerHTML = `<h3 style="font-size:14px; margin-bottom:10px;">${foundServices.length} services détectés :</h3>`;
  foundServices.forEach(s => {
    const div = document.createElement('div');
    div.style.cssText = "padding:6px; border-bottom:1px solid var(--border); font-size:13px; display:flex; justify-content:space-between;";
    div.innerHTML = `<span>${s.dayName} ${s.dateObj.getDate()}/${s.dateObj.getMonth()+1}</span> <b style="color:var(--accent)">${s.code} (${s.status})</b>`;
    preview.appendChild(div);
  });
  
  preview.style.display = 'block';
  $('btnConfirmPaste').style.display = 'block';
}

function confirmPasteImport() {
  if(!user) return;
  let count = 0;
  pendingImport.forEach(item => {
    entries.set(item.dateKey, { status: item.status, note: item.note, custom_label: item.code, imported: true });
    const cell = cellCache.get(item.dateKey);
    if(cell) {
      cell.className = `day ${cell.classList.contains('out')?'out':''} ${item.status}`;
      cell.style.borderStyle = 'dashed'; cell.style.borderWidth = '2px'; cell.style.borderColor = 'var(--accent)';
    }
    count++;
  });
  renderTotals(); renderGrid();
  
  (async () => {
    for(const item of pendingImport) {
      await supabase.from("work_calendar_entries").upsert({
        user_id: user.id, work_date: item.dateKey, status: item.status, note: item.note, custom_label: item.code, imported: true
      }, { onConflict: "user_id,work_date" });
    }
    alert(`✅ ${count} services importés !`);
    $('sheetPaste').classList.remove('show');
    $('backdropPaste').classList.remove('show');
  })();
}

// --- EVENTS ---
function setupEvents() {
  if($('btnPrevMonth')) $('btnPrevMonth').onclick = () => { state.month--; if(state.month<0){state.month=11;state.year--;} localStorage.setItem('state_v2', JSON.stringify(state)); loadEntries().then(() => { renderGrid(); updateSelectionUI(); renderTotals(); }); };
  if($('btnNextMonth')) $('btnNextMonth').onclick = () => { state.month++; if(state.month>11){state.month=0;state.year++;} localStorage.setItem('state_v2', JSON.stringify(state)); loadEntries().then(() => { renderGrid(); updateSelectionUI(); renderTotals(); }); };
  if($('btnToday')) $('btnToday').onclick = () => { const n=new Date(); state.year=n.getFullYear(); state.month=n.getMonth(); state.selected=keyFor(n); localStorage.setItem('state_v2', JSON.stringify(state)); loadEntries().then(() => { renderGrid(); updateSelectionUI(); renderTotals(); }); };
  
  document.querySelectorAll('[data-set]').forEach(btn => {
    btn.onclick = () => {
      if(!state.selected) return;
      if(btn.dataset.set === 'autre') { $('sheetOther').style.display = 'block'; $('sheetNote').style.display = 'none'; $('backdrop').classList.add('show'); $('sheet').classList.add('show'); } 
      else saveEntry(state.selected, { status: btn.dataset.set, custom_label: '' });
    };
  });
  
  const closeSheet = () => { $('sheet').classList.remove('show'); $('backdrop').classList.remove('show'); };
  if($('btnSaveNote')) $('btnSaveNote').onclick = () => { saveEntry(state.selected, { note: $('noteText').value }); closeSheet(); };
  if($('btnClearNote')) $('btnClearNote').onclick = () => { saveEntry(state.selected, { note: '' }); closeSheet(); };
  if($('btnApplyOther')) $('btnApplyOther').onclick = () => { const val = $('otherSelect').value; const custom = $('otherCustom').value; saveEntry(state.selected, { status: 'autre', custom_label: val==='custom'?custom:val }); closeSheet(); };
  if($('otherSelect')) $('otherSelect').onchange = (e) => { if($('otherCustom')) $('otherCustom').style.display = e.target.value==='custom'?'block':'none'; };

  // --- NOUVEAU BOUTON IMPORT (Remplace l'ancien) ---
  // On détourne le bouton d'import existant pour ouvrir la modale de collage
  if($('btnImport')) $('btnImport').onclick = triggerPasteImport;
  // On cache l'input fichier inutile
  if($('fileInput')) $('fileInput').style.display = 'none';

  // Events Modale Collage
  if($('btnProcessPaste')) $('btnProcessPaste').onclick = processPaste;
  if($('btnConfirmPaste')) $('btnConfirmPaste').onclick = confirmPasteImport;
  if($('btnCancelPaste')) $('btnCancelPaste').onclick = () => { $('sheetPaste').classList.remove('show'); $('backdropPaste').classList.remove('show'); };
  if($('backdropPaste')) $('backdropPaste').onclick = () => { $('sheetPaste').classList.remove('show'); $('backdropPaste').classList.remove('show'); };

  // Events Export (Inchangé)
  if($('btnExportXLSX')) $('btnExportXLSX').onclick = () => { const firstDay = new Date(state.year, state.month, 1); const lastDay = new Date(state.year, state.month + 1, 0); if($('exportStart')) $('exportStart').value = keyFor(firstDay); if($('exportEnd')) $('exportEnd').value = keyFor(lastDay); $('backdropExport').classList.add('show'); $('sheetExport').classList.add('show'); };
  if($('btnCloseExport')) $('btnCloseExport').onclick = () => { $('sheetExport').classList.remove('show'); $('backdropExport').classList.remove('show'); };
  if($('backdropExport')) $('backdropExport').onclick = () => { $('sheetExport').classList.remove('show'); $('backdropExport').classList.remove('show'); };
  if($('btnGenerateXLSX')) $('btnGenerateXLSX').onclick = () => {
    const startStr = $('exportStart').value, endStr = $('exportEnd').value;
    if(!startStr || !endStr) return alert("Période invalide");
    const dataRows = [["Date", "Jour", "Statut", "Code", "Estimation (€)"]];
    let totalVariable = 0, current = parseKey(startStr);
    while(current <= parseKey(endStr)) {
      const k = keyFor(current); const entry = entries.get(k); const status = entry?.status || ""; const code = entry?.custom_label || "";
      let val = 0; if(status === 'jour') val = prefs.rateDay; if(status === 'nuit') val = prefs.rateNightFull;
      totalVariable += val;
      dataRows.push([k, current.toLocaleDateString('fr-FR'), LABELS[status]||"", code, val || ""]);
      current.setDate(current.getDate() + 1);
    }
    dataRows.push([], ["Salaire Base", "", "", "", BASE_SALARY], ["Total Variables", "", "", "", totalVariable], ["ESTIMATION TOTALE", "", "", "", BASE_SALARY + totalVariable]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dataRows), "Paie"); XLSX.writeFile(wb, `Paie_${startStr}_au_${endStr}.xlsx`);
    $('sheetExport').classList.remove('show'); $('backdropExport').classList.remove('show');
  };

  // Settings
  if($('btnSettings')) $('btnSettings').onclick = (e) => { e.stopPropagation(); if($('settingsPop')) $('settingsPop').classList.toggle('show'); };
  document.onclick = () => { if($('settingsPop')) $('settingsPop').classList.remove('show'); };
  if($('settingsPop')) $('settingsPop').onclick = (e) => e.stopPropagation();
  if($('themeLight')) $('themeLight').onclick = () => { prefs.theme='light'; localStorage.setItem('prefs_v2', JSON.stringify(prefs)); applyPrefs(); };
  if($('themeDark')) $('themeDark').onclick = () => { prefs.theme='dark'; localStorage.setItem('prefs_v2', JSON.stringify(prefs)); applyPrefs(); };
  if($('rateDay')) $('rateDay').onchange = (e) => { prefs.rateDay=parseFloat(e.target.value)||0; localStorage.setItem('prefs_v2', JSON.stringify(prefs)); renderTotals(); };
  if($('rateNightFull')) $('rateNightFull').onchange = (e) => { prefs.rateNightFull=parseFloat(e.target.value)||0; localStorage.setItem('prefs_v2', JSON.stringify(prefs)); renderTotals(); };
  if($('rateNightSolo')) $('rateNightSolo').onchange = (e) => { prefs.rateNightSolo=parseFloat(e.target.value)||0; localStorage.setItem('prefs_v2', JSON.stringify(prefs)); renderTotals(); };
  if($('btnSaveImportConfig')) $('btnSaveImportConfig').onclick = () => { const val = $('importKeyword').value.trim(); if(val) { prefs.importKeyword = val; localStorage.setItem('prefs_v2', JSON.stringify(prefs)); alert("✅ Nom enregistré (pour info)."); $('settingsPop').classList.remove('show'); } else alert("Entrez un nom."); };

  // Auth
  const tabLogin = $('tabLogin'), tabSignup = $('tabSignup'), paneLogin = $('paneLogin'), paneSignup = $('paneSignup');
  if(tabLogin && tabSignup) {
    const switchToLogin = () => { paneLogin.style.display='block'; paneSignup.style.display='none'; tabLogin.classList.add('active'); tabSignup.classList.remove('active'); };
    tabLogin.onclick = switchToLogin; tabSignup.onclick = () => { paneLogin.style.display='none'; paneSignup.style.display='block'; tabSignup.classList.add('active'); tabLogin.classList.remove('active'); };
    if($('btnBackLogin')) $('btnBackLogin').onclick = switchToLogin;
  }
  if($('btnLogin')) $('btnLogin').onclick = async () => { const email = $('loginEmail').value, pass = $('loginPass').value, hint = $('loginHint'); if(!email || !pass) { hint.textContent = "Champs requis"; return; } hint.textContent = "Connexion..."; const { error } = await supabase.auth.signInWithPassword({ email, password: pass }); if(error) { hint.textContent = "Erreur: " + error.message; } else checkAuth(); };
  if($('btnSignup')) $('btnSignup').onclick = async () => { const email = $('signEmail').value, pass = $('signPass').value; if(pass.length < 6) return alert("6 caractères min"); const { error } = await supabase.auth.signUp({ email, password: pass }); if(error) alert(error.message); else { alert("Compte créé !"); tabLogin.onclick(); } };
  if($('btnReset')) $('btnReset').onclick = async () => { const email = $('loginEmail').value; if(!email) return alert("Entrez email"); await supabase.auth.resetPasswordForEmail(email); alert("Email envoyé"); };
  if($('btnLogout')) $('btnLogout').onclick = async () => { if(prefs.confirmLogout && !confirm("Déconnexion ?")) return; await supabase.auth.signOut(); checkAuth(); };
}

init();
