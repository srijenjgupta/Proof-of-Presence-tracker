// ==========================================
// 1. FIREBASE CONFIGURATION (ACTION REQUIRED)
// ==========================================
// TODO: Replace this object with Firebase Config keys

const firebaseConfig = {
  apiKey: "AIzaSyAVgLZLwUmKwvTLh8F0Iztd8cu9Ql_O3DE",
  authDomain: "srijen-pop-tracker.firebaseapp.com",
  projectId: "srijen-pop-tracker",
  storageBucket: "srijen-pop-tracker.firebasestorage.app",
  messagingSenderId: "474409279361",
  appId: "1:474409279361:web:950f4f81c1a049eaf4d280",
  measurementId: "G-43YZRCMX1W"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// ==========================================
// 2. GLOBAL STATE
// ==========================================
let currentUser = { role: null, companyCode: null, staffId: null };
let adminMap = null;
let adminMarker = null;
let currentSelectedCoords = null;
let staffAssignments = []; 
let tMap = null; // Territory Map
let territoryMarkers = [];

function showSection(sectionId) {
    document.querySelectorAll('.view-section').forEach(sec => sec.classList.add('hidden'));
    document.getElementById(sectionId).classList.remove('hidden');
}

// ==========================================
// 3. AUTHENTICATION & STAFF CREATION
// ==========================================
async function registerAdmin() {
    const compName = document.getElementById('admin-company').value.trim();
    if(!compName) return alert("Enter company name");
    
    const code = compName.substring(0,4).toUpperCase() + "-" + Math.floor(1000 + Math.random() * 9000);
    
    try {
        await db.collection("Companies").doc(code).set({
            name: compName,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        alert(`Success! Your Company Code is: ${code}`);
    } catch (error) { alert("Registration failed."); }
}

async function loginAdmin() {
    const code = document.getElementById('admin-code-login').value.trim().toUpperCase();
    if(!code) return alert("Enter code");

    const doc = await db.collection("Companies").doc(code).get();
    if (doc.exists) {
        currentUser = { role: 'admin', companyCode: code };
        document.getElementById('display-company-code').innerText = `(Code: ${code})`;
        showSection('admin-section');
        initAdminMap();
        initTerritoryMap(); // Initialize the print map
        loadStaffDropdown(); 
        listenToLogs(code);
    } else { alert("Invalid Company Code."); }
}

async function addStaff() {
    const name = document.getElementById('new-staff-name').value.trim();
    if(!name) return alert("Enter staff name");

    const staffId = "EMP-" + Math.floor(1000 + Math.random() * 9000);
    
    try {
        await db.collection("Staff").doc(staffId).set({
            companyCode: currentUser.companyCode,
            name: name,
            staffId: staffId
        });
        document.getElementById('latest-staff-id').innerText = `Successfully added ${name}! ID: ${staffId}`;
        document.getElementById('new-staff-name').value = "";
        loadStaffDropdown(); 
    } catch (error) { alert("Error adding staff."); }
}

async function loadStaffDropdown() {
    const dropdown1 = document.getElementById('assign-staff-dropdown');
    const dropdown2 = document.getElementById('view-territory-dropdown');
    dropdown1.innerHTML = '<option value="">Assign to Staff Member...</option>';
    dropdown2.innerHTML = '<option value="">Select Staff to Map...</option><option value="ALL">Show All Staff</option>';
    
    const snapshot = await db.collection("Staff").where("companyCode", "==", currentUser.companyCode).get();
    snapshot.forEach(doc => {
        const staff = doc.data();
        const text = `${staff.name} (${staff.staffId})`;
        
        const opt1 = document.createElement('option');
        opt1.value = staff.staffId; opt1.innerText = text;
        dropdown1.appendChild(opt1);

        const opt2 = document.createElement('option');
        opt2.value = staff.staffId; opt2.innerText = text;
        dropdown2.appendChild(opt2);
    });
}

async function loginStaff() {
    const code = document.getElementById('staff-company-code').value.trim().toUpperCase();
    const staffId = document.getElementById('staff-id').value.trim().toUpperCase();
    
    if(!code || !staffId) return alert("Enter both fields");

    const doc = await db.collection("Staff").doc(staffId).get();
    if (doc.exists && doc.data().companyCode === code) {
        currentUser = { role: 'staff', companyCode: code, staffId: staffId };
        document.getElementById('display-staff-id').innerText = `(${staffId})`;
        const today = new Date().toLocaleDateString('en-GB');
        document.getElementById('current-date-display').innerText = today;
        showSection('staff-section');
        loadStaffDashboard(code, staffId);
    } else { alert("Invalid credentials."); }
}

function logout() {
    currentUser = { role: null, companyCode: null, staffId: null };
    showSection('auth-section');
}

// ==========================================
// 4. MAP & LINK PARSER (ADMIN)
// ==========================================
function initAdminMap() {
    if(adminMap) return; 
    adminMap = L.map('map').setView([19.0760, 72.8777], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(adminMap);
}

function initTerritoryMap() {
    if(tMap) return; 
    tMap = L.map('territory-map').setView([19.0760, 72.8777], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(tMap);
}

async function searchAddress() {
    const query = document.getElementById('address-search').value.trim();
    if(!query) return alert("Enter an address or link");

    // 1. Check if the user pasted a web link
    const isUrl = query.startsWith("http://") || query.startsWith("https://");

    // 2. Regex to extract Lat/Long (e.g., @19.24,72.12)
    const mapRegex = /@(-?\d+\.\d+),(-?\d+\.\d+)/;
    const match = query.match(mapRegex);

    if(match) {
        // Success: Found coordinates in the URL
        setMapPin(parseFloat(match[1]), parseFloat(match[2]));
        return;
    }

    // 3. ERROR HANDLING: It's a URL, but it has no coordinates (e.g., a shortlink)
    if (isUrl && !match) {
        return alert("Error: Short links (like goo.gl) or links without coordinates cannot be processed.\n\nPlease type the actual address name (e.g., 'Kalyan Station') instead, and drop the pin manually.");
    }

    // 4. NORMAL SEARCH: It's text, so use the map search API
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
        const data = await response.json();
        
        if(data.length > 0) {
            setMapPin(parseFloat(data[0].lat), parseFloat(data[0].lon));
        } else { 
            alert("Address not found on the map.\n\nTry searching for a nearby landmark or city, then drag the pin to the exact spot."); 
        }
    } catch (error) {
        alert("Network error while searching for the address. Please check your connection.");
    }
}

function setMapPin(lat, lon) {
    adminMap.setView([lat, lon], 16);
    if(adminMarker) adminMap.removeLayer(adminMarker);
    adminMarker = L.marker([lat, lon], {draggable: true}).addTo(adminMap);
    currentSelectedCoords = {lat, lon};
    document.getElementById('coords-display').innerText = `Lat: ${lat.toFixed(4)}, Lon: ${lon.toFixed(4)}`;

    adminMarker.on('dragend', function(e) {
        const position = adminMarker.getLatLng();
        currentSelectedCoords = {lat: position.lat, lon: position.lng};
        document.getElementById('coords-display').innerText = `Lat: ${position.lat.toFixed(4)}, Lon: ${position.lng.toFixed(4)}`;
    });
}

async function saveClient() {
    const clientName = document.getElementById('new-client-name').value;
    const assignedStaffId = document.getElementById('assign-staff-dropdown').value;
    
    if(!clientName || !currentSelectedCoords) return alert("Set name and pin.");
    if(!assignedStaffId) return alert("Please assign a staff member.");

    try {
        await db.collection("Clients").add({
            companyCode: currentUser.companyCode,
            name: clientName,
            assignedTo: assignedStaffId,
            lat: currentSelectedCoords.lat,
            lng: currentSelectedCoords.lon
        });
        alert(`Client assigned to ${assignedStaffId}!`);
        document.getElementById('new-client-name').value = ""; 
    } catch (error) { alert("Error saving client."); }
}

// ==========================================
// 5. TERRITORY PRINT MAP LOGIC
// ==========================================
async function loadTerritoryMap() {
    const staffId = document.getElementById('view-territory-dropdown').value;
    if(!staffId) return alert("Select a staff member.");

    document.getElementById('print-map-title').innerText = `Territory Map: ${staffId === 'ALL' ? 'All Staff' : staffId}`;

    // Clear old markers
    territoryMarkers.forEach(m => tMap.removeLayer(m));
    territoryMarkers = [];

    let query = db.collection("Clients").where("companyCode", "==", currentUser.companyCode);
    if(staffId !== 'ALL') { query = query.where("assignedTo", "==", staffId); }
    
    const snapshot = await query.get();
    
    if(snapshot.empty) return alert("No clients found for this selection.");

    const bounds = [];
    snapshot.forEach(doc => {
        const client = doc.data();
        const latLng = [client.lat, client.lng];
        
        // Add Marker
        const marker = L.marker(latLng).bindPopup(`<b>${client.name}</b><br>Assigned: ${client.assignedTo}`).addTo(tMap);
        // Add 100m Geofence Circle
        const circle = L.circle(latLng, { color: 'red', fillColor: '#f03', fillOpacity: 0.2, radius: 100 }).addTo(tMap);
        
        territoryMarkers.push(marker);
        territoryMarkers.push(circle);
        bounds.push(latLng);
    });

    // Fix grey map issue and fit bounds
    setTimeout(() => {
        tMap.invalidateSize();
        tMap.fitBounds(bounds, {padding: [50, 50]});
    }, 200);
}

// ==========================================
// 6. STAFF DASHBOARD & CHECK-IN ENGINE
// ==========================================
function getDistanceInMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3; 
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;
    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) * Math.sin(Δλ/2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))); 
}

