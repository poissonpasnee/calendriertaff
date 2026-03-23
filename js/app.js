import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// --- CONFIGURATION ---
// REMPLACEZ PAR VOS CLÉS SUPABASE
const SUPABASE_URL = 'VOTRE_URL_SUPABASE'; 
const SUPABASE_KEY = 'VOTRE_CLE_ANON_SUPABASE';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- ÉTAT GLOBAL ---
let currentDate = new Date();
let selectedDateStr = null;
let user = null;

// Taux (Exemples, à personnaliser)
const RATES = { jour: 150, nuit: 180, mn: 40 };

// --- INITIALISATION ---
document.addEventListener('DOMContentLoaded', async () => {
    await checkAuth();
    if (user) {
        renderCalendar();
        setupEventListeners();
    }
});

// --- AUTHENTIFICATION ---
async function checkAuth() {
    const { data: { user: currentUser }, error } = await supabase.auth.getUser();
    if (error || !currentUser) {
        // Pour le test local, on peut simuler un user ou rediriger vers login
        // Ici, on suppose que l'utilisateur est déjà connecté via magic link ou autre
        console.warn("Utilisateur non connecté. Mode démo ou redirection nécessaire.");
        document.getElementById('user-display').textContent = "Non connecté";
        return;
    }
    user = currentUser;
    document.getElementById('user-display').textContent = user.email.split('@')[0];
}

// --- CALENDRIER ---
function renderCalendar() {
    const grid = document.getElementById('calendar-grid');
    grid.innerHTML = '';
    
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    
    document.getElementById('current-month-label').textContent = 
        new Date(year, month).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

    const firstDay = new Date(year, month, 1).getDay(); // 0 = Dimanche
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    // Ajustement pour commencer par Lundi (optionnel, ici on garde Dimanche=0 pour simple)
    // Pour commencer Lundi: const offset = (firstDay === 0) ? 6 : firstDay - 1;
    
    const today = new Date();

    for (let i = 0; i < firstDay; i++) {
        grid.innerHTML += `<div class="day-cell" style="visibility:hidden"></div>`;
    }

    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const isToday = (d === today.getDate() && month === today.getMonth() && year === today.getFullYear());
        
        const cell = document.createElement('div');
        cell.className = `day-cell ${isToday ? 'today' : ''}`;
        cell.dataset.date = dateStr;
        
        cell.innerHTML = `
            <span class="day-number">${d}</span>
            <span class="day-code" id="code-${dateStr}"></span>
        `;
        
        cell.addEventListener('click', () => selectDay(dateStr, cell));
        grid.appendChild(cell);
    }
}

// --- SÉLECTION JOUR & AFFICHAGE NOTE ---
async function selectDay(dateStr, cellElement) {
    selectedDateStr = dateStr;

    // UI Sélection
    document.querySelectorAll('.day-cell').forEach(c => c.classList.remove('selected'));
    if(cellElement) cellElement.classList.add('selected');

    // Reset UI Détails
    document.getElementById('no-selection-msg').style.display = 'none';
    document.getElementById('note-detail-container').classList.add('hidden');
    
    // 1. Calculer le salaire (Simulation basée sur le code présent dans la case)
    // Dans votre version réelle, vous lisez la donnée en base ou en mémoire
    const code = document.getElementById(`code-${dateStr}`)?.textContent || '';
    calculateSalaryForDay(code);

    // 2. Charger et afficher la note
    await loadAndShowNote(dateStr);
}

function calculateSalaryForDay(code) {
    // Logique simplifiée pour l'exemple
    let countJ = 0, countN = 0, countMN = 0;
    
    if (code.startsWith('J')) countJ = 1;
    if (code.startsWith('N')) countN = 1;
    // Logique MN complexe à ajouter ici selon vos règles
    
    document.getElementById('count-jour').textContent = countJ;
    document.getElementById('count-nuit').textContent = countN;
    document.getElementById('count-mn').textContent = countMN;
    
    const total = (countJ * RATES.jour) + (countN * RATES.nuit) + (countMN * RATES.mn);
    document.getElementById('total-salary').textContent = `${total.toFixed(2)} €`;
}

async function loadAndShowNote(dateStr) {
    const container = document.getElementById('note-detail-container');
    const dateDisplay = document.getElementById('note-date-display');
    const contentDisplay = document.getElementById('note-content-display');
    
    // Format date
    const options = { weekday: 'long', day: 'numeric', month: 'long' };
    dateDisplay.textContent = new Date(dateStr).toLocaleDateString('fr-FR', options);

    try {
        const { data, error } = await supabase
            .from('work_calendar_entries')
            .select('note, status, custom_label') // Récupérer aussi le code pour l'afficher
            .eq('user_id', user.id)
            .eq('work_date', dateStr)
            .single();

        if (error && error.code !== 'PGRST116') { // PGRST116 = No rows found
            console.error('Erreur chargement note:', error);
            return;
        }

        if (data && data.note) {
            contentDisplay.textContent = data.note;
            container.classList.remove('hidden');
            
            // Optionnel : Mettre à jour le code affiché dans le calendrier si présent en base
            if(data.status || data.custom_label) {
                 const codeEl = document.getElementById(`code-${dateStr}`);
                 if(codeEl) codeEl.textContent = data.custom_label || data.status;
            }
        } else {
            container.classList.add('hidden');
        }
    } catch (err) {
        console.error('Erreur inattendue:', err);
    }
}

