import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

/* ===== Supabase ===== */
const SUPABASE_URL  = "https://dstmyvzjirgyuwuojwnk.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRzdG15dnpqaXJneXV3dW9qd25rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk3NzY4NTUsImV4cCI6MjA4NTM1Mjg1NX0.Cl6WAvK0elHkKXnXRtrFFiBlGABnK5RTFdawq3NGDJk";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { persistSession:true, autoRefreshToken:true, detectSessionInUrl:false }
});

/* ===== Constants ===== */
const MIN_YEAR = 2023;
const MAX_YEAR = 2035;
const MONTHS = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
const DOW = ["Dim","Lun","Mar","Mer","Jeu","Ven","Sam"];
const LABEL = { jour:"Jour", nuit:"Nuit", repos:"Repos", conges:"Congés", autre:"Autre" };
const LS_KEY = "sncf_planning_state_nolock_v1";

/* ===== DOM ===== */
const grid = document.getElementById("grid");
const totalsEl = document.getElementById("totals");
const navMonth = document.getElementById("navMonth");
const navYear = document.getElementById("navYear");
const topSub = document.getElementById("topSub");
const selDate = document.getElementById("selDate");
const selState = document.getElementById("selState");
const toastEl = document.getElementById("toast");

const backdrop = document.getElementById("backdrop");
const sheet = document.getElementById("sheet");
const sheetTitle = document.getElementById("sheetTitle");
const sheetSub = document.getElementById("sheetSub");
const sheetOther = document.getElementById("sheetOther");
const sheetNote = document.getElementById("sheetNote");
const otherSelect = document.getElementById("otherSelect");
const otherCustom = document.getElementById("otherCustom");
const noteText = document.getElementById("noteText");

const gate = document.getElementById("gate");
const tabLogin = document.getElementById("tabLogin");
const tabSignup = document.getElementById("tabSignup");
const paneLogin = document.getElementById("paneLogin");
const paneSignup = document.getElementById("paneSignup");
const loginEmail = document.getElementById("loginEmail");
const loginPass = document.getElementById("loginPass");
const signEmail = document.getElementById("signEmail");
const signPass = document.getElementById("signPass");
const loginHint = document.getElementById("loginHint");

/* ===== State ===== */
let user = null;
let viewYear = 2026;
let viewMonth = 0;
let selectedKey = null;
const entries = new Map();

/* ===== Helpers ===== */
const pad2 = (n) => String(n).padStart(2,"0");
const keyFor = (d) => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
const parseKey = (k) => { const [y,m,d]=k.split("-").map(Number); return new Date(y,m-1,d); };
const clampYear = (y)=> Math.max(MIN_YEAR, Math.min(MAX_YEAR, y));

