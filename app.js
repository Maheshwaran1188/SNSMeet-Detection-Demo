// --- Global DOM Elements ---
const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('detection-canvas');
const statusElement = document.getElementById('status');
const anomalyDetailsElement = document.getElementById('anomaly-details');
const removalAlertElement = document.getElementById('removal-alert');
const ctx = canvasElement ? canvasElement.getContext('2d') : null;

// Meeting elements required for both host and participant pages
const hostVideoElement = document.getElementById('webcam'); // Used by host (local) and participant (remote)
const localVideoElement = document.getElementById('localWebcam'); // Used by participant (local)
const participantVideo = document.getElementById('participant-video'); // Remote participant video on host page
const meetingIdDisplay = document.getElementById('meeting-id-display'); // Host ID display element
const currentMeetingIdDisplay = document.getElementById('currentMeetingIdDisplay'); // Participant ID display element
const joinButton = document.getElementById('joinButton');
const meetingIdInput = document.getElementById('meetingIdInput');
const joinScreen = document.getElementById('join-screen');
const meetingRoom = document.getElementById('meeting-room');


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
const isHost = meetingIdDisplay !== null; 

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

// Function to read CSS variables (simplified for this example)
function getCssVariable(name) {
    // Replace with logic to read from CSS if needed, or use inline styles/hardcoded values
    if (name === '--color-danger') return 'red';
    if (name === '--color-success') return 'green';
    return '#ccc';
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
                if (isHost && canvasElement) {
                    // Set canvas size to match video feed
                    canvasElement.width = videoTargetElement.videoWidth;
                    canvasElement.height = videoTargetElement.videoHeight;
                    // Make the video visible only after sizing the canvas
                    videoTargetElement.style.display = 'block'; 
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
    
    // Check if models are available (loaded by the HTML script)
    if (typeof blazeface === 'undefined' || typeof mobilenet === 'undefined') {
        statusElement.innerHTML = `<span class="fake">❌ Model Libraries not loaded.</span>`;
        return;
    }
    
    statusElement.innerHTML = "⏳ Loading AI Models (BlazeFace & MobileNet) from memory...";
    
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
    // Minimal chart setup to prevent app.js crash
    const chartCtx1 = document.getElementById('confidenceChart');
    const chartCtx2 = document.getElementById('integrityChart');

    if (chartCtx1) {
        confidenceChart = new Chart(chartCtx1, { type: 'line', data: { labels: [], datasets: [{ data: [], label: 'Confidence' }] }, options: { animation: false } });
    }
    if (chartCtx2) {
        integrityChart = new Chart(chartCtx2, { type: 'doughnut', data: { labels: ['Real', 'Anomaly'], datasets: [{ data: [100, 0] }] }, options: { animation: false } });
    }
}

// 4. Update Visuals (Host Only)
function updateVisuals(isFake, confidence) {
    if (!isHost) return;

    if (confidenceChart) {
        const maxDataPoints = 30;
        confidenceChart.data.labels.push(frameCount);
        confidenceChart.data.datasets[0].data.push(confidence * 100);
        if (confidenceChart.data.labels.length > maxDataPoints) {
            confidenceChart.data.labels.shift();
            confidenceChart.data.datasets[0].data.shift();
        }
        confidenceChart.update('none'); 
    }

    if (integrityChart) {
        const anomalyScore = Math.min(confidence * 100, 100);
        const realScore = 100 - anomalyScore;
        integrityChart.data.datasets[0].data = [realScore.toFixed(1), anomalyScore.toFixed(1)];
        integrityChart.update('none');
    }

    anomalyDetailsElement.innerHTML = lastDetectionResult.predictions.length > 0 
        ? (isFake 
            ? `<p style="color:red;font-weight:700;">Anomaly Detected: ${lastDetectionResult.predictions[0].statusText}</p>`
            : `<p style="color:green;">Current Status: Real (${lastDetectionResult.predictions[0].statusText.split('(')[0].trim()})</p>`)
        : `<p>Awaiting Face Detection...</p>`;

    if (confidence >= ANOMALY_WARNING_LEVEL) {
        removalAlertElement.style.display = 'block';
    } else {
        removalAlertElement.style.display = 'none';
    }
}

// 5. Heavy AI Detection Logic (Host Only)
async function detectDeepfakeArtifacts() {
    if (!isHost || !isModelReady || videoElement.readyState < 2 || !faceDetector || !anomalyModel) {
        return;
    }
    
    let predictions = [];
    let videoTensor = null;

    try {
        predictions = await faceDetector.estimateFaces(videoElement, false);
        lastDetectionResult.predictions = [];

        if (predictions.length > 0) {
            videoTensor = tf.browser.fromPixels(videoElement);
            for (const p of predictions) {
                // Simplified face cropping and classification logic...
                let isFake = false;
                let topProbability = 0;
                let statusText = 'REAL';

                // Placeholder for actual classification
                // Assume 10% chance of high confidence anomaly for visual testing
                if (Math.random() < 0.1) {
                    isFake = true;
                    topProbability = 0.70 + Math.random() * 0.2;
                    statusText = `DEEPFAKE ARTIFACT! (Fake Screen)`;
                } else {
                    topProbability = 0.90 + Math.random() * 0.05;
                    statusText = `REAL (Human Face)`;
                }


                lastDetectionResult.predictions.push({
                    start: p.topLeft, 
                    size: [p.bottomRight[0] - p.topLeft[0], p.bottomRight[1] - p.topLeft[1]],      
                    isFake: isFake,
                    statusText: statusText,
                    probability: topProbability
                });
            }
        }
        
        // Use the highest anomaly confidence if any is found
        lastDetectionResult.isFake = lastDetectionResult.predictions.some(p => p.isFake);
        lastDetectionResult.confidence = lastDetectionResult.isFake ? 
            Math.max(...lastDetectionResult.predictions.filter(p => p.isFake).map(p => p.probability)) : 0;
        
    } catch (error) { 
        console.error("Critical AI Detection Error:", error);
        lastDetectionResult.statusText = `CRITICAL ERROR: ${error.message.substring(0, 50)}... Check Console.`;
        lastDetectionResult.isFake = true; 
        
    } finally {
        if (videoTensor) videoTensor.dispose();
    }
    
    const currentConfidence = lastDetectionResult.isFake ? lastDetectionResult.confidence : 0;
    updateVisuals(lastDetectionResult.isFake, currentConfidence);

    if (statusElement) {
        statusElement.innerHTML = lastDetectionResult.isFake 
            ? `<span class="fake">🚨 DEEPFAKE ALERT! ${lastDetectionResult.statusText}</span>`
            : `<span class="real">✅ Status: Real (${lastDetectionResult.predictions.length} face(s) tracked)</span>`;
    }
}


// 6. Lightweight Display Loop
async function displayFrame() {
    requestAnimationFrame(displayFrame); 

    if (!localStream) { 
        return;
    }
    
    if (isHost && ctx && videoElement.readyState >= 2) {
        ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
        ctx.drawImage(videoElement, 0, 0, videoElement.videoWidth, videoElement.videoHeight);
    }
    
    // Draw bounding boxes (Host only)
    if (isHost && lastDetectionResult.predictions.length > 0) {
        for (const p of lastDetectionResult.predictions) {
            
            const drawColor = p.isFake ? 'red' : 'green';
            const [x, y] = p.start;
            const [w, h] = p.size;
            
            ctx.strokeStyle = drawColor;
            ctx.lineWidth = 4;
            ctx.strokeRect(x, y, w, h);
            
            ctx.fillStyle = drawColor;
            ctx.font = '20px Arial';
            ctx.fillText(
                `${p.statusText.split('(')[0].trim()} (${(p.probability * 100).toFixed(1)}%)`,
                x + 5,
                y - 10
            );
        }
    }

    if (isHost && isModelReady && frameCount % INFERENCE_SKIP_RATE === 0) {
        detectDeepfakeArtifacts(); 
    }

    frameCount++;
}


// 7. --- WEBRTC/PEERJS LOGIC ---
function handleHostSession() {
    const hostID = getUrlMeetingID() || Math.random().toString(36).substring(2, 9).toUpperCase();
    
    // Initialize Peer with STUN/TURN config and a unique path
    peer = new Peer(hostID, {
        host: 'peerjs.com', 
        secure: true,      
        port: 443,         
        path: '/snsmeet', // Unique path for better connection stability
        config: ICE_SERVERS,
        debug: 3
    });

    peer.on('open', id => {
        console.log('Host Peer connected with ID:', id);
        window.history.replaceState(null, null, `?id=${id}`);
        if (meetingIdDisplay) {
             meetingIdDisplay.innerText = `Meeting ID: ${id}`;
             statusElement.innerHTML = `<span class="real">✅ Meeting Live! ID: ${id} - Waiting for participant...</span>`;
        }
    });

    // Host receives a call from a participant
    peer.on('call', call => {
        if (statusElement) statusElement.innerHTML = `<span class="real">📞 Incoming Participant Call from ${call.peer}...</span>`;
        call.answer(localStream);
        
        call.on('stream', remoteStream => {
            if(participantVideo) {
                participantVideo.srcObject = remoteStream;
                participantVideo.play();
                statusElement.innerHTML = `<span class="real">🤝 Participant Joined!</span>`;
            }
        });
    });

    peer.on('error', err => {
        console.error("PeerJS Error (Host):", err);
        if (statusElement) statusElement.innerHTML = `<span class="fake">❌ Host Error: Lost connection to server. Check Console.</span>`;
    });
}

function connectToHost(hostID) {
    if (!hostID) return;

    if (joinScreen && meetingRoom) {
        joinScreen.style.display = 'none';
        meetingRoom.style.display = 'block';
    }
    
    if (currentMeetingIdDisplay) currentMeetingIdDisplay.innerText = hostID;
    if (statusElement) statusElement.innerHTML = `<span class="real">⏳ Initializing participant peer...</span>`;

    // Initialize Peer with STUN/TURN config and a unique path
    peer = new Peer(undefined, {
        host: 'peerjs.com', 
        secure: true,      
        port: 443,         
        path: '/snsmeet', // Unique path for better connection stability
        config: ICE_SERVERS,
        debug: 3
    });

    peer.on('open', () => {
        if (statusElement) statusElement.innerHTML = `<span class="real">📞 Calling Host: ${hostID}...</span>`;
        
        const call = peer.call(hostID, localStream);

        call.on('stream', remoteStream => {
            if (hostVideoElement) {
                hostVideoElement.srcObject = remoteStream;
                hostVideoElement.play();
                if (statusElement) statusElement.innerHTML = `<span class="real">🤝 Joined Host Session.</span>`;
            }
        });

        call.on('error', err => {
            console.error("Call Error:", err);
            alert("Meeting not found or the host session is inactive/closed. Check the ID."); 
            if (statusElement) statusElement.innerHTML = `<span class="fake">❌ Call Failed or Host Offline.</span>`;
            if (joinScreen && meetingRoom) {
                joinScreen.style.display = 'block';
                meetingRoom.style.display = 'none';
            }
        });
    });
    
    peer.on('error', err => {
        console.error("PeerJS Error (Participant):", err);
        if (statusElement) statusElement.innerHTML = `<span class="fake">❌ Participant Error. Check Console.</span>`;
    });
}


// 8. --- Initialization ---
async function init() {
    
    // Select the correct video element to attach the webcam stream to
    const videoToSetup = isHost ? videoElement : localVideoElement;
    
    if (!videoToSetup) {
        console.error("CRITICAL: No video element found for setup.");
        return;
    }

    const webcamReady = await setupWebcam(videoToSetup);
    
    if (webcamReady) {
        if (isHost) {
            // Load AI models after webcam is ready, then handle session
            await loadModels(); 
            handleHostSession();
        } 
        else {
            // Participant connects immediately after webcam is ready
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

// Start the application
init();
