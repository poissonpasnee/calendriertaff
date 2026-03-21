import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

/* --- Configuration & État --- */
const SUPABASE_URL = "https://dstmyvzjirgyuwuojwnk.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRzdG15dnpqaXJneXV3dW9qd25rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk3NzY4NTUsImV4cCI6MjA4NTM1Mjg1NX0.Cl6WAvK0elHkKXnXRtrFFiBlGABnK5RTFdawq3NGDJk";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

const LS_PREFS = "planning_prefs_v2";
const LS_STATE = "planning_state_v2";

let prefs = { theme: 'light', weekStart: 'sun', size: 'comfort', quickTap: false, confirmLogout: true };
let state = { year: 2026, month: 0, selected: null };
let user = null;
let entries = new Map();
let cellCache = new Map();

/* --- Helpers --- */
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parseKey = (k) => { const [y,m,d] = k.split('-').map(Number); return new Date(y, m-1, d); };
const months = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
const daysShort = ["Dim","Lun","Mar","Mer","Jeu","Ven","Sam"];
const labels = { jour:"Jour", nuit:"Nuit", repos:"Repos", conges:"Congés", autre:"Autre" };

/* --- Initialisation --- */
function init() {
  loadPrefs();
  loadState();
  applyPrefs();
  setupListeners();
  refreshAuth();
  render();
  
  // Auto-update theme color meta tag
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if(themeColor) themeColor.setAttribute('content', prefs.theme === 'dark' ? '#0f172a' : '#f4f6fb');
}

function loadPrefs() {
  try { const p = JSON.parse(localStorage.getItem(LS_PREFS)); if(p) prefs = {...prefs, ...p}; } catch{}
}
function savePrefs() { localStorage.setItem(LS_PREFS, JSON.stringify(prefs)); }
function loadState() {
  try { const s = JSON.parse(localStorage.getItem(LS_STATE)); if(s) state = {...state, ...s}; } catch{}
  const now = new Date();
  if (!state.selected || state.year < 2020) {
    state.year = now.getFullYear();
    state.month = now.getMonth();
    state.selected = key(now);
  }
}
function saveState() { localStorage.setItem(LS_STATE, JSON.stringify(state)); }

function applyPrefs() {
  document.documentElement.setAttribute('data-theme', prefs.theme);
  document.documentElement.setAttribute('data-size', prefs.size);
  updateSettingsUI();
  renderHeaders();
}

/* --- Rendu --- */
function renderHeaders() {
  const startDay = prefs.weekStart === 'mon' ? 1 : 0;
  const headers = [...daysShort.slice(startDay), ...daysShort.slice(0, startDay)];
  for(let i=0; i<7; i++) {
    const el = $(`h${i}`);
    if(el) el.textContent = headers[i];
  }
}

function render() {
  $('navMonth').textContent = months[state.month];
  $('navYear').textContent = state.year;
  
  const grid = $('grid');
  grid.innerHTML = '';
  cellCache.clear();

  const first = new Date(state.year, state.month, 1);
  let startDay = first.getDay();
  if (prefs.weekStart === 'mon') startDay = startDay === 0 ? 6 : startDay - 1;
  
  const startDate = new Date(first);
  startDate.setDate(first.getDate() - startDay);

  for (let i = 0; i < 42; i++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    const k = key(d);
    
    // Week number column
    if (i % 7 === 0) {
      const wn = document.createElement('div');
      wn.className = 'weeknum';
      wn.textContent = getWeekNumber(d);
      grid.appendChild(wn);
    }

    const cell = document.createElement('div');
    cell.className = `day ${d.getMonth() !== state.month ? 'out' : ''}`;
    cell.dataset.key = k;
    cell.textContent = d.getDate();
    
    // Apply status
    const entry = entries.get(k);
    if (entry?.status) {
      cell.classList.add(entry.status);
      if (entry.note) {
        const dot = document.createElement('div'); dot.className = 'dot'; cell.appendChild(dot);
      }
    }

    if (k === state.selected) cell.classList.add('selected');
    
    cell.onclick = () => handleCellClick(k);
    
    grid.appendChild(cell);
    cellCache.set(k, cell);
  }
  
  updateSelectionUI();
  renderTotals();
}