function toast(msg){
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  setTimeout(()=>toastEl.classList.remove("show"), 2500);
}
function fmtLong(d){
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} (${DOW[d.getDay()]})`;
}
function isoWeek(date){
  const d = new Date(date);
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() + 3 - ((d.getDay()+6)%7));
  const week1 = new Date(d.getFullYear(),0,4);
  return 1 + Math.round(((d-week1)/86400000 - 3 + ((week1.getDay()+6)%7))/7);
}
function getSncfNow(){
  const d = new Date();
  if (d.getHours() >= 22) d.setDate(d.getDate() + 1);
  return d;
}

/* Persist view */
function saveViewState(){
  try{ localStorage.setItem(LS_KEY, JSON.stringify({viewYear, viewMonth, selectedKey})); }catch{}
}
function restoreViewState(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if(!raw) return false;
    const st = JSON.parse(raw);
    if(!st) return false;
    viewYear = clampYear(st.viewYear ?? viewYear);
    viewMonth = Math.max(0, Math.min(11, st.viewMonth ?? viewMonth));
    selectedKey = (typeof st.selectedKey==="string") ? st.selectedKey : null;
    return true;
  }catch{return false;}
}

/* Range (42 days displayed) */
function gridRangeForMonth(year, month){
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const end = new Date(start);
  end.setDate(start.getDate() + 41);
  return { start, end, fromKey:keyFor(start), toKey:keyFor(end) };
}

/* Sheet */
function openSheet(mode){
  sheetOther.style.display = (mode==="other") ? "block" : "none";
  sheetNote.style.display  = (mode==="note")  ? "block" : "none";
  backdrop.classList.add("show");
  sheet.classList.add("show");
}
function closeSheet(){
  backdrop.classList.remove("show");
  sheet.classList.remove("show");
}
backdrop.addEventListener("click", closeSheet);
document.getElementById("btnCloseSheet").addEventListener("click", closeSheet);
document.getElementById("btnCancelOther").addEventListener("click", closeSheet);
otherSelect.addEventListener("change", ()=>{
  otherCustom.style.display = (otherSelect.value==="custom") ? "block" : "none";
});

/* Auth tabs */
function showPane(which){
  if(which==="login"){
    paneLogin.style.display="block"; paneSignup.style.display="none";
    tabLogin.classList.add("primary"); tabSignup.classList.remove("primary");
  }else{
    paneLogin.style.display="none"; paneSignup.style.display="block";
    tabSignup.classList.add("primary"); tabLogin.classList.remove("primary");
  }
}
tabLogin.addEventListener("click", ()=>showPane("login"));
tabSignup.addEventListener("click", ()=>showPane("signup"));
document.getElementById("btnBackLogin").addEventListener("click", ()=>showPane("login"));

/* Auth actions */
document.getElementById("btnLogin").addEventListener("click", async ()=>{
  loginHint.textContent="";
  const email = (loginEmail.value||"").trim();
  const pass  = loginPass.value||"";
  if(!email || !pass){ loginHint.textContent="Email + mot de passe requis."; return; }
  const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
  if(error){ console.error(error); loginHint.textContent = error.message || "Erreur connexion."; }
});
document.getElementById("btnSignup").addEventListener("click", async ()=>{
  const email = (signEmail.value||"").trim();
  const pass  = (signPass.value||"");
  if(!email || !pass){ toast("Email + mot de passe requis."); return; }
  if(pass.length < 6){ toast("Mot de passe: 6 caractères minimum."); return; }
  const { error } = await supabase.auth.signUp({ email, password: pass });
  if(error){ console.error(error); toast(error.message || "Erreur création compte."); return; }
  toast("Compte créé. Connecte-toi.");
  showPane("login");
  loginEmail.value=email; loginPass.value="";
});
document.getElementById("btnReset").addEventListener("click", async ()=>{
  const email = (loginEmail.value||"").trim();
  if(!email){ loginHint.textContent="Entre ton email puis reset."; return; }
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  if(error){ console.error(error); loginHint.textContent = error.message || "Erreur reset."; return; }
  loginHint.textContent="Email de réinitialisation envoyé.";
});
document.getElementById("btnLogout").addEventListener("click", async ()=>{
  await supabase.auth.signOut();
  entries.clear(); user=null;
  topSub.textContent="Non connecté";
  gate.classList.add("show");
  renderMonth(); renderTotals();
});

/* Wait session */
async function refreshSessionUser(){
  const { data, error } = await supabase.auth.getSession();
  if(error){ console.error(error); user=null; }
  user = data?.session?.user || null;

  if(!user){
    topSub.textContent="Non connecté";
    gate.classList.add("show");
  }else{
    const uidShort = String(user.id||"").slice(0,8);
    topSub.textContent = `${user.email || "Connecté"} · uid:${uidShort}`;
    gate.classList.remove("show");
  }
}

/* Load entries for visible range */
async function loadGridEntries(){
  entries.clear();
  if(!user) return;

  const { fromKey, toKey } = gridRangeForMonth(viewYear, viewMonth);

  const { data, error } = await supabase
    .from("work_calendar_entries")
    .select("work_date,status,custom_label,note")
    .gte("work_date", fromKey)
    .lte("work_date", toKey);

  if(error){
    console.error(error);
    toast("Erreur Supabase: " + (error.message || error.code || ""));
    return;
  }

  (data||[]).forEach(r=>{
    entries.set(r.work_date, {
      status: r.status,
      custom_label: r.custom_label || "",
      note: r.note || ""
    });
  });

  toast(`Chargé: ${(data||[]).length} jour(s)`);
}

/* Save immediately */
async function upsertDay(dateKey, patch){
  if(!user){ toast("Connecte-toi."); return; }

  const cur = entries.get(dateKey) || { status:"", custom_label:"", note:"" };
  const next = { ...cur, ...patch };

  // Optimistic UI
  entries.set(dateKey, next);
  renderMonth(); renderTotals(); setSelected(dateKey);

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
    // revert
    if(cur.status || cur.note || cur.custom_label) entries.set(dateKey, cur);
    else entries.delete(dateKey);
    renderMonth(); renderTotals(); setSelected(dateKey);
    toast("Erreur sauvegarde: " + (error.message || error.code || ""));
    return;
  }
  saveViewState();
}

/* Render */
function renderMonth(){
  grid.innerHTML="";
  navMonth.textContent = MONTHS[viewMonth];
  navYear.textContent  = String(viewYear);

  const { start } = gridRangeForMonth(viewYear, viewMonth);

  for(let week=0; week<6; week++){
    const weekStart = new Date(start);
    weekStart.setDate(start.getDate() + week*7);

    const wn = document.createElement("div");
    wn.className="weeknum";
    wn.textContent = String(isoWeek(weekStart)).padStart(2,"0");
    grid.appendChild(wn);

    for(let i=0;i<7;i++){
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate()+i);
      const k = keyFor(d);

      const cell = document.createElement("div");
      cell.className="day";
      cell.dataset.key=k;

      if(d.getMonth() !== viewMonth) cell.classList.add("out");

      const e = entries.get(k);
      if(e?.status) cell.classList.add(e.status);
      if(k === selectedKey) cell.classList.add("selected");

      cell.textContent = String(d.getDate());

      if(e?.note){
        const dot = document.createElement("div");
        dot.className="dot";
        cell.appendChild(dot);
      }
      if(e?.status==="autre" && e.custom_label){
        const b = document.createElement("div");
        b.className="badge";
        b.textContent = e.custom_label.slice(0,6);
        cell.appendChild(b);
      }

      cell.addEventListener("click", ()=>{
        setSelected(k);
        saveViewState();
      }, {passive:true});

      grid.appendChild(cell);
    }
  }
}

function setSelected(k){
  selectedKey = k;
  const d = parseKey(k);
  const e = entries.get(k);
  const state = e?.status ? LABEL[e.status] : "—";
  const extra = (e?.status==="autre" && e.custom_label) ? ` (${e.custom_label})` : "";

  selDate.textContent = fmtLong(d);
  selState.textContent = `État: ${state}${extra}`;
  sheetTitle.textContent = fmtLong(d);
  sheetSub.textContent = `État actuel: ${state}${extra}`;
  noteText.value = e?.note || "";

  grid.querySelectorAll(".day").forEach(el=>el.classList.remove("selected"));
  const el = grid.querySelector(`.day[data-key="${k}"]`);
  if(el) el.classList.add("selected");
}

function renderTotals(){
  let cJ=0,cN=0,cR=0,cC=0,cA=0;
  const keys = Array.from(entries.keys()).sort();
  for(const k of keys){
    const e = entries.get(k);
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
  totalsEl.appendChild(chip(`Autres: ${cA}`));
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

document.querySelectorAll("[data-set]").forEach(btn=>{
  btn.addEventListener("click", async ()=>{
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

document.getElementById("btnNote").addEventListener("click", ()=>{
  const k = ensureSelected();
  openSheet("note");
});

document.getElementById("btnApplyOther").addEventListener("click", async ()=>{
  const k = ensureSelected();
  let label = otherSelect.value;
  if(label==="custom"){
    label = (otherCustom.value||"").trim();
    if(!label){ toast("Entre un libellé."); return; }
  }
  await upsertDay(k, { status:"autre", custom_label:label });
  closeSheet();
});

document.getElementById("btnSaveNote").addEventListener("click", async ()=>{
  const k = ensureSelected();
  await upsertDay(k, { note:(noteText.value||"").trim() });
  closeSheet();
});
document.getElementById("btnClearNote").addEventListener("click", async ()=>{
  const k = ensureSelected();
  noteText.value="";
  await upsertDay(k, { note:"" });
  closeSheet();
});

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
document.getElementById("btnPrevMonth").addEventListener("click", ()=>changeMonth(-1));
document.getElementById("btnNextMonth").addEventListener("click", ()=>changeMonth(1));
document.getElementById("btnPrevYear").addEventListener("click", ()=>changeYear(-1));
document.getElementById("btnNextYear").addEventListener("click", ()=>changeYear(1));

document.getElementById("btnToday").addEventListener("click", async ()=>{
  const d = getSncfNow();
  viewYear = clampYear(d.getFullYear());
  viewMonth = d.getMonth();
  selectedKey = keyFor(d);
  await reloadView(true);
  saveViewState();
});

/* Export Excel (sur données chargées) */
document.getElementById("btnExportXLSX").addEventListener("click", ()=>{
  const rows = [["Date","Année","Mois","Semaine","Type","Libellé","Note"]];
  const keys = Array.from(entries.keys()).sort();
  for(const k of keys){
    const e = entries.get(k);
    if(!e?.status) continue;
    const d = new Date(k);
    rows.push([k, d.getFullYear(), MONTHS[d.getMonth()], String(isoWeek(d)).padStart(2,"0"),
      LABEL[e.status]||"", e.custom_label||"", e.note||"" ]);
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Planning");
  XLSX.writeFile(wb, `planning_${viewYear}-${pad2(viewMonth+1)}.xlsx`);
});

/* Reload */
async function reloadView(keepSelection){
  await loadGridEntries();
  renderMonth();
  renderTotals();
  if(keepSelection && selectedKey) setSelected(selectedKey);
  else{
    const k = `${viewYear}-${pad2(viewMonth+1)}-01`;
    selectedKey = k;
    setSelected(k);
  }
}

/* Init */
async function init(){
  const restored = restoreViewState();
  if(!restored){
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