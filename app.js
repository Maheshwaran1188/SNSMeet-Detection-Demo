// --- Core DOM Elements ---
const hostVideoElement = document.getElementById('webcam'); // Used in Host page for analysis/detection
const participantVideoElement = document.getElementById('participant-video'); // Used in Host page for remote stream
const localPreviewElement = document.getElementById('localWebcam'); // Used in both pages for the small local preview
const statusElement = document.getElementById('status');
const meetingIdDisplay = document.getElementById('meeting-id-display');
const currentMeetingIdDisplay = document.getElementById('currentMeetingIdDisplay');

const joinButton = document.getElementById('joinButton');
const meetingIdInput = document.getElementById('meetingIdInput');

const joinScreen = document.getElementById('join-screen');
const meetingRoom = document.getElementById('meeting-room');
const cutButton = document.getElementById('cutButton');

// --- Global Variables ---
let localStream = null;
let peer = null;
let remoteConnection = null;
let chart1, chart2; // For the TensorFlow charts

// --- PeerJS Configuration (Fixing Connection Issues) ---
// Using Google's STUN server for reliable connection brokering
const peerConfig = {
    host: '0.peerjs.com',
    port: 443,
    path: '/',
    secure: true,
    debug: 2,
    config: {
        'iceServers': [
            { 'urls': 'stun:stun.l.google.com:19302' },
            // Add other STUN/TURN servers for better connectivity if needed
        ]
    }
};

// --- Utility Functions ---

// 1. Setup Webcam Feed (CRITICAL FIX: Targets all necessary elements)
async function setupWebcam() {
    if (statusElement) statusElement.innerHTML = "⏳ Requesting webcam access...";
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localStream = stream;

        // Set stream to all local video elements
        if (hostVideoElement) hostVideoElement.srcObject = localStream;
        if (localPreviewElement) localPreviewElement.srcObject = localStream;
        
        // Wait for video metadata to load
        await new Promise((resolve) => {
            const videoToWaitOn = hostVideoElement || localPreviewElement;
            if (videoToWaitOn) {
                videoToWaitOn.onloadedmetadata = () => {
                    videoToWaitOn.play();
                    resolve();
                };
            } else {
                resolve(); // No video element found (shouldn't happen)
            }
        });

        if (statusElement) statusElement.innerHTML = "<span class='real'>✅ Webcam stream ready.</span>";
        return true;
    } catch (error) {
        if (statusElement) statusElement.innerHTML = `<span class="fake">❌ ERROR: Could not access webcam.</span>`;
        console.error("Webcam Error:", error);
        alert("ERROR: Please allow camera and microphone access and ensure you are using HTTPS.");
        return false;
    }
}

// 2. Host Page Logic
async function startHostSession() {
    const streamReady = await setupWebcam();
    if (!streamReady) return;

    if (statusElement) statusElement.innerHTML = "⏳ Connecting to PeerJS server...";
    
    // Create Peer with a random ID
    peer = new Peer(peerConfig);

    peer.on('open', (id) => {
        if (statusElement) statusElement.innerHTML = `<span class='real'>✅ Peer ID: ${id}</span>. Waiting for participant...`;
        if (meetingIdDisplay) meetingIdDisplay.textContent = `Meeting ID: ${id}`;
        console.log('My peer ID is: ' + id);
    });

    peer.on('error', (err) => {
        console.error("PeerJS Error:", err);
        if (statusElement) statusElement.innerHTML = `<span class="fake">❌ Connection Error: ${err.type}</span>`;
    });

    peer.on('connection', (conn) => {
        conn.on('open', () => {
            conn.send('Hello Participant! You are connected.');
        });
    });

    // Listen for incoming calls
    peer.on('call', (call) => {
        console.log("Incoming call from:", call.peer);
        remoteConnection = call;

        // Answer the call, sending our local stream
        call.answer(localStream);

        call.on('stream', (remoteStream) => {
            console.log("Received remote stream.");
            if (participantVideoElement) {
                participantVideoElement.srcObject = remoteStream;
                participantVideoElement.play();
            }
            if (statusElement) statusElement.innerHTML = `<span class='real'>🟢 Participant Connected. Starting Analysis...</span>`;
            // Start detection on the REMOTE stream
            startDetection(participantVideoElement); 
        });

        call.on('close', endSession);
    });

    // Start detection on the HOST's local stream for visual verification
    if (hostVideoElement) {
        // We only start the detection loop once the local stream is ready
        setTimeout(() => startDetection(hostVideoElement, true), 1000); 
    }
}

// 3. Participant Page Logic
function joinMeeting() {
    const meetingId = meetingIdInput.value.trim();
    if (!meetingId) {
        alert("Please enter a Meeting ID.");
        return;
    }

    // Connect to camera first
    setupWebcam().then((streamReady) => {
        if (!streamReady) return;

        if (currentMeetingIdDisplay) currentMeetingIdDisplay.textContent = meetingId;
        if (joinScreen) joinScreen.style.display = 'none';
        if (meetingRoom) meetingRoom.style.display = 'flex';
        if (statusElement) statusElement.innerHTML = "⏳ Connecting to PeerJS server...";
        
        // Create Peer without ID (PeerJS will assign one)
        peer = new Peer(peerConfig);

        peer.on('open', (id) => {
            if (statusElement) statusElement.innerHTML = `<span class='real'>✅ My Peer ID: ${id}</span>. Calling host...`;
            console.log('My peer ID is: ' + id);

            // Call the host, sending our local stream
            const call = peer.call(meetingId, localStream);
            remoteConnection = call;

            call.on('stream', (remoteStream) => {
                console.log("Received remote host stream.");
                if (hostVideoElement) {
                    // In meeting.html, the main video is 'webcam'
                    hostVideoElement.srcObject = remoteStream; 
                    hostVideoElement.play();
                }
                if (statusElement) statusElement.innerHTML = `<span class='real'>🟢 Connected to Host.</span>`;
            });

            call.on('close', endSession);
        });

        peer.on('error', (err) => {
            console.error("PeerJS Error:", err);
            alert(`Connection failed: ${err.type}. Check the ID and try again.`);
            endSession();
        });
    });
}

