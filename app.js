// Variabili globali
let isListening = false;
let isRecording = false;
let emailList = [];
let soundPatterns = [];
let detectedSounds = [];

let audioContext = null;
let analyser = null;
let stream = null;
let animationFrame = null;
let recordedPattern = [];
let wakeLock = null;

// Elementi DOM
const listenBtn = document.getElementById('listenBtn');
const recordBtn = document.getElementById('recordBtn');
const emailInput = document.getElementById('emailInput');
const addEmailBtn = document.getElementById('addEmailBtn');
const emailListEl = document.getElementById('emailList');
const patternListEl = document.getElementById('patternList');
const detectionListEl = document.getElementById('detectionList');
const statusEl = document.getElementById('status');
const audioLevelFill = document.getElementById('audioLevelFill');
const audioLevelText = document.getElementById('audioLevelText');

// Inizializzazione
document.addEventListener('DOMContentLoaded', () => {
    loadData();
    setupEventListeners();
    updateUI();
});

// Event Listeners
function setupEventListeners() {
    listenBtn.addEventListener('click', toggleListening);
    recordBtn.addEventListener('click', toggleRecording);
    addEmailBtn.addEventListener('click', addEmail);
    emailInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addEmail();
    });
}

// Carica dati da localStorage
function loadData() {
    const saved = localStorage.getItem('soundDetectorData');
    if (saved) {
        const data = JSON.parse(saved);
        emailList = data.emailList || [];
        soundPatterns = data.soundPatterns || [];
        updateUI();
    }
}

// Salva dati in localStorage
function saveData() {
    const data = {
        emailList,
        soundPatterns
    };
    localStorage.setItem('soundDetectorData', JSON.stringify(data));
}

// Richiedi permesso microfono
async function requestMicPermission() {
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        setupAudioAnalysis();
        return true;
    } catch (err) {
        alert('Permesso microfono negato. Abilitalo nelle impostazioni del browser.');
        return false;
    }
}

// Setup analisi audio
function setupAudioAnalysis() {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);
    analyser.fftSize = 2048;
}

// Toggle ascolto
async function toggleListening() {
    if (isListening) {
        stopListening();
    } else {
        await startListening();
    }
}

// Avvia ascolto
async function startListening() {
    if (!stream) {
        const granted = await requestMicPermission();
        if (!granted) return;
    }

    if (Notification.permission === 'default') {
        await Notification.requestPermission();
    }

    await requestWakeLock();

    isListening = true;
    statusEl.textContent = 'In ascolto...';
    listenBtn.innerHTML = '<span class="btn-icon">🛑</span> Ferma Ascolto';
    listenBtn.classList.add('active');

    analyzeAudio();
}

// Ferma ascolto
function stopListening() {
    isListening = false;
    statusEl.textContent = 'Inattivo';
    listenBtn.innerHTML = '<span class="btn-icon">🎤</span> Avvia Ascolto';
    listenBtn.classList.remove('active');
    
    if (animationFrame) {
        cancelAnimationFrame(animationFrame);
        animationFrame = null;
    }

    releaseWakeLock();
}

// Toggle registrazione
async function toggleRecording() {
    if (isRecording) {
        savePattern();
    } else {
        await startRecording();
    }
}

// Avvia registrazione
async function startRecording() {
    if (!stream) {
        const granted = await requestMicPermission();
        if (!granted) return;
    }

    recordedPattern = [];
    isRecording = true;
    statusEl.textContent = 'Registrazione in corso...';
    recordBtn.innerHTML = '<span class="btn-icon">💾</span> Salva Pattern';
    recordBtn.classList.add('recording');
    listenBtn.disabled = true;

    analyzeAudio();
}

// Salva pattern
function savePattern() {
    const patternName = prompt('Nome del suono (es. Campanello, Fischio):');
    
    if (!patternName || recordedPattern.length === 0) {
        alert('Registrazione non valida');
        isRecording = false;
        updateUI();
        return;
    }

    const newPattern = {
        id: Date.now(),
        name: patternName,
        data: recordedPattern,
        duration: recordedPattern.length * 50
    };

    soundPatterns.push(newPattern);
    saveData();

    isRecording = false;
    recordedPattern = [];
    statusEl.textContent = 'Pattern salvato!';
    recordBtn.innerHTML = '<span class="btn-icon">⏺️</span> Registra Suono';
    recordBtn.classList.remove('recording');
    listenBtn.disabled = false;

    updateUI();
}

// Analizza audio
function analyzeAudio() {
    if (!analyser) return;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(dataArray);

    const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
    const percentage = Math.min(Math.round(average), 100);
    
    audioLevelFill.style.width = percentage + '%';
    audioLevelText.textContent = percentage + '%';

    if (isRecording) {
        recordedPattern.push({
            frequencies: Array.from(dataArray),
            level: average,
            timestamp: Date.now()
        });
    }

    if (isListening && soundPatterns.length > 0) {
        detectSound(dataArray, average);
    }

    animationFrame = requestAnimationFrame(analyzeAudio);
}

