// Function to generate a random, shareable meeting ID
function generateMeetingId() {
    // Generates a random 8-digit hexadecimal string
    return Math.random().toString(16).substring(2, 10).toUpperCase();
}

document.addEventListener('DOMContentLoaded', () => {
    // --- Index.html Webcam Logic (Simple face tracking) ---
    const indexWebcam = document.getElementById('webcam');
    const indexStatus = document.getElementById('status');
    let faceDetector = null;

    async function initIndexWebcam() {
        if (!indexWebcam) return;
        
        indexStatus.innerHTML = "⏳ Initializing Webcam and Models...";
        
        try {
            // FIX: Ensure correct model name is used here
            faceDetector = await blazeface.load({ scoreThreshold: 0.70 });
            
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            indexWebcam.srcObject = stream;

            indexWebcam.onloadedmetadata = () => {
                indexWebcam.play();
                requestAnimationFrame(detectIndexFace);
                indexStatus.innerHTML = '<span class="real">✅ Models Ready. Status: 0 face(s) tracked.</span>';
            };

        } catch (error) {
            console.error("Initialization Error:", error);
            indexStatus.innerHTML = `<span class="fake">❌ ERROR: Could not access webcam or load models. (${error.message})</span>`;
        }
    }

    async function detectIndexFace() {
        requestAnimationFrame(detectIndexFace);
        if (!faceDetector || indexWebcam.readyState < 2) return;

        // Perform face detection only if the video is playing
        const predictions = await faceDetector.estimateFaces(indexWebcam, false);
        
        if (predictions.length > 0) {
            indexStatus.innerHTML = `<span class="real">✅ Status: ${predictions.length} face(s) tracked.</span>`;
        } else {
            indexStatus.innerHTML = `<span class="real">✅ Status: 0 face(s) tracked.</span>`;
        }
    }

    if (indexWebcam) {
        initIndexWebcam();
    }


    // --- 1. Simulated Invite Logic (for index.html) ---
    const inviteButton = document.getElementById('inviteButton');
    const participantNameInput = document.getElementById('participantName');
    const invitedCountSpan = document.getElementById('invitedCount');

    let invitedCount = 0;

    if (inviteButton) {
        inviteButton.addEventListener('click', () => {
            const name = participantNameInput.value.trim();

            if (name) {
                invitedCount++;
                invitedCountSpan.textContent = invitedCount;
                
                console.log(`Simulating invite for: ${name}. Total participants now: ${invitedCount}`);
                
                alert(`${name} has been invited!`);
                
                participantNameInput.value = '';
            } else {
                alert("Please enter a name to invite.");
            }
        });
    }

    // --- 2. Meeting Controls Logic (for host.html and meeting.html) ---
    const micToggleBtn = document.getElementById('mic-toggle-btn');
    const camToggleBtn = document.getElementById('cam-toggle-btn');

    function toggleControl(button) {
        if (!button) return;
        if (button.classList.contains('on')) {
            button.classList.remove('on');
            button.classList.add('off');
        } else {
            button.classList.remove('off');
            button.classList.add('on');
        }
    }

    if (micToggleBtn) {
        micToggleBtn.addEventListener('click', () => {
            toggleControl(micToggleBtn);
            const status = micToggleBtn.classList.contains('on') ? 'ON' : 'MUTED';
            micToggleBtn.innerHTML = micToggleBtn.classList.contains('on') 
                ? '<i class="fas fa-microphone"></i>' 
                : '<i class="fas fa-microphone-slash"></i>';
            console.log(`Microphone Status: ${status}`);
        });
    }

    if (camToggleBtn) {
        camToggleBtn.addEventListener('click', () => {
            toggleControl(camToggleBtn);
            const status = camToggleBtn.classList.contains('on') ? 'ON' : 'OFF';
            camToggleBtn.innerHTML = camToggleBtn.classList.contains('on') 
                ? '<i class="fas fa-video"></i>' 
                : '<i class="fas fa-video-slash"></i>';
            console.log(`Camera Status: ${status}`);
        });
    }

    // --- 3. Host ID Generation Logic (runs only on host.html) ---
    const meetingIdDisplay = document.getElementById('meeting-id-display');
    
    if (meetingIdDisplay) {
        const meetingId = generateMeetingId();
        
        // Construct the correct join link, accounting for deployment path
        const basePath = window.location.pathname.endsWith('/') ? '' : window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/') + 1);
        const joinLink = `${window.location.origin}${basePath}meeting.html?id=${meetingId}`;
        
        meetingIdDisplay.innerHTML = `
            <i class="fas fa-link"></i> Meeting ID: 
            <span style="color:var(--color-secondary);">${meetingId}</span> 
            <button 
                onclick="navigator.clipboard.writeText('${joinLink}'); alert('Invite Link Copied! (Share this link to join)');" 
                style="background:none; border:1px solid #777; color:#777; padding:5px 10px; margin-left:10px; border-radius:4px; font-size:0.8em; cursor:pointer;"
            >
                Copy Invite Link
            </button>
        `;
        
        // Store the ID in session storage so meeting.html can check it
        sessionStorage.setItem('currentHostId', meetingId);
    }


    // --- 4. Join Logic (runs only on meeting.html) ---
    const meetingRoom = document.getElementById('meeting-room');
    const joinScreen = document.getElementById('join-screen');
    const meetingIdInput = document.getElementById('meetingIdInput');
    const joinButton = document.getElementById('joinButton');
    const currentMeetingIdDisplay = document.getElementById('currentMeetingIdDisplay');

    function joinMeeting(id) {
        const storedHostId = sessionStorage.getItem('currentHostId');
        
        if (!id || id.length !== 8) {
            alert('Invalid Meeting ID format. Must be an 8-character code.');
            return;
        }

        // For the demo, we check against the ID stored by the host.html session.
        if (storedHostId && id === storedHostId) {
            if (joinScreen) joinScreen.style.display = 'none';
            if (meetingRoom) meetingRoom.style.display = 'block';
            if (currentMeetingIdDisplay) currentMeetingIdDisplay.textContent = id;
            console.log(`Successfully joined meeting ${id}`);
        } else {
            alert('Meeting not found or the host session is inactive/closed. (ID must match the host\'s ID)');
        }
    }

    if (meetingIdInput) {
        // 1. Check for ID in URL on page load (if link was used)
        const urlParams = new URLSearchParams(window.location.search);
        const urlId = urlParams.get('id');

        if (urlId) {
            meetingIdInput.value = urlId.toUpperCase();
            joinMeeting(urlId.toUpperCase());
        }

        // 2. Handle Join button click
        joinButton.addEventListener('click', () => {
            const inputId = meetingIdInput.value.trim().toUpperCase();
            joinMeeting(inputId);
        });
    }

});