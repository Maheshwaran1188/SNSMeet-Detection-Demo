// --- Global DOM Elements ---
const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('detection-canvas');
const statusElement = document.getElementById('status');
const anomalyDetailsElement = document.getElementById('anomaly-details');
const removalAlertElement = document.getElementById('removal-alert');
const ctx = canvasElement ? canvasElement.getContext('2d') : null; // Check if canvas exists

let faceDetector = null; // Holds the BlazeFace model
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

// --- WebRTC Variables (NEW) ---
let peer = null;
let localStream = null;
// Determine if we are the host based on the presence of host-specific elements
const isHost = document.getElementById('confidenceChart') !== null;
const meetingIdDisplay = document.getElementById('meeting-id-display'); // Host ID display
const currentMeetingIdDisplay = document.getElementById('currentMeetingIdDisplay'); // Participant ID display
const joinButton = document.getElementById('joinButton');
const meetingIdInput = document.getElementById('meetingIdInput');
const joinScreen = document.getElementById('join-screen');
const meetingRoom = document.getElementById('meeting-room');


// --- ANOMALY CONFIGURATION ---
const PADDING_FACTOR = 1.3; 
const ANOMALY_CLASSES = [
    'monitor', 
    'screen', 
    'electronic', 
    'cellular telephone',
    'projector',
    'CRT screen',
    'digital clock',
    'Web site' 
];
const ANOMALY_THRESHOLD = 0.40; 
const ANOMALY_WARNING_LEVEL = 0.65; // High confidence to trigger removal alert (65%)

