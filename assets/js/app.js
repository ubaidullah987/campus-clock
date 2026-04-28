lucide.createIcons();

// ==========================================
// SUPABASE INITIALIZATION
// ==========================================
// Pulling credentials from the ignored config.js file securely
const supabaseClient = window.supabase.createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_KEY);
// ==========================================

const state = {
    modelsLoaded: false,
    registeredFaces: [],      // FaceAPI Mappings (label = student_id)
    dbStudentsMap: [],        // Raw Supabase array
    allLogsMap: [],           // Raw Attendance Logs
    campus: { lat: 28.6139, lon: 77.2090, radius: 100 }, 
    currentLocation: null,
    videoStream: null,
    chartInstance: null,       // Chart.js Object
    activeStudentId: null      // For WhatsApp messaging
};

let map, campusMarker, campusCircle;

const video = document.getElementById('webcam');
const overlay = document.getElementById('overlay');
const adminVideo = document.getElementById('admin-webcam');
const adminOverlay = document.getElementById('admin-overlay');

const clockInBtn = document.getElementById('clockInBtn');
const registerBtn = document.getElementById('registerBtn');
const geoStatusEl = document.getElementById('geo-status');

// --- Clock Engine ---
setInterval(() => {
    const now = new Date();
    document.getElementById('time-display').innerText = now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    document.getElementById('date-display').innerText = now.toLocaleDateString(undefined, {weekday: 'long', month: 'long', day: 'numeric'});
}, 1000);

// --- Notifications ---
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `flex items-center gap-3 px-4 py-3 rounded-lg shadow-floating border text-sm font-medium fade-in pointer-events-auto transition-all duration-300 transform translate-y-0`;
    
    if (type === 'success') {
        toast.classList.add('bg-white', 'border-border', 'text-primary');
        toast.innerHTML = `<i data-lucide="check-circle-2" class="w-4 h-4 text-emerald-600"></i> ${message}`;
    } else if (type === 'error') {
        toast.classList.add('bg-red-50', 'border-red-200', 'text-red-900');
        toast.innerHTML = `<i data-lucide="alert-circle" class="w-4 h-4 text-red-600"></i> ${message}`;
    } else {
        toast.classList.add('bg-primary', 'border-primary', 'text-white');
        toast.innerHTML = `<i data-lucide="info" class="w-4 h-4 text-zinc-400"></i> ${message}`;
    }
    container.appendChild(toast);
    lucide.createIcons();
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateY(-10px)'; setTimeout(() => toast.remove(), 300); }, 4000);
}

// --- Voice & Banner System ---
function speakMessage(text) {
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const msg = new SpeechSynthesisUtterance(text);
        msg.rate = 0.95; 
        msg.pitch = 1.1; 
        
        const voices = window.speechSynthesis.getVoices();
        let preferredVoice = voices.find(v => v.lang.startsWith('en') && (
            v.name.toLowerCase().includes('female') || v.name === 'Samantha' || v.name === 'Victoria' || v.name === 'Karen' || v.name === 'Tessa' || v.name === 'Google UK English Female' || v.name === 'Microsoft Zira - English (United States)'
        ));
        
        if (!preferredVoice) preferredVoice = voices.find(v => v.lang.startsWith('en'));
        if (preferredVoice) msg.voice = preferredVoice;
        
        window.speechSynthesis.speak(msg);
    }
}