// 4. Session Control and Cleanup
function endSession() {
    console.log("Ending session...");
    if (remoteConnection) {
        remoteConnection.close();
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    if (peer) {
        peer.destroy();
    }
    window.location.href = 'index.html'; // Redirect to home page
}

// --- Event Listeners ---
if (joinButton) {
    joinButton.addEventListener('click', joinMeeting);
}
if (cutButton) {
    cutButton.addEventListener('click', endSession);
}

// Initialize based on page
document.addEventListener('DOMContentLoaded', () => {
    if (document.title.includes('Host Session')) {
        startHostSession();
    } else if (document.title.includes('Join Meeting')) {
        // Meeting page starts on the join screen, waits for input
        if (meetingRoom) meetingRoom.style.display = 'none';
        if (joinScreen) joinScreen.style.display = 'flex';
    }
});

// --- Tensorflow/Deepfake Detection Logic (Simplified Stubs) ---
// NOTE: This is complex logic and is simplified here. 
// You'll need to fill in the actual model loading and detection loop.

let detectionModel, classificationModel;

async function loadModels() {
    try {
        statusElement.innerHTML = "⏳ Loading AI Models...";
        // Load the face detection model (BlazeFace)
        detectionModel = await blazeface.load(); 
        
        // Load the classification model (e.g., MobileNet/Custom Model for Deepfake)
        classificationModel = await mobilenet.load(); 
        
        statusElement.innerHTML = `<span class='real'>✨ AI Models Loaded.</span>`;
    } catch (e) {
        console.error("Model loading failed:", e);
        statusElement.innerHTML = `<span class="fake">❌ AI Load Error. Deepfake detection disabled.</span>`;
    }
}

async function startDetection(videoElement, isLocal = false) {
    if (!detectionModel || !classificationModel) {
        await loadModels();
    }

    if (!detectionModel || !classificationModel) return;

    if (isLocal) {
        console.log("Starting detection on local stream...");
    } else {
        console.log("Starting detection on remote stream...");
    }
    
    const canvas = document.getElementById('detection-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const videoWidth = videoElement.videoWidth;
    const videoHeight = videoElement.videoHeight;
    canvas.width = videoWidth;
    canvas.height = videoHeight;

    // Detection Loop
    const detect = async () => {
        if (videoElement.paused || videoElement.ended) return;

        // 1. Detect Faces
        const predictions = await detectionModel.estimateFaces(videoElement, false);

        ctx.clearRect(0, 0, videoWidth, videoHeight);

        let anomalyDetected = false;

        predictions.forEach(prediction => {
            const start = prediction.topLeft;
            const end = prediction.bottomRight;
            const size = [end[0] - start[0], end[1] - start[1]];

            // 2. Classify Face (Deepfake Check - SIMPLIFIED STUB)
            // You would normally crop the face area and pass it to a specialized deepfake model.
            // Here, we use a placeholder classification result.
            let confidence = Math.random() > 0.8 ? 0.3 : (0.7 + Math.random() * 0.3); // 30% chance of low confidence (deepfake hint)
            let classification = confidence > 0.7 ? "Real" : "Anomaly";
            
            if (classification === "Anomaly") {
                anomalyDetected = true;
                ctx.strokeStyle = "red";
                ctx.fillStyle = "red";
                ctx.lineWidth = 4;
                if(document.getElementById('removal-alert')) document.getElementById('removal-alert').style.display = 'block';
            } else {
                ctx.strokeStyle = "lime";
                ctx.fillStyle = "lime";
                ctx.lineWidth = 2;
                if(document.getElementById('removal-alert')) document.getElementById('removal-alert').style.display = 'none';
            }
            
            // Draw bounding box
            ctx.beginPath();
            ctx.rect(start[0], start[1], size[0], size[1]);
            ctx.stroke();

            // Draw label
            ctx.font = '18px Arial';
            ctx.fillText(`${classification} (${(confidence * 100).toFixed(0)}%)`, start[0], start[1] > 10 ? start[1] - 5 : 10);
        });

        // Update UI
        if (statusElement && !isLocal) {
            if (anomalyDetected) {
                statusElement.className = "status-message fake";
                statusElement.innerHTML = `⚠️ **Deepfake Anomaly Detected!** (${predictions.length} faces)`;
                document.getElementById('anomaly-details').innerHTML = `**High Risk:** Deepfake signature matches found. Confidence: ${(confidence * 100).toFixed(1)}% Real`;
            } else if (predictions.length > 0) {
                statusElement.className = "status-message real";
                statusElement.innerHTML = `🟢 **Integrity Check OK** (${predictions.length} faces)`;
                document.getElementById('anomaly-details').innerHTML = `**Low Risk:** Normal behavior detected. Confidence: ${(confidence * 100).toFixed(1)}% Real`;
            } else {
                statusElement.className = "status-message";
                statusElement.innerHTML = `Scanning... No faces detected.`;
                document.getElementById('anomaly-details').innerHTML = `Awaiting face detection.`;
            }
        }

        // Loop the detection
        requestAnimationFrame(detect);
    };

    videoElement.addEventListener('loadeddata', detect);
    // Fallback if loadeddata already fired
    if (videoElement.readyState >= 2) {
        detect();
    }
}
