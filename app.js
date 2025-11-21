// --- Core DOM Elements (Make sure these IDs exist in your HTML) ---
const hostVideoElement = document.getElementById('webcam'); // Host's local video / Participant's remote video
const localVideoElement = document.getElementById('localWebcam'); // Participant's local video
const participantVideo = document.getElementById('participant-video'); // Host's remote participant video
const statusElement = document.getElementById('status');
const meetingIdDisplay = document.getElementById('meeting-id-display'); // Host ID display
const currentMeetingIdDisplay = document.getElementById('currentMeetingIdDisplay'); // Participant ID display
const joinButton = document.getElementById('joinButton');
const meetingIdInput = document.getElementById('meetingIdInput');
const joinScreen = document.getElementById('join-screen');
const meetingRoom = document.getElementById('meeting-room');

// Determine if we are the host
const isHost = meetingIdDisplay !== null;

let peer = null;
let localStream = null;

// --- CRITICAL FIX: Robust STUN Server Configuration ---
// This is the most crucial part to stop "Lost connection to server" errors (image 5)
const ICE_SERVERS = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' }
    ]
};

// --- UTILITY FUNCTIONS ---

function getUrlMeetingID() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('id');
}

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
        if (statusElement) statusElement.innerHTML = `<span style="color:#4CAF50;">✅ Webcam Connected.</span>`;
        return true;
    } catch (error) {
        if (statusElement) statusElement.innerHTML = `<span style="color:#FF3333;">❌ ERROR: Webcam access denied.</span>`;
        console.error("Webcam Error:", error);
        return false;
    }
}

// 2. Host Session Logic
function handleHostSession() {
    const hostID = getUrlMeetingID() || Math.random().toString(36).substring(2, 9).toUpperCase();
    
    // Initialize Peer with STUN servers and high debug level
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
        window.history.replaceState(null, null, `?id=${id}`);
        if (meetingIdDisplay) {
             meetingIdDisplay.innerText = `Meeting ID: ${id}`;
             statusElement.innerHTML = `<span style="color:#4CAF50;">✅ Meeting Live! ID: ${id} - Waiting for participant...</span>`;
        }
    });

    // Host receives a call from a participant
    peer.on('call', call => {
        if (statusElement) statusElement.innerHTML = `<span style="color:#4CAF50;">📞 Incoming Participant Call from ${call.peer}...</span>`;
        call.answer(localStream);
        
        call.on('stream', remoteStream => {
            if(participantVideo) {
                participantVideo.srcObject = remoteStream;
                participantVideo.play();
                statusElement.innerHTML = `<span style="color:#4CAF50;">🤝 Participant Joined!</span>`;
            }
        });
    });

    peer.on('error', err => {
        console.error("PeerJS Error (Host):", err);
        if (statusElement) statusElement.innerHTML = `<span style="color:#FF3333;">❌ Host WEBRTC Error. Check Console.</span>`;
    });
}

// 3. Participant Connection Logic
function connectToHost(hostID) {
    if (!hostID) return;

    if (joinScreen && meetingRoom) {
        joinScreen.style.display = 'none';
        meetingRoom.style.display = 'block';
    }
    
    if (currentMeetingIdDisplay) currentMeetingIdDisplay.innerText = hostID;
    if (statusElement) statusElement.innerHTML = `<span style="color:#4CAF50;">⏳ Initializing participant peer...</span>`;

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
        if (statusElement) statusElement.innerHTML = `<span style="color:#4CAF50;">📞 Calling Host: ${hostID}...</span>`;
        
        // Initiate the call to the host, sending local stream
        const call = peer.call(hostID, localStream);

        call.on('stream', remoteStream => {
            // Display the stream received from the host
            if (hostVideoElement) {
                hostVideoElement.srcObject = remoteStream;
                hostVideoElement.play();
                if (statusElement) statusElement.innerHTML = `<span style="color:#4CAF50;">🤝 Joined Host Session.</span>`;
            }
        });

        call.on('error', err => {
            console.error("Call Error:", err);
            alert("Meeting not found or the host session is inactive/closed. Check the ID."); 
            if (statusElement) statusElement.innerHTML = `<span style="color:#FF3333;">❌ Call Failed or Host Offline.</span>`;
            if (joinScreen && meetingRoom) {
                joinScreen.style.display = 'block';
                meetingRoom.style.display = 'none';
            }
        });
    });
    
    peer.on('error', err => {
        console.error("PeerJS Error (Participant):", err);
        if (statusElement) statusElement.innerHTML = `<span style="color:#FF3333;">❌ Participant WEBRTC Error. Check Console.</span>`;
    });
}

// 4. Initialization
async function init() {
    
    // Select the correct video element to attach the webcam stream to
    const videoToSetup = isHost ? hostVideoElement : localVideoElement;
    
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