function triggerBanner(title, message, type = 'success') {
    const banner = document.getElementById('dynamic-banner');
    const titleEl = document.getElementById('banner-title');
    const msgEl = document.getElementById('banner-message');
    const iconContainer = document.getElementById('banner-icon-container');
    
    titleEl.innerText = title; msgEl.innerText = message;
    banner.className = `fixed top-6 left-1/2 z-[9999] transition-all duration-500 ease-out text-white px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-4 banner-exit w-[90%] max-w-sm border`;
    
    if (type === 'success') {
        banner.classList.add('bg-emerald-600', 'border-emerald-700');
        iconContainer.innerHTML = '<i data-lucide="check" class="w-5 h-5 text-emerald-600"></i>';
        iconContainer.className = 'bg-white p-2.5 rounded-full shrink-0 shadow-sm';
        titleEl.className = 'text-emerald-100 text-[10px] font-bold uppercase tracking-widest mb-0.5';
    } else if (type === 'warning') {
        banner.classList.add('bg-amber-500', 'border-amber-600');
        iconContainer.innerHTML = '<i data-lucide="alert-circle" class="w-5 h-5 text-amber-600"></i>';
        iconContainer.className = 'bg-white p-2.5 rounded-full shrink-0 shadow-sm';
        titleEl.className = 'text-amber-100 text-[10px] font-bold uppercase tracking-widest mb-0.5';
    } else {
        banner.classList.add('bg-red-600', 'border-red-700');
        iconContainer.innerHTML = '<i data-lucide="alert-triangle" class="w-5 h-5 text-red-600"></i>';
        iconContainer.className = 'bg-white p-2.5 rounded-full shrink-0 shadow-sm';
        titleEl.className = 'text-red-100 text-[10px] font-bold uppercase tracking-widest mb-0.5';
    }
    
    lucide.createIcons();
    banner.classList.remove('hidden');
    setTimeout(() => {
        banner.classList.remove('banner-exit'); banner.classList.add('banner-enter');
        setTimeout(() => { banner.classList.remove('banner-enter'); banner.classList.add('banner-exit'); }, 4000);
    }, 50);
}

// --- CORE LOAD & CLOUD FETCH ---
async function loadModels() {
    const MODEL_URL = 'https://unpkg.com/@vladmandic/face-api/model/';
    try {
        if ('speechSynthesis' in window) window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();

        await Promise.all([
            faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
            faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
            faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
        ]);
        
        state.modelsLoaded = true;
        const loader = document.getElementById('loading-screen');
        loader.style.opacity = "0";
        setTimeout(() => loader.classList.add('hidden'), 500);
        
        await startCamera();
        
        await fetchCampusData();
        await fetchSupabaseData(); 
        
        startLocationTracking();

    } catch (err) {
        document.getElementById('loading-screen').classList.add('hidden');
        showToast("Error loading AI. Ensure Adblockers are disabled.", "error");
    }
}

async function fetchSupabaseData() {
    try {
        const { data: students, error: err1 } = await supabaseClient.from('students').select('*').order('name');
        if (err1) throw err1;

        state.dbStudentsMap = students; 
        state.registeredFaces = students.map(record => {
            const descArray = new Float32Array(record.descriptor);
            return new faceapi.LabeledFaceDescriptors(record.id.toString(), [descArray]);
        });

        document.getElementById('cloud-indicator-kiosk').classList.replace('border-white/10', 'border-emerald-500/50');
        document.getElementById('cloud-dot').classList.replace('bg-yellow-400', 'bg-emerald-500');
        document.getElementById('cloud-text').innerText = "System Online";
        
        updateRosterTable();
        renderLogsStudentList(); 

        await refreshAllLogs();

    } catch (error) {
        document.getElementById('cloud-indicator-kiosk').classList.replace('border-white/10', 'border-red-500/50');
        document.getElementById('cloud-dot').classList.replace('bg-yellow-400', 'bg-red-500');
        document.getElementById('cloud-text').innerText = "Sync Failed";
        if(error.code === '42P01') showToast("Please run the SQL script to create the new tables including 'mobile_no'.", "error");
    }
}

async function refreshAllLogs() {
     try {
        const { data, error } = await supabaseClient.from('attendance_logs').select('*').order('created_at', { ascending: false });
        if(!error) state.allLogsMap = data || [];
     } catch(e) { console.error("Logs fetch failed", e); }
}

async function fetchCampusData() {
    try {
        const { data, error } = await supabaseClient.from('campus_settings').select('*').eq('id', 1).single();
        if (data && !error) {
            state.campus = { lat: data.lat, lon: data.lon, radius: data.radius };
            document.getElementById('campusRadius').value = data.radius;
        }
    } catch (err) {}
}

// --- Camera & Location ---
async function startCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
        state.videoStream = stream;
        video.srcObject = stream;
        adminVideo.srcObject = stream;
        
        video.onloadedmetadata = () => video.play();
        adminVideo.onloadedmetadata = () => adminVideo.play();
        
    } catch (err) { 
        try {
            const fallbackStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            state.videoStream = fallbackStream;
            video.srcObject = fallbackStream;
            adminVideo.srcObject = fallbackStream;
            video.onloadedmetadata = () => video.play();
            adminVideo.onloadedmetadata = () => adminVideo.play();
        } catch (fallbackErr) {
            showToast("Camera access required.", "error"); 
        }
    }
}

