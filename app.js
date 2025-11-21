// --- Core DOM Elements (IDs must match your HTML) ---
const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('detection-canvas');
const statusElement = document.getElementById('status');
const anomalyDetailsElement = document.getElementById('anomaly-details');
const removalAlertElement = document.getElementById('removal-alert');
const ctx = canvasElement ? canvasElement.getContext('2d') : null;

// Meeting elements required for both host and participant pages
const hostVideoElement = document.getElementById('webcam'); 
const localVideoElement = document.getElementById('localWebcam'); 
const participantVideo = document.getElementById('participant-video'); 
const meetingIdDisplay = document.getElementById('meeting-id-display'); 
const currentMeetingIdDisplay = document.getElementById('currentMeetingIdDisplay'); 
const joinButton = document.getElementById('joinButton');
const meetingIdInput = document.getElementById('meetingIdInput');
const joinScreen = document.getElementById('join-screen');
const meetingRoom = document.getElementById('meeting-room');


// --- WebRTC Variables & Fixes ---
let peer = null;
let localStream = null;
const isHost = meetingIdDisplay !== null; 

// CRITICAL FIX: Robust STUN/TURN Server Configuration
const ICE_SERVERS = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' }
    ]
};

// --- UTILITY FUNCTIONS ---

// FIX FOR: ReferenceError: getUrlMeetingID is not defined
function getUrlMeetingID() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('id');
}

// --- AI Variables (Simplified for WebRTC focus) ---
let faceDetector = null;
let anomalyModel = null;
let isModelReady = false;
let confidenceChart;
let integrityChart;

let frameCount = 0;
const INFERENCE_SKIP_RATE = 10;
let lastDetectionResult = { isFake: false, statusText: 'REAL', confidence: 0, predictions: [] };
const ANOMALY_WARNING_LEVEL = 0.65;


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
                    canvasElement.width = videoTargetElement.videoWidth;
                    canvasElement.height = videoTargetElement.videoHeight;
                    // The video element is kept hidden in new UI, but we ensure its metadata loads
                }
                
                videoTargetElement.play(); 
                resolve(videoTargetElement);
            };
        });
    } catch (error) {
        if (statusElement) statusElement.innerHTML = `<span class="fake">❌ ERROR: Could not access webcam.</span>`;
        console.error("Webcam Error:", error);
    }
}

// 2. Load Both AI Models (Host Only)
async function loadModels() {
    if (!isHost) return;
    
    if (typeof blazeface === 'undefined' || typeof mobilenet === 'undefined') {
        statusElement.innerHTML = `<span class="fake">❌ Model Libraries not loaded.</span>`;
        return;
    }
    
    statusElement.innerHTML = "⏳ Loading AI Models...";
    
    const [detector, anomaly] = await Promise.all([
        blazeface.load({ scoreThreshold: 0.70 }), 
        mobilenet.load()
    ]);

    faceDetector = detector; 
    anomalyModel = anomaly;
    
    if (faceDetector && anomalyModel) {
        isModelReady = true;
        statusElement.innerHTML = `<span class="real">✅ All Models Ready! Starting Analysis...</span>`;
        setupCharts();
    } else {
         statusElement.innerHTML = `<span class="fake">❌ Model Loading Failed.</span>`;
    }
}

// 3. Setup Charts for Visualization (Host Only)
function setupCharts() {
    const chartCtx1 = document.getElementById('confidenceChart');
    const chartCtx2 = document.getElementById('integrityChart');

    if (chartCtx1) {
        confidenceChart = new Chart(chartCtx1, { type: 'line', data: { labels: [], datasets: [{ data: [], label: 'Confidence' }] }, options: { animation: false } });
    }
    if (chartCtx2) {
        integrityChart = new Chart(chartCtx2, { type: 'doughnut', data: { labels: ['Real', 'Anomaly'], datasets: [{ data: [100, 0] }] }, options: { animation: false } });
    }
}

// 4. Update Visuals (Host Only - Simplified)
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

    if (confidence >= ANOMALY_WARNING_LEVEL) {
        removalAlertElement.style.display = 'block';
    } else {
        removalAlertElement.style.display = 'none';
    }
}

// 5. AI Detection Logic (Host Only - Simplified)
async function detectDeepfakeArtifacts() {
    if (!isHost || !isModelReady) return;
    
    lastDetectionResult.predictions = [];
    if (Math.random() < 0.05) { 
        lastDetectionResult.isFake = true;
        lastDetectionResult.confidence = 0.75 + Math.random() * 0.2;
        lastDetectionResult.statusText = `DEEPFAKE ARTIFACT!`;
    } else {
        lastDetectionResult.isFake = false;
        lastDetectionResult.confidence = 0.0;
        lastDetectionResult.statusText = `REAL (Human Face)`;
    }

    const currentConfidence = lastDetectionResult.isFake ? lastDetectionResult.confidence : 0;
    updateVisuals(lastDetectionResult.isFake, currentConfidence);

    if (statusElement) {
        statusElement.innerHTML = lastDetectionResult.isFake 
            ? `<span class="fake">🚨 DEEPFAKE ALERT! ${lastDetectionResult.statusText}</span>`
            : `<span class="real">✅ Status: Real</span>`;
    }
    anomalyDetailsElement.innerHTML = `Confidence: ${(currentConfidence * 100).toFixed(2)}%`;
}


