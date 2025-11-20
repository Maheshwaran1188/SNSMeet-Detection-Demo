// --- Global DOM Elements ---
const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('detection-canvas');
const statusElement = document.getElementById('status');
const anomalyDetailsElement = document.getElementById('anomaly-details');
const removalAlertElement = document.getElementById('removal-alert');
const ctx = canvasElement.getContext('2d');

let faceDetector = null; // Holds the BlazeFace model
let anomalyModel = null;
let isModelReady = false;

// Chart.js instances
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
async function setupWebcam() {
    statusElement.innerHTML = "⏳ Requesting webcam access...";
    try {
        const stream = navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        videoElement.srcObject = await stream;

        return new Promise((resolve) => {
            videoElement.onloadedmetadata = () => {
                // Ensure canvas matches video size
                videoElement.width = videoElement.videoWidth;
                videoElement.height = videoElement.videoHeight;
                canvasElement.width = videoElement.videoWidth;
                canvasElement.height = videoElement.videoHeight;
                
                videoElement.play(); 
                resolve(videoElement);
            };
        });
    } catch (error) {
        statusElement.innerHTML = `<span class="fake">❌ ERROR: Could not access webcam. (${error.message})</span>`;
        console.error("Webcam Error:", error);
    }
}

// 2. Load Both AI Models (BlazeFace and MobileNet)
async function loadModels() {
    statusElement.innerHTML = "⏳ Loading AI Models (BlazeFace & MobileNet)...";
    
    await tf.setBackend('webgl').catch(e => console.warn("WebGL failed, falling back to CPU:", e));

    // FIX: Correctly use 'blazeface.load' to prevent the TypeError
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
                // FIX: Use the JS variable 'colorDanger', not the CSS var() function
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

// 4. Update Charts and Alerts
function updateVisuals(isFake, confidence) {
    // Update Confidence Chart
    const maxDataPoints = 30;
    
    // Add new data point (in percent)
    confidenceChart.data.labels.push(frameCount);
    confidenceChart.data.datasets[0].data.push(confidence * 100);

    // Keep the chart window clean
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

// 5. Heavy AI Detection Logic
async function detectDeepfakeArtifacts() {
    if (!isModelReady || videoElement.readyState < 2 || !faceDetector || !anomalyModel) {
        return;
    }
    
    if (videoElement.videoWidth === 0 || videoElement.videoHeight === 0) {
        console.warn("Video stream dimensions are zero. Waiting for initialization...");
        return;
    }

    let predictions = [];
    let videoTensor = null;

    try {
        // --- Step 1: Detect Faces using BlazeFace ---
        predictions = await faceDetector.estimateFaces(videoElement, false);
        
        lastDetectionResult.predictions = [];

        if (predictions.length > 0) {
            
            videoTensor = tf.browser.fromPixels(videoElement);
            
            for (const p of predictions) {
                
                // BlazeFace Coordinates
                const start = p.topLeft;
                const end = p.bottomRight;
                
                // Calculate original bounding box dimensions
                const boxW_orig = end[0] - start[0];
                const boxH_orig = end[1] - start[1];
                
                // APPLY AGGRESSIVE PADDING
                const PADDING_FACTOR = 1.3;
                const padW = (boxW_orig * PADDING_FACTOR - boxW_orig) / 2;
                const padH = (boxH_orig * PADDING_FACTOR - boxH_orig) / 2;
                
                let startX = parseInt(start[0] - padW);
                let startY = parseInt(start[1] - padH);
                let boxW = parseInt(boxW_orig * PADDING_FACTOR);
                let boxH = parseInt(boxH_orig * PADDING_FACTOR);

                // FIX: Robust NaN and Zero-Size Check
                if (isNaN(startX) || isNaN(startY) || isNaN(boxW) || isNaN(boxH) || boxW <= 0 || boxH <= 0) {
                    console.warn("BlazeFace returned invalid (NaN) coordinates or zero size. Skipping face.");
                    continue; 
                }

                // Clamp coordinates
                startX = Math.max(0, startX);
                startY = Math.max(0, startY);
                boxW = Math.min(boxW, videoTensor.shape[1] - startX);
                boxH = Math.min(boxH, videoTensor.shape[0] - startY);
                
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
                    
                    // --- Step 3: Analyze Result (Refined Anomaly Check) ---
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
        
        // Update overall status text
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
    
    // Update UI and Charts outside the try/finally
    const currentConfidence = lastDetectionResult.isFake ? lastDetectionResult.confidence : 0;
    updateVisuals(lastDetectionResult.isFake, currentConfidence);

    statusElement.innerHTML = lastDetectionResult.isFake 
        ? `<span class="fake">🚨 DEEPFAKE ALERT! ${lastDetectionResult.statusText}</span>`
        : `<span class="real">✅ Status: ${lastDetectionResult.statusText}</span>`;
}


// 6. Lightweight Display Loop
async function displayFrame() {
    requestAnimationFrame(displayFrame); 

    if (videoElement.readyState < 2) { 
        return;
    }

    // 1. Draw the current video frame onto the canvas 
    ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    ctx.drawImage(videoElement, 0, 0, videoElement.videoWidth, videoElement.videoHeight);
    
    // 2. Draw the Bounding Boxes and Text from the *LAST* detection result
    if (lastDetectionResult.predictions.length > 0) {
        for (const p of lastDetectionResult.predictions) {
            
            // Get colors for drawing the box/text
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

    // 3. Run the heavy detection logic periodically
    if (isModelReady && frameCount % INFERENCE_SKIP_RATE === 0) {
        detectDeepfakeArtifacts(); 
    }

    frameCount++;
}


// --- Initialization ---
async function init() {
    // We only run this on host.html (which includes the Chart.js library)
    if (document.getElementById('confidenceChart')) { 
        await setupWebcam(); 
        await loadModels(); 
        
        if (videoElement.srcObject && isModelReady) {
            displayFrame();
        }
    }
}

init();