function startLocationTracking() {
    if ("geolocation" in navigator) {
        navigator.geolocation.watchPosition(
            (position) => {
                state.currentLocation = { lat: position.coords.latitude, lon: position.coords.longitude };
                checkGeofence();
            },
            (err) => { geoStatusEl.innerHTML = "<span class='text-red-500 font-semibold'>Location Denied</span>"; },
            { enableHighAccuracy: true, maximumAge: 10000, timeout: 5000 }
        );
    }
}

function checkGeofence() {
    if (!state.currentLocation) return;
    const R = 6371e3;
    const lat1 = state.currentLocation.lat * Math.PI/180;
    const lat2 = state.campus.lat * Math.PI/180;
    const dLat = (state.campus.lat - state.currentLocation.lat) * Math.PI/180;
    const dLon = (state.campus.lon - state.currentLocation.lon) * Math.PI/180;

    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon/2) * Math.sin(dLon/2);
    const dist = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));

    if (dist <= state.campus.radius) {
        geoStatusEl.innerHTML = `<span class="text-emerald-600 font-bold flex items-center gap-1.5"><div class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div> Verified Area (${dist}m)</span>`;
        clockInBtn.disabled = false;
    } else {
        geoStatusEl.innerHTML = `<span class="text-red-500 font-bold flex items-center gap-1.5"><div class="w-2 h-2 rounded-full bg-red-500"></div> Out of Bounds (${dist}m)</span>`;
        clockInBtn.disabled = true;
    }
}

// --- Map Engine ---
function initMap() {
    if (map) { map.invalidateSize(); return; } 
    map = L.map('admin-map', { zoomControl: false }).setView([state.campus.lat, state.campus.lon], 17);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(map);

    const customIcon = L.divIcon({
        className: 'custom-div-icon',
        html: "<div style='background-color:#09090B; width:14px; height:14px; border-radius:50%; border:2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.2);'></div>",
        iconSize: [14, 14], iconAnchor: [7, 7]
    });

    campusMarker = L.marker([state.campus.lat, state.campus.lon], {draggable: true, icon: customIcon}).addTo(map);
    campusCircle = L.circle([state.campus.lat, state.campus.lon], {
        color: '#09090B', fillColor: '#09090B', fillOpacity: 0.05, radius: state.campus.radius, weight: 1, dashArray: "4 4"
    }).addTo(map);

    campusMarker.on('dragend', function() { updateCampusState(campusMarker.getLatLng().lat, campusMarker.getLatLng().lng, state.campus.radius, true); showToast("Moved locally. Save to apply.", "info"); });
    map.on('click', function(e) { updateCampusState(e.latlng.lat, e.latlng.lng, state.campus.radius, true); showToast("Moved locally. Save to apply.", "info"); });
    setTimeout(() => { map.invalidateSize(); }, 200);
}

function updateCampusState(lat, lon, radius, isFromMap = false) {
    state.campus.lat = parseFloat(lat); state.campus.lon = parseFloat(lon); state.campus.radius = parseFloat(radius);
    document.getElementById('map-lat-lon').innerHTML = `Lat: ${state.campus.lat.toFixed(5)}<br>Lon: ${state.campus.lon.toFixed(5)}`;
    if(map && campusMarker && campusCircle) {
        campusMarker.setLatLng([state.campus.lat, state.campus.lon]);
        campusCircle.setLatLng([state.campus.lat, state.campus.lon]);
        campusCircle.setRadius(state.campus.radius);
        if(!isFromMap) map.setView([state.campus.lat, state.campus.lon], 17);
    }
    checkGeofence();
}

function updateCampusFromRadiusInput() { updateCampusState(state.campus.lat, state.campus.lon, document.getElementById('campusRadius').value || 100, false); showToast("Radius updated locally.", "info"); }
function centerMapOnCurrentLocation() {
    if (state.currentLocation) { updateCampusState(state.currentLocation.lat, state.currentLocation.lon, document.getElementById('campusRadius').value, false); showToast("Previewing GPS.", "info"); } 
    else { showToast("GPS lock not acquired.", "error"); }
}
async function saveCampusToCloud() {
    try {
        const { error } = await supabaseClient.from('campus_settings').upsert({ id: 1, lat: state.campus.lat, lon: state.campus.lon, radius: state.campus.radius });
        if (error) throw error;
        showToast("Campus boundary saved securely.", "success");
    } catch (err) { showToast("Save failed.", "error"); }
}