function getWeekNumber(d) {
  const date = new Date(d.getTime());
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
  const week1 = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

/* --- Interactions --- */
function handleCellClick(k) {
  state.selected = k;
  saveState();
  
  // Quick Tap Feature: Si activé, applique "Jour" directement au premier clic
  if (prefs.quickTap) {
    const entry = entries.get(k);
    if (!entry?.status) {
      saveEntry(k, { status: 'jour' });
      render(); // Re-render pour montrer le changement
      return;
    }
  }

  render();
  updateSelectionUI();
}

function updateSelectionUI() {
  const d = parseKey(state.selected);
  const entry = entries.get(state.selected);
  $('selDate').textContent = `${d.getDate()} ${months[d.getMonth()]}`;
  $('selState').textContent = entry?.status ? labels[entry.status] : 'Libre';
  
  const title = `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  $('sheetTitle').textContent = title;
  $('sheetSub').textContent = entry?.note || 'Aucune note';
  $('noteText').value = entry?.note || '';
}

function renderTotals() {
  let counts = { jour:0, nuit:0, repos:0, conges:0, autre:0 };
  entries.forEach(e => { if(e.status) counts[e.status]++; });
  
  const t = $('totals');
  t.innerHTML = '';
  Object.entries(counts).forEach(([k, v]) => {
    if (v > 0) {
      const chip = document.createElement('div');
      chip.className = 'pillchip'; // Assurez-vous que ce style existe ou utilisez un span simple
      chip.style.cssText = "display:inline-block; padding:4px 8px; border-radius:8px; background:var(--surface2); font-size:11px; font-weight:700; margin-right:4px; border:1px solid var(--stroke);";
      chip.textContent = `${labels[k]}: ${v}`;
      t.appendChild(chip);
    }
  });
}

/* --- Sauvegarde --- */
async function saveEntry(k, patch) {
  if (!user) { alert('Connectez-vous d\'abord'); return; }
  
  const current = entries.get(k) || { status: '', note: '' };
  const next = { ...current, ...patch };
  entries.set(k, next);
  
  // Optimistic UI update
  const cell = cellCache.get(k);
  if (cell) {
    cell.className = `day ${cell.classList.contains('out') ? 'out' : ''} ${next.status ? next.status : ''} ${state.selected === k ? 'selected' : ''}`;
    // Clean dots
    cell.querySelectorAll('.dot').forEach(e => e.remove());
    if (next.note) { const dot = document.createElement('div'); dot.className='dot'; cell.appendChild(dot); }
  }
  renderTotals();
  updateSelectionUI();

  const { error } = await supabase.from('work_calendar_entries').upsert({
    user_id: user.id, work_date: k, status: next.status, note: next.note
  }, { onConflict: 'user_id,work_date' });
  
  if (error) console.error('Save error', error);
}

/* --- Auth & Data --- */
async function refreshAuth() {
  const { data } = await supabase.auth.getSession();
  user = data?.session?.user;
  
  if (user) {
    $('gate').classList.remove('show');
    $('topSub').textContent = user.email.split('@')[0];
    loadEntries();
  } else {
    $('gate').classList.add('show');
    $('topSub').textContent = 'Invité';
  }
}

async function loadEntries() {
  if (!user) return;
  // Load 3 months around current view
  const start = new Date(state.year, state.month - 1, 1);
  const end = new Date(state.year, state.month + 2, 0);
  
  const { data } = await supabase.from('work_calendar_entries')
    .select('*')
    .gte('work_date', key(start))
    .lte('work_date', key(end));
    
  entries.clear();
  if (data) data.forEach(r => entries.set(r.work_date, { status: r.status, note: r.note }));
  render();
}

/* --- Listeners --- */
function setupListeners() {
  // Nav
  $('btnPrevMonth').onclick = () => changeMonth(-1);
  $('btnNextMonth').onclick = () => changeMonth(1);
  $('btnToday').onclick = () => {
    const now = new Date();
    state.year = now.getFullYear(); state.month = now.getMonth(); state.selected = key(now);
    saveState(); render();
  };
  
  // Actions
  document.querySelectorAll('[data-set]').forEach(btn => {
    btn.onclick = () => {
      if (!state.selected) return;
      const type = btn.dataset.set;
      if (type === 'autre') {
        $('sheetOther').style.display = 'block';
        $('sheetNote').style.display = 'none';
        $('backdrop').classList.add('show');
        $('sheet').classList.add('show');
      } else {
        saveEntry(state.selected, { status: type });
      }
    };
  });

  $('btnNote').onclick = () => {
    $('sheetNote').style.display = 'block';
    $('sheetOther').style.display = 'none';
    $('backdrop').classList.add('show');
    $('sheet').classList.add('show');
  };

  $('btnCloseSheet').onclick = $('backdrop').onclick = () => {
    $('sheet').classList.remove('show');
    $('backdrop').classList.remove('show');
  };

  $('btnSaveNote').onclick = () => {
    saveEntry(state.selected, { note: $('noteText').value });
    $('sheet').classList.remove('show');
    $('backdrop').classList.remove('show');
  };

  $('btnApplyOther').onclick = () => {
    const val = $('otherSelect').value;
    saveEntry(state.selected, { status: 'autre' }); // Simplified for demo
    $('sheet').classList.remove('show');
    $('backdrop').classList.remove('show');
  };

  // Settings
  $('btnSettings').onclick = (e) => {
    e.stopPropagation();
    $('settingsPop').classList.toggle('show');
  };
  document.onclick = () => $('settingsPop').classList.remove('show');
  
  $('themeLight').onclick = () => { prefs.theme = 'light'; savePrefs(); applyPrefs(); };
  $('themeDark').onclick = () => { prefs.theme = 'dark'; savePrefs(); applyPrefs(); };
  $('togQuickTap').onchange = (e) => { prefs.quickTap = e.target.checked; savePrefs(); };
  $('togConfirmLogout').onchange = (e) => { prefs.confirmLogout = e.target.checked; savePrefs(); };

  // Auth
  $('btnLogin').onclick = async () => {
    const { error } = await supabase.auth.signInWithPassword({
      email: $('loginEmail').value, password: $('loginPass').value
    });
    if (error) alert(error.message); else refreshAuth();
  };
  
  $('btnLogout').onclick = async () => {
    if (prefs.confirmLogout && !confirm('Déconnexion ?')) return;
    await supabase.auth.signOut();
    refreshAuth();
  };
}

function changeMonth(delta) {
  state.month += delta;
  if (state.month > 11) { state.month = 0; state.year++; }
  if (state.month < 0) { state.month = 11; state.year--; }
  saveState();
  loadEntries(); // Reload data for new range
  render();
}

function updateSettingsUI() {
  $('themeLight').classList.toggle('active', prefs.theme === 'light');
  $('themeDark').classList.toggle('active', prefs.theme === 'dark');
  $('togQuickTap').checked = prefs.quickTap;
  $('togConfirmLogout').checked = prefs.confirmLogout;
}

init();      custom_label: r.custom_label || "",
      note: r.note || ""
    });
  });
}

/* ------- UI incremental update ------- */
function clearCellVisual(cell){
  cell.classList.remove("jour","nuit","repos","conges","autre");
  const dot = cell.querySelector(".dot");
  if(dot) dot.remove();
  const badge = cell.querySelector(".badge");
  if(badge) badge.remove();
}
function applyEntryToCell(cell, entry){
  if(entry?.status) cell.classList.add(entry.status);

  if(entry?.note){
    const dot = document.createElement("div");
    dot.className="dot";
    cell.appendChild(dot);
  }
  if(entry?.status === "autre" && entry.custom_label){
    const b = document.createElement("div");
    b.className="badge";
    b.textContent = entry.custom_label.slice(0,6);
    cell.appendChild(b);
  }
}
function updateCell(key){
  const cell = cellByKey.get(key);
  if(!cell) return;
  clearCellVisual(cell);
  applyEntryToCell(cell, entries.get(key));
}

/* Save immediately */
async function upsertDay(dateKey, patch){
  if(!user){ toast("Connecte-toi."); return; }

  const cur = entries.get(dateKey) || { status:"", custom_label:"", note:"" };
  const next = { ...cur, ...patch };

  entries.set(dateKey, next);
  requestAnimationFrame(()=>{
    updateCell(dateKey);
    renderTotals();
    setSelected(dateKey);
  });

  const { error } = await supabase
    .from("work_calendar_entries")
    .upsert({
      user_id: user.id,
      work_date: dateKey,
      status: next.status,
      custom_label: next.custom_label || null,
      note: next.note || null
    }, { onConflict: "user_id,work_date" });

  if(error){
    console.error(error);

    if(cur.status || cur.note || cur.custom_label) entries.set(dateKey, cur);
    else entries.delete(dateKey);

    requestAnimationFrame(()=>{
      updateCell(dateKey);
      renderTotals();
      setSelected(dateKey);
    });

    toast("Erreur sauvegarde: " + (error.message || error.code || ""));
    return;
  }

  saveViewState();
}

/* Render month */
function getWeekNum(d){
  if(prefs.weekNumber === "iso") return isoWeek(d);
  return simpleWeekSunday(d);
}
function rotatedStartDateForMonth(year, month){
  // base start is Sunday grid start
  const first = new Date(year, month, 1);
  const baseStart = new Date(year, month, 1 - first.getDay()); // Sunday
  if(prefs.weekStart === "sun") return baseStart;

  // Monday start: shift grid start back 1 day (Monday)
  const s = new Date(baseStart);
  s.setDate(s.getDate() - 6); // from Sunday to previous Monday
  // explanation: baseStart is Sunday; previous Monday is -6 days
  return s;
}
function renderMonth(){
  grid.innerHTML="";
  cellByKey.clear();
  selectedEl = null;

  navMonth.textContent = MONTHS[viewMonth];
  navYear.textContent  = String(viewYear);

  const start = rotatedStartDateForMonth(viewYear, viewMonth);

  for(let week=0; week<6; week++){
    const weekStart = new Date(start);
    weekStart.setDate(start.getDate() + week*7);

    const wn = document.createElement("div");
    wn.className="weeknum";
    wn.textContent = String(getWeekNum(weekStart)).padStart(2,"0");
    grid.appendChild(wn);

    for(let i=0;i<7;i++){
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate()+i);
      const k = keyFor(d);

      const cell = document.createElement("div");
      cell.className="day";
      cell.dataset.key=k;

      // out-of-month
      if(d.getMonth() !== viewMonth) cell.classList.add("out");
      cell.textContent = String(d.getDate());

      applyEntryToCell(cell, entries.get(k));

      cellByKey.set(k, cell);

      fastTap(cell, async ()=>{
        setSelected(k);
        saveViewState();

        // If "Tap applique direct" is ON: tap = just select (fast) -> actions below remain
        // If OFF: tap opens Note sheet quickly (useful like Calendar)
        if(!prefs.fastApply){
          openSheet("note");
        }
      });

      grid.appendChild(cell);
    }
  }

  if(selectedKey){
    const el = cellByKey.get(selectedKey);
    if(el){
      el.classList.add("selected");
      selectedEl = el;
    }
  }
}

function setSelected(k){
  selectedKey = k;

  if(selectedEl) selectedEl.classList.remove("selected");
  const el = cellByKey.get(k);
  if(el){
    el.classList.add("selected");
    selectedEl = el;
  }else{
    selectedEl = null;
  }

  const d = parseKey(k);
  const e = entries.get(k);
  const state = e?.status ? LABEL[e.status] : "—";
  const extra = (e?.status==="autre" && e.custom_label) ? ` (${e.custom_label})` : "";

  selDate.textContent = fmtLong(d);
  selState.textContent = `État: ${state}${extra}`;
  sheetTitle.textContent = fmtLong(d);
  sheetSub.textContent = `État actuel: ${state}${extra}`;
  noteText.value = e?.note || "";
}

function renderTotals(){
  let cJ=0,cN=0,cR=0,cC=0,cA=0;
  for(const e of entries.values()){
    if(!e?.status) continue;
    if(e.status==="jour") cJ++;
    if(e.status==="nuit") cN++;
    if(e.status==="repos") cR++;
    if(e.status==="conges") cC++;
    if(e.status==="autre") cA++;
  }

  totalsEl.innerHTML="";
  const chip=(t)=>{
    const d=document.createElement("div");
    d.className="pillchip";
    d.textContent=t;
    return d;
  };
  totalsEl.appendChild(chip(`Jours: ${cJ}`));
  totalsEl.appendChild(chip(`Nuits: ${cN}`));
  totalsEl.appendChild(chip(`Repos: ${cR}`));
  totalsEl.appendChild(chip(`Congés: ${cC}`));
  if(!prefs.hideOtherTotal) totalsEl.appendChild(chip(`Autres: ${cA}`));
}

/* Buttons */
function ensureSelected(){
  if(!selectedKey){
    const d = getSncfNow();
    viewYear = clampYear(d.getFullYear());
    viewMonth = d.getMonth();
    selectedKey = keyFor(d);
  }
  return selectedKey;
}

/* Action buttons */
document.querySelectorAll("[data-set]").forEach(btn=>{
  fastTap(btn, async ()=>{
    const k = ensureSelected();
    const dSel = parseKey(k);

    if(dSel.getFullYear()!==viewYear || dSel.getMonth()!==viewMonth){
      viewYear = clampYear(dSel.getFullYear());
      viewMonth = dSel.getMonth();
      await reloadView(true);
    }

    const type = btn.dataset.set;

    if(type==="autre"){
      const e = entries.get(k);
      otherSelect.value="OCP"; otherCustom.value=""; otherCustom.style.display="none";
      if(e?.status==="autre" && e.custom_label){
        if(e.custom_label==="OCP" || e.custom_label==="Férié") otherSelect.value=e.custom_label;
        else { otherSelect.value="custom"; otherCustom.style.display="block"; otherCustom.value=e.custom_label; }
      }
      openSheet("other");
      return;
    }

    await upsertDay(k, { status:type, custom_label:"" });
  });
});

fastTap(btnNote, ()=>{
  ensureSelected();
  openSheet("note");
});

fastTap(document.getElementById("btnApplyOther"), async ()=>{
  const k = ensureSelected();
  let label = otherSelect.value;
  if(label==="custom"){
    label = (otherCustom.value||"").trim();
    if(!label){ toast("Entre un libellé."); return; }
  }
  await upsertDay(k, { status:"autre", custom_label:label });
  closeSheet();
});

fastTap(document.getElementById("btnSaveNote"), async ()=>{
  const k = ensureSelected();
  await upsertDay(k, { note:(noteText.value||"").trim() });
  closeSheet();
});

fastTap(document.getElementById("btnClearNote"), async ()=>{
  const k = ensureSelected();
  noteText.value="";
  await upsertDay(k, { note:"" });
  closeSheet();
});

/* Navigation */
async function changeMonth(delta){
  let y=viewYear, m=viewMonth+delta;
  if(m<0){m=11;y--}
  if(m>11){m=0;y++}
  viewYear = clampYear(y);
  viewMonth = m;
  await reloadView(false);
  saveViewState();
}
async function changeYear(delta){
  viewYear = clampYear(viewYear + delta);
  await reloadView(false);
  saveViewState();
}

fastTap(btnPrevMonth, ()=>changeMonth(-1));
fastTap(btnNextMonth, ()=>changeMonth(1));
fastTap(btnPrevYear,  ()=>changeYear(-1));
fastTap(btnNextYear,  ()=>changeYear(1));

fastTap(btnToday, async ()=>{
  const d = getSncfNow();
  viewYear = clampYear(d.getFullYear());
  viewMonth = d.getMonth();
  selectedKey = keyFor(d);
  await reloadView(true);
  saveViewState();
});

/* Export Excel */
fastTap(btnExportXLSX, ()=>{
  const rows = [["Date","Année","Mois","Semaine","Type","Libellé","Note"]];
  const keys = Array.from(entries.keys()).sort();
  for(const k of keys){
    const e = entries.get(k);
    if(!e?.status) continue;
    const d = new Date(k);
    rows.push([
      k,
      d.getFullYear(),
      MONTHS[d.getMonth()],
      String(getWeekNum(d)).padStart(2,"0"),
      LABEL[e.status]||"",
      e.custom_label||"",
      e.note||""
    ]);
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Planning");
  XLSX.writeFile(wb, `planning_${viewYear}-${pad2(viewMonth+1)}.xlsx`);
});

/* Reload view */
async function reloadView(keepSelection){
  await loadGridEntries();
  renderMonth();
  renderTotals();

  if(keepSelection && selectedKey){
    setSelected(selectedKey);
  }else{
    const k = `${viewYear}-${pad2(viewMonth+1)}-01`;
    selectedKey = k;
    setSelected(k);
  }
}

/* Settings popover wiring */
function initSettings(){
  // load + apply
  loadPrefs();
  applyTheme(getTheme());
  applySettingsToUI();
  updateSettingsUI();

  // open/close
  fastTap(btnSettings, (e)=>{
    e?.stopPropagation?.();
    settingsPop.classList.toggle("show");
  });
  document.addEventListener("click", ()=>settingsPop.classList.remove("show"));
  settingsPop.addEventListener("click", (e)=>e.stopPropagation());

  // theme
  fastTap(document.getElementById("themeLight"), ()=>setTheme("light"));
  fastTap(document.getElementById("themeDark"),  ()=>setTheme("dark"));

  // week start
  fastTap(document.getElementById("weekStartSun"), ()=>{
    prefs.weekStart = "sun";
    savePrefs(); applySettingsToUI(); updateSettingsUI();
    renderMonth(); // reflow columns
    renderTotals();
  });
  fastTap(document.getElementById("weekStartMon"), ()=>{
    prefs.weekStart = "mon";
    savePrefs(); applySettingsToUI(); updateSettingsUI();
    renderMonth();
    renderTotals();
  });

  // week number mode
  fastTap(document.getElementById("weekIso"), ()=>{
    prefs.weekNumber = "iso";
    savePrefs(); updateSettingsUI();
    renderMonth();
  });
  fastTap(document.getElementById("weekSimple"), ()=>{
    prefs.weekNumber = "simple";
    savePrefs(); updateSettingsUI();
    renderMonth();
  });

  // cell size
  fastTap(document.getElementById("cellCompact"), ()=>{
    prefs.cellSize = "compact";
    savePrefs(); applyCellSize(); updateSettingsUI();
  });
  fastTap(document.getElementById("cellComfort"), ()=>{
    prefs.cellSize = "comfort";
    savePrefs(); applyCellSize(); updateSettingsUI();
  });
  fastTap(document.getElementById("cellLarge"), ()=>{
    prefs.cellSize = "large";
    savePrefs(); applyCellSize(); updateSettingsUI();
  });

  // toggles
  const tFast = document.getElementById("togFastApply");
  const tToday= document.getElementById("togAutoToday");
  const tConf = document.getElementById("togConfirmLogout");
  const tHide = document.getElementById("togHideOtherTotal");

  tFast?.addEventListener("change", ()=>{
    prefs.fastApply = !!tFast.checked;
    savePrefs();
  }, { passive:true });

  tToday?.addEventListener("change", ()=>{
    prefs.autoToday = !!tToday.checked;
    savePrefs();
  }, { passive:true });

  tConf?.addEventListener("change", ()=>{
    prefs.confirmLogout = !!tConf.checked;
    savePrefs();
  }, { passive:true });

  tHide?.addEventListener("change", ()=>{
    prefs.hideOtherTotal = !!tHide.checked;
    savePrefs();
    renderTotals();
  }, { passive:true });
}

/* Init */
async function init(){
  initSettings();

  const restored = restoreViewState();

  if(!restored || prefs.autoToday){
    const now = getSncfNow();
    viewYear = clampYear(now.getFullYear());
    viewMonth = now.getMonth();
    selectedKey = keyFor(now);
  }

  renderMonth();
  renderTotals();
  if(selectedKey) setSelected(selectedKey);

  await refreshSessionUser();
  if(user) await reloadView(true);

  supabase.auth.onAuthStateChange(async ()=>{
    await refreshSessionUser();
    if(user) await reloadView(true);
  });
}

init();