// --- GESTION DES NOTES (SAVE/EDIT/DELETE) ---

function openNoteModal(existingNote = '') {
    if (!selectedDateStr) return;
    
    const modal = document.getElementById('modal-note');
    const input = document.getElementById('note-input');
    const dateTitle = document.getElementById('modal-note-date');
    
    input.value = existingNote;
    dateTitle.textContent = new Date(selectedDateStr).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    
    modal.classList.remove('hidden');
    document.getElementById('modal-overlay').classList.remove('hidden');
}

async function saveNote() {
    const noteText = document.getElementById('note-input').value.trim();
    if (!selectedDateStr || !user) return;

    const btn = document.getElementById('save-note-btn');
    btn.textContent = '...';
    btn.disabled = true;

    try {
        // Upsert : Insert ou Update si conflit (user_id, work_date)
        // Assurez-vous d'avoir une contrainte UNIQUE sur (user_id, work_date) dans Supabase
        const { error } = await supabase
            .from('work_calendar_entries')
            .upsert({
                user_id: user.id,
                work_date: selectedDateStr,
                note: noteText,
                // Si la ligne n'existe pas, on peut mettre un status par défaut sinon on ne touche pas
                // Note: upsert avec partial data peut nécessiter de récupérer l'existant d'abord selon config RLS
            }, { onConflict: 'user_id,work_date' });

        if (error) throw error;

        // Mise à jour UI immédiate
        const container = document.getElementById('note-detail-container');
        const contentDisplay = document.getElementById('note-content-display');
        
        if (noteText) {
            contentDisplay.textContent = noteText;
            container.classList.remove('hidden');
            // Ajouter un indicateur visuel sur la case du calendrier
            const cell = document.querySelector(`.day-cell[data-date="${selectedDateStr}"]`);
            if(cell) cell.classList.add('has-note');
        } else {
            container.classList.add('hidden');
             const cell = document.querySelector(`.day-cell[data-date="${selectedDateStr}"]`);
            if(cell) cell.classList.remove('has-note');
        }

        closeModal();
    } catch (err) {
        // Fallback si la colonne 'note' ou la contrainte pose problème
        console.error("Échec sauvegarde (tentative fallback):", err);
        alert("Erreur de synchronisation. La note n'a pas été sauvegardée.");
    } finally {
        btn.textContent = 'Enregistrer';
        btn.disabled = false;
    }
}

async function deleteNote() {
    if (!confirm("Supprimer cette note ?")) return;
    if (!selectedDateStr || !user) return;

    try {
        const { error } = await supabase
            .from('work_calendar_entries')
            .update({ note: null })
            .eq('user_id', user.id)
            .eq('work_date', selectedDateStr);

        if (error) throw error;

        document.getElementById('note-detail-container').classList.add('hidden');
        const cell = document.querySelector(`.day-cell[data-date="${selectedDateStr}"]`);
        if(cell) cell.classList.remove('has-note');
        
        closeModal();
    } catch (err) {
        console.error("Erreur suppression:", err);
    }
}

// --- UTILITAIRES ---
function closeModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
}

function setupEventListeners() {
    // Navigation Mois
    document.getElementById('prev-month').addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() - 1);
        renderCalendar();
    });
    document.getElementById('next-month').addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() + 1);
        renderCalendar();
    });

    // Dock Actions
    document.querySelectorAll('.dock-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!selectedDateStr) {
                alert("Veuillez d'abord sélectionner un jour dans le calendrier.");
                return;
            }
            const type = btn.dataset.type;
            if (type === 'NOTE') {
                // Ouvrir modale avec note existante si présente
                const currentNote = document.getElementById('note-content-display').textContent;
                // Si le conteneur est caché, c'est qu'il n'y a pas de note
                const isEmpty = document.getElementById('note-detail-container').classList.contains('hidden');
                openNoteModal(isEmpty ? '' : currentNote);
            }
            // Ajouter les autres cas (J, N, R, etc.) ici
        });
    });

    // Modale Note
    document.getElementById('save-note-btn').addEventListener('click', saveNote);
    document.getElementById('cancel-note-btn').addEventListener('click', closeModal);
    document.getElementById('close-note-btn').addEventListener('click', () => {
        document.getElementById('note-detail-container').classList.add('hidden');
    });
    document.getElementById('edit-note-btn').addEventListener('click', () => {
        const current = document.getElementById('note-content-display').textContent;
        openNoteModal(current);
    });
    document.getElementById('delete-note-btn').addEventListener('click', deleteNote);

    // Overlay click to close
    document.getElementById('modal-overlay').addEventListener('click', (e) => {
        if (e.target.id === 'modal-overlay') closeModal();
    });
    
    // Import (Skeleton)
    document.getElementById('fab-import').addEventListener('click', () => {
        document.getElementById('modal-import').classList.remove('hidden');
        document.getElementById('modal-overlay').classList.remove('hidden');
    });
    document.getElementById('close-import-btn').addEventListener('click', closeModal);
}