async function loadStaffDashboard(code, staffId) {
    const tbody = document.getElementById('staff-dashboard-table');
    tbody.innerHTML = "<tr><td colspan='4'>Loading roster...</td></tr>";

    try {
        const clientsSnap = await db.collection("Clients").where("companyCode", "==", code).where("assignedTo", "==", staffId).get();
        staffAssignments = [];
        clientsSnap.forEach(doc => staffAssignments.push(doc.data()));

        const visitsSnap = await db.collection("Visits").where("companyCode", "==", code).where("staffId", "==", staffId).get();
        
        let visitedClients = [];
        const todayStart = new Date(); todayStart.setHours(0,0,0,0);
        
        visitsSnap.forEach(doc => {
            const visit = doc.data();
            if(visit.timestamp && visit.timestamp.toDate() >= todayStart) { visitedClients.push(visit.clientName); }
        });

        tbody.innerHTML = "";
        if(staffAssignments.length === 0) {
            tbody.innerHTML = "<tr><td colspan='4'>No clients assigned.</td></tr>";
            return;
        }

        staffAssignments.forEach((client, index) => {
            const isVisited = visitedClients.includes(client.name);
            const statusColor = isVisited ? "green" : "orange";
            const statusText = isVisited ? "Visited" : "Pending";
            const mapsLink = `https://www.google.com/maps/search/?api=1&query=${client.lat},${client.lng}`;

            
            const actionBtn = isVisited 
                ? `✔️ Done` 
                : `<button onclick="verifyLocation(${index})" style="padding: 5px; font-size: 0.8em; background: #0056b3;">Check-In</button>`;

            tbody.innerHTML += `<tr>
                <td><strong>${client.name}</strong></td>
                <td><a href="${mapsLink}" target="_blank">Open Map</a></td>
                <td style="color:${statusColor}; font-weight:bold;">${statusText}</td>
                <td>${actionBtn}</td>
            </tr>`;
        });
    } catch (error) { tbody.innerHTML = "<tr><td colspan='4'>Error loading roster.</td></tr>"; }
}

