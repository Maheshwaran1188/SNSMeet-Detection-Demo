// --- Global DOM Elements ---
const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('detection-canvas');
const statusElement = document.getElementById('status');
const anomalyDetailsElement = document.getElementById('anomaly-details');
const removalAlertElement = document.getElementById('removal-alert');
const ctx = canvasElement ? canvasElement.getContext('2d') : null;

let faceDetector = null;
let anomalyModel = null;
let isModelReady = false;

// Chart.js instances (Only used on host page)
let confidenceChart;
let integrityChart;

// Frame Skipping Optimization Variables
let frameCount = 0;
const INFERENCE_SKIP_RATE = 10;
let lastDetectionResult = {
    isFake: false,
    statusText: 'REAL',
    confidence: 0,
    predictions: [] 
};

// --- WebRTC Variables ---
let peer = null;
let localStream = null;
const isHost = document.getElementById('confidenceChart') !== null;
// --- IMPORTANT: Meeting ID display elements ---
const meetingIdDisplay = document.getElementById('meeting-id-display'); // Host ID display element
const currentMeetingIdDisplay = document.getElementById('currentMeetingIdDisplay'); // Participant ID display element

const joinButton = document.getElementById('joinButton');
const meetingIdInput = document.getElementById('meetingIdInput');
const joinScreen = document.getElementById('join-screen');
const meetingRoom = document.getElementById('meeting-room');


// --- CRITICAL FIX: STUN/TURN Configuration for WebRTC Reliability ---
const ICE_SERVERS = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' }
    ]
};

// --- ANOMALY CONFIGURATION ---
const PADDING_FACTOR = 1.3; 
const ANOMALY_CLASSES = [
    'monitor', 'screen', 'electronic', 'cellular telephone',
    'projector', 'CRT screen', 'digital clock', 'Web site' 
];
const ANOMALY_THRESHOLD = 0.40; 
const ANOMALY_WARNING_LEVEL = 0.65;

// Function to read CSS variables for Chart.js
function getCssVariable(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// 1. Setup Webcam Feed
async function setupWebcam(videoTargetElement) {
    if (statusElement) statusElement.innerHTML = "⏳ Requesting webcam access...";
    try {
        const stream = navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localStream = await stream;
        videoTargetElement.srcObject = localStream;

        return new Promise((resolve) => {
            videoTargetElement.onloadedmetadata = () => {
                if (isHost) {
                    videoTargetElement.width = videoTargetElement.videoWidth;
                    videoTargetElement.height = videoTargetElement.videoHeight;
                    canvasElement.width = videoTargetElement.videoWidth;
                    canvasElement.height = videoTargetElement.videoHeight;
                }
                
                videoTargetElement.play(); 
                resolve(videoTargetElement);
            };
        });
    } catch (error) {
        if (statusElement) statusElement.innerHTML = `<span class="fake">❌ ERROR: Could not access webcam. (${error.message})</span>`;
        console.error("Webcam Error:", error);
    }
}

// 2. Load Both AI Models (Host Only)
async function loadModels() {
    if (!isHost) return;

    statusElement.innerHTML = "⏳ Loading AI Models (BlazeFace & MobileNet)...";
    
    await tf.setBackend('webgl').catch(e => console.warn("WebGL failed, falling back to CPU:", e));

    const [detector, anomaly] = await Promise.all([
        blazeface.load({ scoreThreshold: 0.70 }), 
        mobilenet.load()
    ]);

    faceDetector = detector; 
    anomalyModel = anomaly;
    
    if (faceDetector && anomalyModel) {
        isModelReady = true;
        statusElement.innerHTML = `<span class="real">✅ All Models Ready! Starting Real-Time Analysis...</span>`;
        setupCharts();
    } else {
         statusElement.innerHTML = `<span class="fake">❌ Model Loading Failed. Check Console.</span>`;
    }
}

// 3. Setup Charts for Visualization (Host Only)
function setupCharts() {
    // ... Chart setup remains the same ...
    const colorDanger = getCssVariable('--color-danger');
    const colorSuccess = getCssVariable('--color-success');
    const colorDangerRgba = colorDanger.startsWith('rgb') ? colorDanger.replace(')', ', 0.2)').replace('rgb', 'rgba') : 'rgba(255, 51, 51, 0.2)';

    confidenceChart = new Chart(document.getElementById('confidenceChart'), {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Anomaly Confidence (%)',
                data: [],
                borderColor: colorDanger, 
                backgroundColor: colorDangerRgba, 
                tension: 0.1,
                fill: true
            }]
        },
        options: {
            animation: false,
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { min: 0, max: 100, title: { display: true, text: 'Confidence %' } },
                x: { title: { display: true, text: 'Time (Frames)' } }
            },
            plugins: {
                legend: { display: false }
            }
        }
    });

    integrityChart = new Chart(document.getElementById('integrityChart'), {
        type: 'doughnut',
        data: {
            labels: ['Real Score', 'Anomaly Score'],
            datasets: [{
                data: [100, 0], 
                backgroundColor: [colorSuccess, colorDanger],
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: true, position: 'bottom' },
                title: { display: false }
            }
        }
    });
}