// --- Biometric Engine & Registration ---
function drawFaceBox(detection, label = "", isKiosk = true) {
    const targetVideo = isKiosk ? video : adminVideo;
    const targetOverlay = isKiosk ? overlay : adminOverlay;
    
    if (!targetVideo.videoWidth || !targetVideo.videoHeight) return;
    
    const displaySize = { width: targetVideo.videoWidth, height: targetVideo.videoHeight };
    faceapi.matchDimensions(targetOverlay, displaySize);
    const resizedDetection = faceapi.resizeResults(detection, displaySize);
    const ctx = targetOverlay.getContext('2d'); ctx.clearRect(0, 0, targetOverlay.width, targetOverlay.height);
    
    const isError = label === 'Rejected' || label === 'Unknown' || label.includes('Duplicate') || label === 'Already Registered';
    const color = isError ? '#EF4444' : '#09090B'; 
    
    const drawBox = new faceapi.draw.DrawBox(resizedDetection.detection.box, { 
        label: label, lineWidth: 3, boxColor: color, drawLabelOptions: { fontColor: '#FFFFFF', backgroundColor: color, padding: 6, fontSize: 14 }
    });
    drawBox.draw(targetOverlay);
    setTimeout(() => { ctx.clearRect(0, 0, targetOverlay.width, targetOverlay.height); }, 3000);
}

function toggleFullScreenLayout(isFullScreen) {
    const cameraPanel = document.getElementById('camera-panel');
    const controlsPanel = document.getElementById('controls-panel');
    
    if (cameraPanel && controlsPanel) {
        if (isFullScreen) {
            cameraPanel.classList.add('hidden');
            controlsPanel.classList.remove('md:w-1/2', 'lg:w-[45%]');
        } else {
            cameraPanel.classList.remove('hidden');
            controlsPanel.classList.add('md:w-1/2', 'lg:w-[45%]');
        }
    }
}

