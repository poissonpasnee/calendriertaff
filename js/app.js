import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// --- CONFIGURATION ---
const SUPABASE_URL = "https://dstmyvzjirgyuwuojwnk.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRzdG15dnpqaXJneXV3dW9qd25rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk3NzY4NTUsImV4cCI6MjA4NTM1Mjg1NX0.Cl6WAvK0elHkKXnXRtrFFiBlGABnK5RTFdawq3NGDJk";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// --- ÉTAT GLOBAL ---
let user = null;
let entries = new Map();
let state = { year: 2026, month: 0, selected: null };
let prefs = { 
  theme: 'light', 
  quickTap: false, 
  confirmLogout: true,
  // Règles de paie par défaut (modifiables)
  rateDay: 35,
  rateNightFull: 82,
  rateNightSolo: 41,
  rateHour: 13.80,
  payrollShift: false // Mode M+1
};
let cellCache = new Map();

const MONTHS = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
const LABELS = { jour:"Jour", nuit:"Nuit", repos:"Repos", conges:"Congés", autre:"Autre" };

// --- UTILITAIRES ---
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const parseKey = (k) => { const [y,m,d] = k.split('-').map(Number); return new Date(y, m-1, d); };
const keyFor = (d) => `$${d.getFullYear()}-$${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

// --- CALCUL SALAIRE ---
function calculateDailyEarnings(dateKey, status) {
  if (!status) return 0;
  
  const date = parseKey(dateKey);
  const dayOfWeek = date.getDay(); // 0 = Dimanche
  const isSunday = (dayOfWeek === 0);
  const isHoliday = false; // À implémenter si liste des fériés disponible

  let earnings = 0;

  // Logique basée sur vos règles
  if (status === 'jour') {
    // Jour travaillé : Indemnité locale (~35€) + Taux horaire (si on veut affiner)
    // On utilise ici le forfait journalier que vous avez donné
    earnings = prefs.rateDay; 
    if (isSunday) earnings *= 1.5; // Exemple majoration dimanche (à ajuster)
  } 
  else if (status === 'nuit') {
    // Nuit : Grand déplacement (82€) ou Découcher seul (41€)
    // On suppose Grand Déplacement par défaut si > 1 nuit dans la semaine (logique simplifiée)
    // Ici on prend la valeur "Nuit Complète" configurée
    earnings = prefs.rateNightFull;
  }
  else if (status === 'autre') {
    // Vérifier si c'est un férié travaillé (à affiner avec le label)
    const entry = entries.get(dateKey);
    if (entry && entry.custom_label === 'Férié') {
      earnings = prefs.rateDay * 2; // Exemple férié doublé
    }
  }
  
  // Repos et Congés = 0€ de primes journalières (salaire de base lissé ailleurs)
  
  return earnings;
}

function calculateMonthSalary(year, month) {
  let total = 0;
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);
  
  let current = new Date(start);
  while (current <= end) {
    const k = keyFor(current);
    const entry = entries.get(k);
    if (entry && entry.status) {
      total += calculateDailyEarnings(k, entry.status);
    }
    current.setDate(current.getDate() + 1);
  }
  
  // Ajout estimation Salaire de base (lissé)
  // 2093.06 / 30 jours * jours travaillés ? Ou fixe mensuel ?
  // Ici on ajoute le fixe complet si l'utilisateur le souhaite, ou on ne montre que les variables.
  // Pour l'instant, on affiche le TOTAL VARIABLE (Primes) + Base fixe.
  total += 2093.06; 
  
  return total;
}

// --- INITIALISATION ---
async function init() {
  loadLocalData();
  applyPrefs();
  renderGrid(); 
  updateSelectionUI();
  renderTotals(); // Inclut le salaire
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
  $('togQuickTap').checked = prefs.quickTap;
  $('togConfirmLogout').checked = prefs.confirmLogout;
  $('togPayrollShift').checked = prefs.payrollShift;
  
  // Remplir les champs de taux
  $('rateDay').value = prefs.rateDay;
  $('rateNightFull').value = prefs.rateNightFull;
  $('rateNightSolo').value = prefs.rateNightSolo;
  $('rateHour').value = prefs.rateHour;
  
  $('themeLight').classList.toggle('active', prefs.theme === 'light');
  $('themeDark').classList.toggle('active', prefs.theme === 'dark');
}

// --- AUTHENTIFICATION ---
async function checkAuth() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data?.session) {
    user = null;
    $('topSub').textContent = "Invité";
    $('gate').classList.add('show');
    return;
  }
  user = data.session.user;
  $('topSub').textContent = user.email.split('@')[0];
  $('gate').classList.remove('show');
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
  data.forEach(r => entries.set(r.work_date, { status: r.status, note: r.note, custom_label: r.custom_label }));
}

// --- RENDU GRILLE ---
function renderGrid() {
  const grid = $('grid');
  grid.innerHTML = '';
  cellCache.clear();
  
  // Gestion du décalage M+1 pour l'affichage du titre
  let displayYear = state.year;
  let displayMonth = state.month;
  
  if (prefs.payrollShift) {
    // Si on veut voir ce qui sera payé ce mois-ci (donc travail du mois précédent)
    displayMonth--;
    if (displayMonth < 0) { displayMonth = 11; displayYear--; }
  }

  $('navMonth').textContent = MONTHS[displayMonth] + (prefs.payrollShift ? ' (N-1)' : '');
  $('navYear').textContent = displayYear;
  
  const headers = ["Di/Lu", "Lu/Ma", "Ma/Me", "Me/Je", "Je/Ve", "Ve/Sa", "Sa/Di"];
  for(let i=0; i<7; i++) {
    const el = $$(`h$${i}`);
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