// 4. Update Visuals (Host Only)
function updateVisuals(isFake, confidence) {
    if (!isHost) return;

    // ... Update chart and alert logic remains the same ...
    const maxDataPoints = 30;
    
    confidenceChart.data.labels.push(frameCount);
    confidenceChart.data.datasets[0].data.push(confidence * 100);

    if (confidenceChart.data.labels.length > maxDataPoints) {
        confidenceChart.data.labels.shift();
        confidenceChart.data.datasets[0].data.shift();
    }
    confidenceChart.update('none'); 

    const anomalyScore = Math.min(confidence * 100, 100);
    const realScore = 100 - anomalyScore;
    integrityChart.data.datasets[0].data = [realScore.toFixed(1), anomalyScore.toFixed(1)];
    integrityChart.update('none');

    anomalyDetailsElement.innerHTML = lastDetectionResult.predictions.length > 0 
        ? (isFake 
            ? `<p style="color:${getCssVariable('--color-danger')};font-weight:700;">Anomaly Detected: ${lastDetectionResult.predictions[0].statusText}</p>`
            : `<p style="color:${getCssVariable('--color-success')};">Current Status: Real (${lastDetectionResult.predictions[0].statusText.split('(')[0].trim()})</p>`)
        : `<p>Awaiting Face Detection...</p>`;

    if (confidence >= ANOMALY_WARNING_LEVEL) {
        removalAlertElement.style.display = 'block';
        removalAlertElement.querySelector('button').onclick = () => {
            alert("Participant (Host) Removed due to Critical Anomaly Score!");
            window.location.href='index.html';
        };
    } else {
        removalAlertElement.style.display = 'none';
    }
}