function verifyLocation(clientIndex) {
    const target = staffAssignments[clientIndex];
    const statusMsg = document.getElementById('staff-status-msg');

    statusMsg.innerText = `Requesting GPS to verify presence at ${target.name}...`;
    statusMsg.style.color = "orange";

    navigator.geolocation.getCurrentPosition(async (position) => {
        const dist = getDistanceInMeters(position.coords.latitude, position.coords.longitude, target.lat, target.lng);

        if(dist <= 100) {
            statusMsg.innerText = "✅ Verified! Saving...";
            try {
                await db.collection("Visits").add({
                    companyCode: currentUser.companyCode,
                    staffId: currentUser.staffId,
                    clientName: target.name,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                    status: "Visited"
                });
                statusMsg.innerText = "✅ Check-in successful!";
                statusMsg.style.color = "green";
                loadStaffDashboard(currentUser.companyCode, currentUser.staffId);
            } catch (err) { statusMsg.innerText = "❌ Verification passed, but failed to save."; }
        } else {
            statusMsg.innerText = `❌ Too far (${Math.round(dist)}m). You must be within 100m.`;
            statusMsg.style.color = "red";
        }
    }, (e) => { statusMsg.innerText = "GPS Error."; }, { enableHighAccuracy: true });
}

// ==========================================
// 7. CSV & REPORTING (ADMIN)
// ==========================================
function listenToLogs(code) {
    db.collection("Visits").where("companyCode", "==", code)
      .onSnapshot((snapshot) => {
          let logs = [];
          snapshot.forEach(doc => logs.push(doc.data()));
          
          logs.sort((a, b) => {
              let timeA = a.timestamp ? a.timestamp.toMillis() : 0;
              let timeB = b.timestamp ? b.timestamp.toMillis() : 0;
              return timeB - timeA;
          });

          const tbody = document.getElementById('logs-body');
          tbody.innerHTML = "";
          
          logs.forEach(log => {
              const time = log.timestamp ? log.timestamp.toDate().toLocaleString() : "Just now";
              tbody.innerHTML += `<tr><td>${time}</td><td>${log.staffId}</td><td>${log.clientName}</td><td style="color:green; font-weight:bold;">${log.status}</td></tr>`;
          });
      });
}

function toggleHelp() {
    const helpBox = document.getElementById('link-help');
    helpBox.classList.toggle('hidden');
}

function downloadCSV() {
    let csvContent = "data:text/csv;charset=utf-8,Date/Time,Staff ID,Assigned Client,Status\n";
    const rows = document.querySelectorAll("#logs-table tr");
    rows.forEach(row => {
        let cols = row.querySelectorAll("td, th");
        let rowData = Array.from(cols).map(col => `"${col.innerText}"`);
        csvContent += rowData.join(",") + "\n";
    });
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csvContent));
    link.setAttribute("download", "attendance_logs.csv");
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
}