// Rileva suono
function detectSound(currentData, currentLevel) {
    soundPatterns.forEach(pattern => {
        let matchScore = 0;
        let totalComparisons = 0;

        pattern.data.forEach((patternFrame, i) => {
            if (i % 10 === 0) {
                const similarity = compareFrequencies(patternFrame.frequencies, currentData);
                matchScore += similarity;
                totalComparisons++;
            }
        });

        const avgMatch = matchScore / totalComparisons;

        if (avgMatch > 0.85 && currentLevel > 20) {
            triggerNotification(pattern.name);
        }
    });
}

// Confronta frequenze
function compareFrequencies(freq1, freq2) {
    let matches = 0;
    const tolerance = 30;

    for (let i = 0; i < Math.min(freq1.length, freq2.length); i += 5) {
        if (Math.abs(freq1[i] - freq2[i]) < tolerance) {
            matches++;
        }
    }

    return matches / (Math.min(freq1.length, freq2.length) / 5);
}

// Notifica
function triggerNotification(soundName) {
    const now = Date.now();
    const lastDetection = detectedSounds[detectedSounds.length - 1];

    if (lastDetection && now - lastDetection.timestamp < 5000) return;

    const detection = {
        sound: soundName,
        timestamp: now,
        time: new Date().toLocaleTimeString('it-IT')
    };

    detectedSounds.push(detection);
    updateDetectionList();

    if (Notification.permission === 'granted') {
        new Notification('🔔 Suono Rilevato!', {
            body: `Rilevato: ${soundName}`,
            icon: '🔔'
        });
    }

    sendEmailNotifications(soundName);
}

// Invia email (simulato)
function sendEmailNotifications(soundName) {
    emailList.forEach(email => {
        console.log(`📧 Email inviata a ${email}: Rilevato "${soundName}" alle ${new Date().toLocaleTimeString('it-IT')}`);
    });
}

// Wake Lock
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
        }
    } catch (err) {
        console.log('Wake Lock non supportato');
    }
}

function releaseWakeLock() {
    if (wakeLock) {
        wakeLock.release();
        wakeLock = null;
    }
}

// Gestione Email
function addEmail() {
    const email = emailInput.value.trim();
    
    if (!email || !email.includes('@')) {
        alert('Inserisci un indirizzo email valido');
        return;
    }
    
    if (emailList.includes(email)) {
        alert('Email già presente');
        return;
    }

    emailList.push(email);
    emailInput.value = '';
    saveData();
    updateUI();
}

function removeEmail(email) {
    emailList = emailList.filter(e => e !== email);
    saveData();
    updateUI();
}

function removePattern(patternId) {
    soundPatterns = soundPatterns.filter(p => p.id !== patternId);
    saveData();
    updateUI();
}

// Aggiorna UI
function updateUI() {
    updateEmailList();
    updatePatternList();
    updateDetectionList();
}

function updateEmailList() {
    if (emailList.length === 0) {
        emailListEl.innerHTML = '<div class="empty-state">Nessuna email configurata</div>';
        return;
    }

    emailListEl.innerHTML = emailList.map(email => `
        <div class="list-item">
            <div class="list-item-content">
                <div class="list-item-title">${email}</div>
            </div>
            <button class="list-item-remove" onclick="removeEmail('${email}')">✕</button>
        </div>
    `).join('');
}

function updatePatternList() {
    if (soundPatterns.length === 0) {
        patternListEl.innerHTML = '<div class="empty-state">Nessun pattern registrato</div>';
        return;
    }

    patternListEl.innerHTML = soundPatterns.map(pattern => `
        <div class="list-item">
            <div class="list-item-content">
                <div class="list-item-title">${pattern.name}</div>
                <div class="list-item-subtitle">${(pattern.duration / 1000).toFixed(1)}s</div>
            </div>
            <button class="list-item-remove" onclick="removePattern(${pattern.id})">✕</button>
        </div>
    `).join('');
}

function updateDetectionList() {
    if (detectedSounds.length === 0) {
        detectionListEl.innerHTML = '<div class="empty-state">Nessun suono rilevato ancora</div>';
        return;
    }

    const recent = detectedSounds.slice(-10).reverse();
    detectionListEl.innerHTML = recent.map(detection => `
        <div class="list-item">
            <div class="list-item-content">
                <div class="list-item-title">${detection.sound}</div>
                <div class="list-item-subtitle">${detection.time}</div>
            </div>
        </div>
    `).join('');
}

// Cleanup
window.addEventListener('beforeunload', () => {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
    }
    if (audioContext) {
        audioContext.close();
    }
});
