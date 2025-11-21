// --- Core DOM Elements ---
const hostVideoElement = document.getElementById('webcam'); // Used by host (local) and participant (remote)
const localVideoElement = document.getElementById('localWebcam'); // Used by participant (local)
const statusElement = document.getElementById('status');
const meetingIdDisplay = document.getElementById('meeting-id-display'); // Host ID display
const currentMeetingIdDisplay = document.getElementById('currentMeetingIdDisplay'); // Participant ID display
const joinButton = document.getElementById('joinButton');
const meetingIdInput = document.getElementById('meetingIdInput');
const joinScreen = document.getElementById('join-screen');
const meetingRoom = document.getElementById('meeting-room');
const participantVideo = document.getElementById('participant-video'); // Remote participant video on host page

// Determine if we are the host based on URL (presence of specific elements can be unreliable)
const isHost = meetingIdDisplay !== null;

// --- WebRTC Variables ---
let peer = null;
let localStream = null;

// --- CRITICAL FIX: Robust STUN Server Configuration ---
const ICE_SERVERS = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' }
    ]
};


// 1. Setup Webcam Feed
async function setupWebcam(videoTargetElement) {
    if (statusElement) statusElement.innerHTML = "⏳ Requesting webcam access...";
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localStream = stream;
        videoTargetElement.srcObject = localStream;
        await new Promise((resolve) => {
            videoTargetElement.onloadedmetadata = () => {
                videoTargetElement.play();
                resolve();
            };
        });
        if (statusElement) statusElement.innerHTML = `<span class="real">✅ Webcam Connected.</span>`;
        return true;
    } catch (error) {
        if (statusElement) statusElement.innerHTML = `<span class="fake">❌ ERROR: Could not access webcam. (${error.name})</span>`;
        console.error("Webcam Error:", error);
        return false;
    }
}

function getUrlMeetingID() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('id');
}

// 2. Host Session Logic
function handleHostSession() {
    // Generate a new ID if not in URL
    const hostID = getUrlMeetingID() || Math.random().toString(36).substring(2, 9).toUpperCase();
    
    // Initialize Peer with STUN servers and high debug level
    peer = new Peer(hostID, {
        host: 'peerjs.com', 
        secure: true,      
        port: 443,         
        path: '/',
        config: ICE_SERVERS,
        debug: 3 // High debug level for troubleshooting
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
        
        // Answer the call, sending local stream (webcam)
        call.answer(localStream);
        
        call.on('stream', remoteStream => {
            // Display the remote participant's stream
            if(participantVideo) {
                participantVideo.srcObject = remoteStream;
                participantVideo.play();
                statusElement.innerHTML = `<span class="real">🤝 Participant Joined!</span>`;
            }
        });
    });

    peer.on('error', err => {
        console.error("PeerJS Error (Host):", err);
        if (statusElement) statusElement.innerHTML = `<span class="fake">❌ WEBRTC Error. Check Console.</span>`;
    });
}

// 3. Participant Connection Logic
function connectToHost(hostID) {
    if (!hostID) return;

    // Show meeting room
    if (joinScreen && meetingRoom) {
        joinScreen.style.display = 'none';
        meetingRoom.style.display = 'block';
    }
    
    if (currentMeetingIdDisplay) currentMeetingIdDisplay.innerText = hostID;
    if (statusElement) statusElement.innerHTML = `<span class="real">⏳ Initializing participant peer...</span>`;

    // Initialize Peer with STUN servers and high debug level
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
        
        // Initiate the call to the host, sending local stream
        const call = peer.call(hostID, localStream);

        call.on('stream', remoteStream => {
            // Display the stream received from the host
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

// 4. Initialization
async function init() {
    
    let videoToSetup;
    
    if (isHost) {
        // Host only needs to set up the main video element
        videoToSetup = hostVideoElement;
    } else {
        // Participant sets up their own local video element (localWebcam)
        videoToSetup = localVideoElement;
        // Fallback if localWebcam isn't defined (shouldn't happen with correct HTML)
        if (!videoToSetup) videoToSetup = hostVideoElement; 
    }
    
    if (!videoToSetup) {
        console.error("CRITICAL: No video element found for setup.");
        return;
    }

    const webcamReady = await setupWebcam(videoToSetup);
    
    if (webcamReady) {
        if (isHost) {
            handleHostSession();
        } 
        else {
            // Participant login logic
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
}

// Start the application
init();