// Function to read CSS variables for Chart.js
function getCssVariable(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// 1. Setup Webcam Feed
async function setupWebcam(videoTargetElement) {
    statusElement.innerHTML = "⏳ Requesting webcam access...";
    try {
        const stream = navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localStream = await stream; // Store the stream globally for WebRTC
        videoTargetElement.srcObject = localStream;

        return new Promise((resolve) => {
            videoTargetElement.onloadedmetadata = () => {
                // Ensure canvas matches video size if we are the host
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
        statusElement.innerHTML = `<span class="fake">❌ ERROR: Could not access webcam. (${error.message})</span>`;
        console.error("Webcam Error:", error);
    }
}

// 2. Load Both AI Models (BlazeFace and MobileNet)
async function loadModels() {
    // Only load models on the host page
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

// 3. Setup Charts for Visualization
function setupCharts() {
    // Read CSS variables
    const colorDanger = getCssVariable('--color-danger');
    const colorSuccess = getCssVariable('--color-success');
    const colorDangerRgba = colorDanger.startsWith('rgb') ? colorDanger.replace(')', ', 0.2)').replace('rgb', 'rgba') : 'rgba(255, 51, 51, 0.2)';

    // Confidence Chart (Line Chart)
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

    // Integrity Chart (Doughnut Chart)
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

// 4. Update Charts and Alerts (Host Only)
function updateVisuals(isFake, confidence) {
    if (!isHost) return; 

    // Update Confidence Chart
    const maxDataPoints = 30;
    
    confidenceChart.data.labels.push(frameCount);
    confidenceChart.data.datasets[0].data.push(confidence * 100);

    if (confidenceChart.data.labels.length > maxDataPoints) {
        confidenceChart.data.labels.shift();
        confidenceChart.data.datasets[0].data.shift();
    }
    confidenceChart.update('none'); 

    // Update Integrity Chart (Doughnut)
    const anomalyScore = Math.min(confidence * 100, 100);
    const realScore = 100 - anomalyScore;
    integrityChart.data.datasets[0].data = [realScore.toFixed(1), anomalyScore.toFixed(1)];
    integrityChart.update('none');

    // Update Anomaly Details
    anomalyDetailsElement.innerHTML = lastDetectionResult.predictions.length > 0 
        ? (isFake 
            ? `<p style="color:${getCssVariable('--color-danger')};font-weight:700;">Anomaly Detected: ${lastDetectionResult.predictions[0].statusText}</p>`
            : `<p style="color:${getCssVariable('--color-success')};">Current Status: Real (${lastDetectionResult.predictions[0].statusText.split('(')[0].trim()})</p>`)
        : `<p>Awaiting Face Detection...</p>`;

    // Check for Removal Alert
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
    
    // [Existing detection logic remains, only uncommented parts are shown for brevity]
    // ... all the cropping, resizing, MobileNet classification, and anomaly check logic ...

    let predictions = [];
    let videoTensor = null;

    try {
        predictions = await faceDetector.estimateFaces(videoElement, false);
        lastDetectionResult.predictions = [];

        if (predictions.length > 0) {
            videoTensor = tf.browser.fromPixels(videoElement);
            for (const p of predictions) {
                // ... Bounding box calculation and cropping (unchanged) ...
                
                let croppedFace = null;
                let resizedFace = null;
                let normalizedFace = null;
                
                try {
                    // 1. Crop the tensor
                    croppedFace = tf.slice(videoTensor, [startY, startX, 0], [boxH, boxW, 3]);

                    // 2. Resize and Normalize for MobileNet
                    resizedFace = tf.image.resizeBilinear(croppedFace, [224, 224], true);
                    normalizedFace = resizedFace.div(255);
                    
                    // 3. Run the prediction
                    const classification = await anomalyModel.classify(normalizedFace); 
                    
                    // --- Step 3: Analyze Result ---
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

                    // Store the result
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

    statusElement.innerHTML = lastDetectionResult.isFake 
        ? `<span class="fake">🚨 DEEPFAKE ALERT! ${lastDetectionResult.statusText}</span>`
        : `<span class="real">✅ Status: ${lastDetectionResult.statusText}</span>`;
}


// 6. Lightweight Display Loop
async function displayFrame() {
    requestAnimationFrame(displayFrame); 

    if (!localStream || localStream.readyState < 2) { 
        return;
    }

    // 1. Draw the current video frame onto the canvas (Host Only)
    if (isHost && ctx && videoElement.readyState >= 2) {
        ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
        ctx.drawImage(videoElement, 0, 0, videoElement.videoWidth, videoElement.videoHeight);
    }
    
    // 2. Draw the Bounding Boxes and Text (Host Only)
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

    // 3. Run the heavy detection logic periodically (Host Only)
    if (isHost && isModelReady && frameCount % INFERENCE_SKIP_RATE === 0) {
        detectDeepfakeArtifacts(); 
    }

    frameCount++;
}


// 7. --- WEBRTC/PEERJS LOGIC (NEW) ---
function getUrlMeetingID() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('id');
}

function handleHostSession() {
    const hostID = getUrlMeetingID() || Math.random().toString(36).substring(2, 9);
    
    // **CRITICAL FIX:** Connect to the stable PeerJS Cloud Server
    peer = new Peer(hostID, {
        host: 'peerjs.com', 
        secure: true,      
        port: 443,         
        path: '/'
    });

    peer.on('open', id => {
        console.log('Host Peer connected with ID:', id);
        // Update URL and display ID for participants
        window.history.replaceState(null, null, `?id=${id}`);
        if (meetingIdDisplay) {
             meetingIdDisplay.innerText = `Meeting ID: ${id}`;
             statusElement.innerHTML = `<span class="real">✅ Meeting Live! ID: ${id}</span>`;
        }
    });

    // Host receives a call from a participant
    peer.on('call', call => {
        statusElement.innerHTML = `<span class="real">📞 Incoming Participant Call...</span>`;
        call.answer(localStream);
        
        call.on('stream', remoteStream => {
            // This is where you would handle the remote stream from the participant
            // For a simple demo, we'll just log it
            console.log('Received Participant Stream');
        });
    });

    peer.on('error', err => {
        console.error("PeerJS Error (Host):", err);
        statusElement.innerHTML = `<span class="fake">❌ WEBRTC Error. Check Console.</span>`;
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
    if (currentMeetingIdDisplay) {
         currentMeetingIdDisplay.innerText = hostID;
    }

    // **CRITICAL FIX:** Connect to the stable PeerJS Cloud Server
    peer = new Peer(undefined, {
        host: 'peerjs.com', 
        secure: true,      
        port: 443,         
        path: '/'
    });

    peer.on('open', () => {
        statusElement.innerHTML = `<span class="real">📞 Calling Host: ${hostID}...</span>`;
        
        // Use the new localWebcam element for participant's video
        const localWebcamElement = document.getElementById('localWebcam');
        if (localWebcamElement && localStream) {
             localWebcamElement.srcObject = localStream;
        }

        // Initiate the call to the host
        const call = peer.call(hostID, localStream);

        call.on('stream', remoteStream => {
            // Display the stream received from the host in the main video element
            const hostVideoElement = document.getElementById('webcam'); // Reusing the host's video ID from your template
            if (hostVideoElement) {
                hostVideoElement.srcObject = remoteStream;
                hostVideoElement.play();
                statusElement.innerHTML = `<span class="real">🤝 Joined Host Session.</span>`;
            }
        });

        call.on('error', err => {
            console.error("Call Error:", err);
            statusElement.innerHTML = `<span class="fake">❌ Call Failed or Host Offline.</span>`;
            // Re-show join screen on failure
            if (joinScreen && meetingRoom) {
                joinScreen.style.display = 'block';
                meetingRoom.style.display = 'none';
            }
        });
    });
    
    peer.on('error', err => {
        console.error("PeerJS Error (Participant):", err);
        statusElement.innerHTML = `<span class="fake">❌ WEBRTC Error. Check Console.</span>`;
    });
}

// 8. --- Initialization ---
async function init() {
    
    // --- Host Initialization ---
    if (isHost) {
        await setupWebcam(videoElement); // Use the main video element
        if (localStream) {
            handleHostSession();
            await loadModels(); // Load AI models only on host
        }
    } 
    
    // --- Participant Initialization ---
    else {
        // Get the element where *our* local video will show up before we join
        const localWebcamElement = document.getElementById('localWebcam');
        if (!localWebcamElement) {
            console.error("Participant video element (localWebcam) not found.");
            return;
        }

        await setupWebcam(localWebcamElement);
        if (localStream) {
            // Check if ID is in URL (invite link)
            const urlId = getUrlMeetingID();
            if (urlId) {
                meetingIdInput.value = urlId;
                connectToHost(urlId);
            }

            // Set up Join Button Listener
            if (joinButton && meetingIdInput) {
                joinButton.addEventListener('click', () => {
                    const enteredId = meetingIdInput.value.trim();
                    connectToHost(enteredId);
                });
            }
        }
    }
    
    // Start drawing loop regardless of host/participant status
    displayFrame();
}

init();