async function registerFace() {
    const nameEl = document.getElementById('regName') || document.getElementById('studentName');
    const name = nameEl ? nameEl.value.trim() : '';
    const mobileEl = document.getElementById('regMobile');
    const mobile = mobileEl ? mobileEl.value.trim() : '';
    const rollNoEl = document.getElementById('regRoll');
    const rollNo = rollNoEl ? rollNoEl.value.trim() : '';
    const streamEl = document.getElementById('regStream');
    const stream = streamEl ? streamEl.value : '';
    const semEl = document.getElementById('regSem');
    const sem = semEl ? semEl.value.trim() : '';

    if (!name || !rollNo || !stream || !sem || !mobile) { showToast("All fields are required.", "error"); return; }
    
    const rollExists = state.dbStudentsMap.some(s => s.roll_no.toLowerCase() === rollNo.toLowerCase());
    if (rollExists) {
        triggerBanner("Duplicate Entry", `Roll No ${rollNo} already exists.`, "warning");
        speakMessage(`Registration failed. Roll number ${rollNo} is already registered.`);
        return;
    }

    if (adminVideo && (adminVideo.paused || adminVideo.readyState !== 4)) {
        await adminVideo.play().catch(e=>console.log(e));
    }

    if(registerBtn) {
        registerBtn.innerHTML = `<div class="spinner white w-4 h-4 mr-2"></div> Scanning...`;
        registerBtn.disabled = true;
    }

    try {
        const detection = await faceapi.detectSingleFace(adminVideo).withFaceLandmarks().withFaceDescriptor();
        if (!detection) { 
            showToast("Face not detected. Ensure video feed is active and look at the camera.", "error"); 
            if(registerBtn) {
                registerBtn.innerHTML = `<i data-lucide="focus" class="w-4 h-4 text-white"></i> Scan & Encrypt Identity`;
                registerBtn.disabled = false;
            }
            lucide.createIcons();
            return; 
        }

        if (state.registeredFaces.length > 0) {
            const faceMatcher = new faceapi.FaceMatcher(state.registeredFaces, 0.5);
            const match = faceMatcher.findBestMatch(detection.descriptor);
            if (match.label !== 'unknown') {
                const existingStudent = state.dbStudentsMap.find(s => s.id.toString() === match.label);
                const existingName = existingStudent ? existingStudent.name : "another student";
                
                triggerBanner("Face Exists", `Face already registered to ${existingName}`, "error");
                speakMessage(`Registration failed. This face is already registered to ${existingName}.`);
                drawFaceBox(detection, "Already Registered", false);
                if(registerBtn) {
                    registerBtn.innerHTML = `<i data-lucide="focus" class="w-4 h-4 text-white"></i> Scan & Encrypt Identity`;
                    registerBtn.disabled = false;
                }
                lucide.createIcons();
                return;
            }
        }

        const descriptorArray = Array.from(detection.descriptor);
        const { data, error } = await supabaseClient.from('students').insert([{ 
            name: name, mobile_no: mobile, roll_no: rollNo, stream: stream, sem: sem, descriptor: descriptorArray 
        }]);
        
        if (error) {
            if (error.code === '23505') { triggerBanner("Duplicate Entry", `Roll No already in database.`, "error"); }
            else { throw error; }
        } else {
            if(document.getElementById('regName')) document.getElementById('regName').value = '';
            if(document.getElementById('studentName')) document.getElementById('studentName').value = '';
            if(document.getElementById('regMobile')) document.getElementById('regMobile').value = '';
            if(document.getElementById('regRoll')) document.getElementById('regRoll').value = '';
            if(document.getElementById('regStream')) document.getElementById('regStream').value = '';
            if(document.getElementById('regSem')) document.getElementById('regSem').value = '';
            
            triggerBanner("Onboarded", `${name} successfully enrolled.`, "success");
            speakMessage(`Identity successfully registered for ${name}.`);
            drawFaceBox(detection, "Secured", false);
            
            await fetchSupabaseData(); 
        }
    } catch (err) { showToast("Failed to save to cloud.", "error"); console.error(err); }
    
    if(registerBtn) {
        registerBtn.innerHTML = `<i data-lucide="focus" class="w-4 h-4 text-white"></i> Scan & Encrypt Identity`;
        registerBtn.disabled = false;
    }
    lucide.createIcons();
}

async function deleteStudent(id, name) {
    if(!confirm(`Delete record for ${name}?`)) return;
    const { error } = await supabaseClient.from('students').delete().eq('id', id);
    if (error) { showToast("Deletion failed.", "error"); return; }
    showToast(`${name} deleted.`, "success");
    fetchSupabaseData(); 
}