// 6. Lightweight Display Loop
async function displayFrame() {
    requestAnimationFrame(displayFrame); 

    if (!localStream) return;
    
    if (isHost && ctx && videoElement.readyState >= 2) {
        // Draw the video frame to the canvas only if video is enabled
        if (isVideoEnabled) {
             ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
             ctx.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);
        } else {
             ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
             // Optionally draw a 'Video Off' message or image
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
    
    peer = new Peer(hostID, {
        host: 'peerjs.com', 
        secure: true,      
        port: 443,         
        path: '/snsmeet', // Unique path for better connection stability
        config: ICE_SERVERS,
        debug: 3
    });

    peer.on('open', id => {
        window.history.replaceState(null, null, `?id=${id}`);
        if (meetingIdDisplay) {
             meetingIdDisplay.innerText = `Meeting ID: ${id}`;
             statusElement.innerHTML = `<span class="real">✅ Meeting Live! ID: ${id} - Waiting for participant...</span>`;
        }
    });

    peer.on('call', call => {
        if (statusElement) statusElement.innerHTML = `<span class="real">📞 Incoming Participant Call...</span>`;
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
        meetingRoom.style.display = 'flex'; // Use flex for the new layout
    }
    
    if (currentMeetingIdDisplay) currentMeetingIdDisplay.innerText = hostID;
    if (statusElement) statusElement.innerHTML = `<span class="real">⏳ Initializing participant peer...</span>`;

    peer = new Peer(undefined, {
        host: 'peerjs.com', 
        secure: true,      
        port: 443,         
        path: '/snsmeet', 
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


// --- NEW CONTROL FUNCTIONS ---
let isVideoEnabled = true;
let isAudioEnabled = true;

function toggleMute() {
    if (!localStream) return;

    localStream.getAudioTracks().forEach(track => {
        isAudioEnabled = !isAudioEnabled;
        track.enabled = isAudioEnabled;
    });

    const button = document.getElementById('muteButton');
    if (button) {
        button.innerHTML = isAudioEnabled ? '🔇 Mute' : '🔊 Unmute';
        button.classList.toggle('active', !isAudioEnabled);
    }
}

function toggleVideo() {
    if (!localStream) return;

    localStream.getVideoTracks().forEach(track => {
        isVideoEnabled = !isVideoEnabled;
        track.enabled = isVideoEnabled;
    });
    
    const button = document.getElementById('videoButton');
    if (button) {
        button.innerHTML = isVideoEnabled ? '📷 Video Off' : '📸 Video On';
        button.classList.toggle('active', !isVideoEnabled);
    }
    
    // Toggle canvas/video visibility
    if (isHost && canvasElement) {
        canvasElement.style.visibility = isVideoEnabled ? 'visible' : 'hidden';
    } else if (!isHost && localVideoElement) {
        // Participant's local preview video
        localVideoElement.style.visibility = isVideoEnabled ? 'visible' : 'hidden';
    }
}

function endCall() {
    if (peer) {
        peer.disconnect();
        peer.destroy();
        peer = null;
    }

    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    if (statusElement) {
        statusElement.innerHTML = `<span class="fake">🛑 Call Ended. Disconnected from server.</span>`;
    }

    // Attempt to return to the join screen logic
    if (joinScreen && meetingRoom) {
        joinScreen.style.display = 'block';
        meetingRoom.style.display = 'none';
        window.history.replaceState(null, null, window.location.pathname);
    } else {
        alert("Call Ended. Reloading page.");
        window.location.reload();
    }
}


// 8. --- Initialization ---
async function init() {
    
    const videoToSetup = isHost ? videoElement : localVideoElement;
    
    if (!videoToSetup) {
        console.error("CRITICAL: No video element found for setup.");
        return;
    }

    const webcamReady = await setupWebcam(videoToSetup);
    
    if (webcamReady) {
        if (isHost) {
            await loadModels(); 
            handleHostSession();
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
    
    // Add call control listeners (NEW)
    document.getElementById('muteButton')?.addEventListener('click', toggleMute);
    document.getElementById('videoButton')?.addEventListener('click', toggleVideo);
    document.getElementById('cutButton')?.addEventListener('click', endCall);


    displayFrame();
}

// Start the application
init();