// 5. Heavy AI Detection Logic (Host Only)
async function detectDeepfakeArtifacts() {
    if (!isHost || !isModelReady || videoElement.readyState < 2 || !faceDetector || !anomalyModel) {
        return;
    }
    
    // ... AI detection logic remains the same ...
    let predictions = [];
    let videoTensor = null;

    try {
        predictions = await faceDetector.estimateFaces(videoElement, false);
        lastDetectionResult.predictions = [];

        if (predictions.length > 0) {
            videoTensor = tf.browser.fromPixels(videoElement);
            for (const p of predictions) {
                
                const [xMin, yMin] = p.topLeft;
                const [xMax, yMax] = p.bottomRight;
                
                const width = xMax - xMin;
                const height = yMax - yMin;
                const center = [(xMin + xMax) / 2, (yMin + yMax) / 2];
                const size = Math.max(width, height) * PADDING_FACTOR; 

                const startX = Math.max(0, Math.floor(center[0] - size / 2));
                const startY = Math.max(0, Math.floor(center[1] - size / 2));
                const boxW = Math.min(videoElement.videoWidth - startX, Math.ceil(size));
                const boxH = Math.min(videoElement.videoHeight - startY, Math.ceil(size));
                
                let croppedFace = null;
                let resizedFace = null;
                let normalizedFace = null;
                
                try {
                    croppedFace = tf.slice(videoTensor, [startY, startX, 0], [boxH, boxW, 3]);
                    resizedFace = tf.image.resizeBilinear(croppedFace, [224, 224], true);
                    normalizedFace = resizedFace.div(255);
                    
                    const classification = await anomalyModel.classify(normalizedFace); 
                    
                    const topPrediction = classification[0];
                    let isFake = false;
                    let statusText = 'REAL';
                    
                    const anomalyMatch = ANOMALY_CLASSES.some(className => topPrediction.className.includes(className));

                    if (anomalyMatch && topPrediction.probability >= ANOMALY_THRESHOLD) {
                        isFake = true;
                        statusText = `DEEPFAKE ARTIFACT! (${topPrediction.className.split(',')[0]})`;
                    }
                    else {
                        statusText = `REAL (${topPrediction.className.split(',')[0]})`;
                    }

                    lastDetectionResult.predictions.push({
                        start: [startX, startY], 
                        size: [boxW, boxH],      
                        isFake: isFake,
                        statusText: statusText,
                        probability: topPrediction.probability
                    });

                } finally {
                    if (croppedFace) croppedFace.dispose();
                    if (resizedFace) resizedFace.dispose();
                    if (normalizedFace) normalizedFace.dispose();
                }
            }
        }
        
        lastDetectionResult.isFake = lastDetectionResult.predictions.some(p => p.isFake);
        lastDetectionResult.confidence = lastDetectionResult.isFake ? lastDetectionResult.predictions[0].probability : 0;
        
        const statusDetail = predictions.length > 0 ? `${predictions.length} face(s) tracked.` : `No faces detected.`;
        lastDetectionResult.statusText = lastDetectionResult.isFake 
            ? lastDetectionResult.predictions.length > 0 
                ? `DEEPFAKE ALERT! ${lastDetectionResult.predictions[0].statusText}`
                : `DEEPFAKE ALERT! Source Anomaly.`
            : statusDetail;

    } catch (error) { 
        console.error("Critical AI Detection Error:", error);
        lastDetectionResult.statusText = `CRITICAL ERROR: ${error.message.substring(0, 50)}... Check Console.`;
        lastDetectionResult.isFake = true; 
        lastDetectionResult.predictions = []; 
        
    } finally {
        if (videoTensor) videoTensor.dispose();
    }
    
    const currentConfidence = lastDetectionResult.isFake ? lastDetectionResult.confidence : 0;
    updateVisuals(lastDetectionResult.isFake, currentConfidence);

    if (statusElement) {
        statusElement.innerHTML = lastDetectionResult.isFake 
            ? `<span class="fake">🚨 DEEPFAKE ALERT! ${lastDetectionResult.statusText}</span>`
            : `<span class="real">✅ Status: ${lastDetectionResult.statusText}</span>`;
    }
}


// 6. Lightweight Display Loop
async function displayFrame() {
    requestAnimationFrame(displayFrame); 

    if (!localStream || localStream.readyState < 2) { 
        return;
    }
    // ... Frame and bounding box drawing logic remains the same ...
    if (isHost && ctx && videoElement.readyState >= 2) {
        ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
        ctx.drawImage(videoElement, 0, 0, videoElement.videoWidth, videoElement.videoHeight);
    }
    
    if (isHost && lastDetectionResult.predictions.length > 0) {
        for (const p of lastDetectionResult.predictions) {
            
            const drawColor = p.isFake ? getCssVariable('--color-danger') : getCssVariable('--color-success');

            ctx.strokeStyle = drawColor;
            ctx.lineWidth = 4;
            ctx.strokeRect(p.start[0], p.start[1], p.size[0], p.size[1]);
            
            ctx.fillStyle = drawColor;
            ctx.font = '20px Arial';
            ctx.fillText(
                `${p.statusText.split('(')[0].trim()} (${(p.probability * 100).toFixed(1)}%)`,
                p.start[0] + 5,
                p.start[1] - 10
            );
        }
    }

    if (isHost && isModelReady && frameCount % INFERENCE_SKIP_RATE === 0) {
        detectDeepfakeArtifacts(); 
    }

    frameCount++;
}


// 7. --- WEBRTC/PEERJS LOGIC ---
function getUrlMeetingID() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('id');
}