function updateRosterTable() {
    const tbody = document.getElementById('roster-tbody');
    document.getElementById('student-count').innerText = state.dbStudentsMap.length;
    
    if(state.dbStudentsMap.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="px-6 py-8 text-center text-muted italic">No identities loaded.</td></tr>'; return;
    }
    tbody.innerHTML = '';
    
    state.dbStudentsMap.forEach(student => {
        const tr = document.createElement('tr');
        const safeName = student.name.replace(/'/g, "\\'");
        tr.innerHTML = `
            <td class="px-6 py-4 font-mono text-xs font-bold text-muted">${student.roll_no}</td>
            <td class="px-6 py-4 font-semibold text-primary">${student.name}</td>
            <td class="px-6 py-4 font-mono text-xs text-muted">${student.mobile_no || '-'}</td>
            <td class="px-6 py-4"><span class="bg-border text-primary text-[10px] font-bold px-2 py-1 rounded uppercase tracking-widest">${student.stream}</span></td>
            <td class="px-6 py-4 font-mono text-xs font-bold text-muted">${student.sem || '-'}</td>
            <td class="px-6 py-4 text-right">
                <button onclick="deleteStudent('${student.id}', '${safeName}')" class="text-muted hover:text-red-600 transition p-1.5 rounded-md hover:bg-red-50 border border-transparent hover:border-red-200">
                    <i data-lucide="trash-2" class="w-4 h-4"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
    lucide.createIcons();
}

// --- DASHBOARD LOGIC (View 3) ---
function renderLogsStudentList() {
    const filter = document.getElementById('stream-filter').value;
    const listEl = document.getElementById('logs-student-list');
    listEl.innerHTML = '';
    
    let filtered = state.dbStudentsMap;
    if (filter !== 'ALL') {
        filtered = filtered.filter(s => s.stream === filter);
    }

    if (filtered.length === 0) {
        listEl.innerHTML = '<p class="text-xs text-muted text-center p-4">No students found.</p>';
        return;
    }

    filtered.forEach(s => {
        const btn = document.createElement('button');
        btn.className = `student-item w-full text-left p-3 rounded-lg border border-transparent hover:bg-border transition mb-1 flex items-center justify-between group`;
        btn.onclick = () => openStudentLog(s.id, btn);
        btn.innerHTML = `
            <div>
                <p class="text-sm font-semibold text-primary">${s.name}</p>
                <p class="text-[10px] font-mono text-muted uppercase mt-0.5">${s.roll_no}</p>
            </div>
            <i data-lucide="chevron-right" class="w-4 h-4 text-muted group-hover:text-primary transition"></i>
        `;
        listEl.appendChild(btn);
    });
    lucide.createIcons();
}

async function openStudentLog(studentId, btnElement) {
    document.querySelectorAll('.student-item').forEach(el => el.classList.remove('active'));
    if(btnElement) btnElement.classList.add('active');

    const student = state.dbStudentsMap.find(s => s.id === studentId);
    if(!student) return;
    state.activeStudentId = student.id; 

    document.getElementById('report-empty-state').classList.add('hidden');
    document.getElementById('report-content').classList.remove('hidden');
    document.getElementById('report-content').classList.add('flex');

    document.getElementById('report-name').innerText = student.name;
    document.getElementById('report-roll').innerText = `Roll: ${student.roll_no}`;
    document.getElementById('report-stream').innerText = `Stream: ${student.stream}`;
    document.getElementById('report-sem').innerText = `Sem: ${student.sem || '-'}`;
    document.getElementById('report-mobile').innerText = `Mob: ${student.mobile_no || 'N/A'}`;

    const studentLogs = state.allLogsMap.filter(l => l.student_id === student.id).sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
    
    let presentCount = 0;
    let absentCount = 0;
    
    const listEl = document.getElementById('report-logs-list');
    listEl.innerHTML = '';

    if (studentLogs.length === 0) {
        listEl.innerHTML = '<p class="text-xs text-muted italic">No activity recorded.</p>';
    } else {
        studentLogs.forEach(log => {
            const isPresent = log.status.toLowerCase() === 'present';
            if(isPresent) presentCount++; else absentCount++;
            
            const time = new Date(log.created_at).toLocaleString([], {month:'short', day:'numeric', year:'numeric', hour: '2-digit', minute:'2-digit'});
            const statusClass = isPresent ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200';
            const dotClass = isPresent ? 'bg-emerald-500' : 'bg-red-500';

            const li = document.createElement('li');
            li.className = "flex justify-between items-center border border-border bg-surface px-4 py-3 rounded-xl shadow-sm";
            li.innerHTML = `
                <span class="text-xs font-mono font-medium text-primary">${time}</span>
                <span class="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-widest ${statusClass} border"><div class="w-1.5 h-1.5 ${dotClass} rounded-full"></div>${log.status}</span>
            `;
            listEl.appendChild(li);
        });
    }

    document.getElementById('report-present-count').innerText = presentCount;
    document.getElementById('report-absent-count').innerText = absentCount;

    const total = presentCount + absentCount;
    const percent = total === 0 ? 0 : Math.round((presentCount / total) * 100);
    document.getElementById('attendance-percent-center').innerText = total === 0 ? 'N/A' : `${percent}%`;

    renderChart(presentCount, absentCount);

    const waContainer = document.getElementById('whatsapp-warning-container');
    if (total > 0 && percent < 60 && student.mobile_no) {
        waContainer.classList.remove('hidden');
    } else {
        waContainer.classList.add('hidden');
    }
}

function renderChart(present, absent) {
    const ctx = document.getElementById('attendanceChart').getContext('2d');
    if (state.chartInstance) state.chartInstance.destroy();

    state.chartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Present', 'Absent'],
            datasets: [{
                data: [present, absent],
                backgroundColor: ['#10B981', '#EF4444'], 
                borderWidth: 0,
                cutout: '75%'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { enabled: false } },
            animation: { duration: 800, easing: 'easeOutQuart' }
        }
    });
}

function sendWhatsAppWarning() {
    const student = state.dbStudentsMap.find(s => s.id === state.activeStudentId);
    if (!student || !student.mobile_no) return;
    
    const studentLogs = state.allLogsMap.filter(l => l.student_id === student.id);
    const present = studentLogs.filter(l => l.status.toLowerCase() === 'present').length;
    const total = studentLogs.length;
    const percent = total === 0 ? 0 : Math.round((present / total) * 100);

    const phone = student.mobile_no.replace(/\D/g, ''); 
    
    const msg = `*Notice from Administration*\n\nHi ${student.name},\nYour current attendance is at *${percent}%*, which is below the required 60% threshold. This is considered a shortage. Please contact the administration immediately to resolve this.`;
    
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
}

async function markAbsentees() {
    if(!confirm("Mark all students who haven't clocked in today as Absent?")) return;
    showToast("Processing absentees...", "info");
    
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const { data: logs, error: logsError } = await supabaseClient
            .from('attendance_logs')
            .select('student_id')
            .gte('created_at', today.toISOString());

        if (logsError) throw logsError;

        const loggedStudentIds = new Set(logs.map(l => l.student_id));
        const absentStudents = state.dbStudentsMap.filter(s => !loggedStudentIds.has(s.id));

        if (absentStudents.length === 0) {
            showToast("All students have logged activity today.", "success");
            return;
        }

        const absentRecords = absentStudents.map(s => ({
            student_id: s.id,
            status: 'Absent'
        }));

        const { error: insertError } = await supabaseClient.from('attendance_logs').insert(absentRecords);
        if (insertError) throw insertError;

        showToast(`Marked ${absentRecords.length} student(s) as Absent.`, "success");
        await refreshAllLogs(); 
        
        const activeBtn = document.querySelector('.student-item.active');
        if(activeBtn) activeBtn.click();

    } catch (err) { console.error(err); showToast("Failed to process.", "error"); }
}

// --- Clock In Check ---
async function performClockIn() {
    if (state.registeredFaces.length === 0) { 
        triggerBanner("System Error", "Database empty. Contact admin.", "error");
        speakMessage("System error. Database empty."); return; 
    }
    if (!state.currentLocation) { 
        triggerBanner("GPS Error", "Awaiting GPS lock.", "error");
        speakMessage("Awaiting GPS lock."); return; 
    }

    if (video && (video.paused || video.readyState !== 4)) {
        await video.play().catch(e=>console.log(e));
    }

    clockInBtn.innerHTML = `<div class="spinner border-white border-t-transparent w-4 h-4"></div> Analyzing`; 
    clockInBtn.disabled = true;

    try {
        const detection = await faceapi.detectSingleFace(video).withFaceLandmarks().withFaceDescriptor();
        if (!detection) { 
            triggerBanner("Scan Failed", "No face detected.", "error");
            speakMessage("Authentication failed. No face detected.");
            resetBtn(); return; 
        }

        const faceMatcher = new faceapi.FaceMatcher(state.registeredFaces, 0.5);
        const match = faceMatcher.findBestMatch(detection.descriptor);
        
        if (match.label === 'unknown') {
            drawFaceBox(detection, 'Rejected', true);
            triggerBanner("Access Denied", "Identity not recognized.", "error");
            speakMessage("Authentication failed. Identity not recognized.");
        } else {
            const student = state.dbStudentsMap.find(s => s.id.toString() === match.label);
            if(!student) throw new Error("Student data mismatch");

            drawFaceBox(detection, student.name, true);

            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const { data: existingLogs, error: fetchError } = await supabaseClient
                .from('attendance_logs')
                .select('id')
                .eq('student_id', student.id)
                .gte('created_at', today.toISOString());

            if (fetchError) {
                triggerBanner("System Error", "Failed to verify history.", "error");
                speakMessage("System error. Failed to verify history.");
            } else if (existingLogs && existingLogs.length > 0) {
                triggerBanner("Already Marked", `${student.name}, attendance already recorded today.`, "warning");
                speakMessage(`Attendance already marked for ${student.name} today.`);
            } else {
                const { error: logError } = await supabaseClient.from('attendance_logs').insert([{ student_id: student.id, status: 'Present' }]);
                if (logError) {
                    triggerBanner("Sync Error", "Authenticated, but cloud log failed.", "error");
                    speakMessage(`Welcome, ${student.name}, but cloud log failed.`);
                } else {
                    triggerBanner("Access Granted", `Welcome, ${student.name}`, "success");
                    speakMessage(`Welcome, ${student.name}`);
                    refreshAllLogs();
                }
            }
        }
    } catch (err) { 
        triggerBanner("System Error", "Processing error occurred.", "error");
        speakMessage("System processing error.");
    } 
    resetBtn();
}

function resetBtn() {
    clockInBtn.innerHTML = `<i data-lucide="scan-face" class="w-5 h-5 text-white"></i> Authenticate Identity`; 
    clockInBtn.disabled = false;
    lucide.createIcons();
}

// --- Navigation Logic ---
const navItems = [
    { id: 'register', label: 'Registration', icon: 'user-plus' },
    { id: 'roster', label: 'Roster', icon: 'users' },
    { id: 'logs', label: 'Dashboard', icon: 'pie-chart' },
    { id: 'campus', label: 'Campus', icon: 'map' }
];

function buildAdminNav() {
    const desktopNav = document.getElementById('desktop-nav');
    const mobileNav = document.getElementById('mobile-nav');
    let html = '';
    navItems.forEach(item => {
        html += `<button onclick="switchAdminTab('${item.id}')" id="nav-btn-${item.id}" class="nav-btn px-3 py-1.5 rounded-md text-sm font-medium text-muted hover:text-primary transition flex items-center gap-1.5 shrink-0"><i data-lucide="${item.icon}" class="w-4 h-4"></i> ${item.label}</button>`;
    });
    desktopNav.innerHTML = html; mobileNav.innerHTML = html; lucide.createIcons();
}

function openPinModal() {
    const modal = document.getElementById('pin-modal');
    modal.classList.remove('hidden'); modal.classList.add('flex');
    document.getElementById('pin-input').value = '';
    document.getElementById('pin-error').classList.add('hidden');
    setTimeout(()=> document.getElementById('pin-input').focus(), 100);
}

function closePinModal() { document.getElementById('pin-modal').classList.add('hidden'); document.getElementById('pin-modal').classList.remove('flex'); }

function verifyPin() {
    if(document.getElementById('pin-input').value === APP_CONFIG.ADMIN_PIN) {
        closePinModal(); enterAdminMode();
    } else {
        document.getElementById('pin-error').classList.remove('hidden');
        document.getElementById('pin-input').value = '';
    }
}
document.getElementById('pin-input').addEventListener('keypress', e => { if (e.key === 'Enter') verifyPin(); });

function enterAdminMode() {
    document.getElementById('kiosk-mode').classList.add('hidden');
    document.getElementById('admin-mode').classList.remove('hidden'); document.getElementById('admin-mode').classList.add('flex');
    buildAdminNav(); switchAdminTab('register');
}

function exitAdminMode() {
    document.getElementById('admin-mode').classList.add('hidden'); document.getElementById('admin-mode').classList.remove('flex');
    document.getElementById('kiosk-mode').classList.remove('hidden'); checkGeofence(); 
    if (video) video.play().catch(e=>{});
}

function switchAdminTab(targetSec) {
    document.querySelectorAll('.admin-section').forEach(el => { el.classList.add('hidden'); });
    const targetEl = document.getElementById(`sec-${targetSec}`);
    if (targetEl) targetEl.classList.remove('hidden');

    document.querySelectorAll('.nav-btn').forEach(btn => { btn.classList.remove('bg-border', 'text-primary'); btn.classList.add('text-muted'); });
    document.querySelectorAll(`#nav-btn-${targetSec}`).forEach(btn => { btn.classList.remove('text-muted'); btn.classList.add('bg-border', 'text-primary'); });

    try { toggleFullScreenLayout(targetSec !== 'register'); } catch(e) {}

    if (targetSec === 'logs') { renderLogsStudentList(); }
    else if (targetSec === 'campus') setTimeout(() => { initMap(); if(map) map.invalidateSize(); }, 350);
    else if (targetSec === 'roster') fetchSupabaseData(); 
    else if (targetSec === 'register') {
        setTimeout(() => { if (adminVideo) adminVideo.play().catch(e=>{}); }, 100);
    }
}

window.onload = loadModels;