function handleHostSession() {
    const hostID = getUrlMeetingID() || Math.random().toString(36).substring(2, 9).toUpperCase();
    
    peer = new Peer(hostID, {
        host: 'peerjs.com', 
        secure: true,      
        port: 443,         
        path: '/',
        config: ICE_SERVERS,
        debug: 3
    });

    peer.on('open', id => {
        console.log('Host Peer connected with ID:', id);
        // --- UPDATED: Ensure meeting ID display is set on the host page ---
        window.history.replaceState(null, null, `?id=${id}`);
        if (meetingIdDisplay) {
             meetingIdDisplay.innerText = `Meeting ID: ${id}`;
             statusElement.innerHTML = `<span class="real">✅ Meeting Live! ID: ${id}</span>`;
        }
    });

    // Host receives a call from a participant
    peer.on('call', call => {
        if (statusElement) statusElement.innerHTML = `<span class="real">📞 Incoming Participant Call...</span>`;
        call.answer(localStream);
        
        call.on('stream', remoteStream => {
            // Find the video element for the participant
            const participantVideo = document.getElementById('participant-video');
            if(participantVideo) {
                participantVideo.srcObject = remoteStream;
                participantVideo.play();
                console.log(`Received stream from Peer: ${call.peer}`);
            }
        });
    });

    peer.on('error', err => {
        console.error("PeerJS Error (Host):", err);
        if (statusElement) statusElement.innerHTML = `<span class="fake">❌ WEBRTC Error. Check Console.</span>`;
    });
}

function connectToHost(hostID) {
    if (!hostID) {
        alert("Please enter a valid Meeting ID.");
        return;
    }

    // Hide Join Screen, Show Meeting Room
    if (joinScreen && meetingRoom) {
        joinScreen.style.display = 'none';
        meetingRoom.style.display = 'block';
    }
    
    // --- UPDATED: Ensure meeting ID display is set on the participant page ---
    if (currentMeetingIdDisplay) {
         currentMeetingIdDisplay.innerText = hostID;
    }
    if (statusElement) statusElement.innerHTML = `<span class="real">⏳ Initializing participant peer...</span>`;

    peer = new Peer(undefined, {
        host: 'peerjs.com', 
        secure: true,      
        port: 443,         
        path: '/',
        config: ICE_SERVERS,
        debug: 3
    });

    peer.on('open', () => {
        if (statusElement) statusElement.innerHTML = `<span class="real">📞 Calling Host: ${hostID}...</span>`;
        
        // Use the new localWebcam element for participant's video
        const localWebcamElement = document.getElementById('localWebcam');
        if (localWebcamElement && localStream) {
             localWebcamElement.srcObject = localStream;
        }

        // Initiate the call to the host
        const call = peer.call(hostID, localStream);

        call.on('stream', remoteStream => {
            // Display the stream received from the host in the main video element
            const hostVideoElement = document.getElementById('webcam'); 
            if (hostVideoElement) {
                hostVideoElement.srcObject = remoteStream;
                hostVideoElement.play();
                if (statusElement) statusElement.innerHTML = `<span class="real">🤝 Joined Host Session.</span>`;
            }
        });

        call.on('error', err => {
            console.error("Call Error:", err);
            alert("Meeting not found or the host session is inactive/closed. (ID must match the host's ID)"); 
            if (statusElement) statusElement.innerHTML = `<span class="fake">❌ Call Failed or Host Offline.</span>`;
            // Re-show join screen on failure
            if (joinScreen && meetingRoom) {
                joinScreen.style.display = 'block';
                meetingRoom.style.display = 'none';
            }
        });
    });
    
    peer.on('error', err => {
        console.error("PeerJS Error (Participant):", err);
        if (statusElement) statusElement.innerHTML = `<span class="fake">❌ WEBRTC Error. Check Console.</span>`;
    });
}

// 8. --- Initialization ---
async function init() {
    
    // Use localWebcam for participant page (if not host), otherwise use webcam
    const targetVideoElement = isHost ? videoElement : document.getElementById('localWebcam');
    if (!targetVideoElement) {
        console.error("Critical: Target video element not found.");
        return;
    }

    await setupWebcam(targetVideoElement);
    
    if (localStream) {
        if (isHost) {
            handleHostSession();
            await loadModels();
        } 
        else {
            const urlId = getUrlMeetingID();
            if (urlId) {
                if (meetingIdInput) meetingIdInput.value = urlId;
                connectToHost(urlId);
            }

            if (joinButton && meetingIdInput) {
                joinButton.addEventListener('click', () => {
                    const enteredId = meetingIdInput.value.trim();
                    connectToHost(enteredId);
                });
            }
        }
    }
    
    displayFrame();
}

init();
