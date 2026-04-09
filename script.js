import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, onSnapshot, doc, setDoc, deleteDoc, arrayUnion } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyAZVleqPUw4XD-Z6bWo0hdZk3WZV53KNCY",
    authDomain: "chat-b5188.firebaseapp.com",
    projectId: "chat-b5188",
    storageBucket: "chat-b5188.firebasestorage.app",
    messagingSenderId: "932995779691",
    appId: "1:932995779691:web:87fab0b6e700c3e5c1b52e",
    measurementId: "G-ZFEL28SYEG"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const currentUser = {
    uid: crypto.randomUUID(),
    displayName: "Anonymous",
    photoURL: "https://www.gravatar.com/avatar/"
};

const peerNames = {};

const ROOM_ID = "camping";
const myId = crypto.randomUUID();
// let myId = sessionStorage.getItem("webrtc_myId");
// if (!myId) {
//     myId = crypto.randomUUID();
//     sessionStorage.setItem("webrtc_myId", myId);
// }
let roomId = null;
let iceServers = null;

const peers = {};
const dataChannels = {};

const roomDisplay = document.getElementById("roomDisplay");
const chatbox = document.getElementById("chatbox");
const messageInput = document.getElementById("messageInput");
const sendButton = document.getElementById("sendButton");

async function getIceServers() {
    const iceServers = [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
    ];

    try {
        const response = await fetch("https://mhs-chat.metered.live/api/v1/turn/credentials?apiKey=60346c336ffff46e32cf32b5d08f206e1875");
        if (response.ok) {
            const turnServers = await response.json();
            iceServers.push(...turnServers);
        } else {
            console.warn("Failed to fetch TURN credentials, using only STUN servers.");
        }
    } catch (e) {
        console.warn("Could not fetch TURN credentials, using only STUN servers:", e);
    }

    return iceServers;
}

function logMessage(text, sender) {
    const msgDiv = document.createElement("div");
    msgDiv.classList.add("message");

    if (sender === "System") {
        msgDiv.classList.add("system");
        msgDiv.textContent = text;
    } else if (sender === currentUser.displayName) {
        msgDiv.classList.add("me");
        msgDiv.textContent = text; 
    } else {
        msgDiv.classList.add("other");
        msgDiv.textContent = `${sender}: ${text}`; 
    }

    chatbox.appendChild(msgDiv);
    chatbox.scrollTop = chatbox.scrollHeight;
}

function createPeerConnection(peerId) {
    const pc = new RTCPeerConnection({ iceServers });
    
    // Variables for batching ICE candidates
    let candidateBatch = []; 
    let batchTimeout = null;

    const name = peerNames[peerId] || peerId.slice(0, 6);
    
    pc.onconnectionstatechange = () => {
        // logMessage(`Connection with ${name}: ${pc.connectionState}`, "System");
    };

    pc.onicegatheringstatechange = () => {
        console.log(`ICE Gathering (${name}): ${pc.iceGatheringState}`);
        if (pc.iceGatheringState === "gathering") {
            // logMessage(`Searching for connection paths to ${name}...`, "System");
        }
    };

    pc.onicecandidate = (event) => {

        if (pc.connectionState === 'connected') return;

        if (event.candidate) {
            candidateBatch.push(event.candidate.toJSON());

            if (!batchTimeout) {
                batchTimeout = setTimeout(() => {
                    if (pc.connectionState !== 'connected') {
                        setDoc(
                            doc(db, "rooms", roomId, "candidates", peerId, "incoming", myId), 
                            { candidates: arrayUnion(...candidateBatch) }, 
                            { merge: true }
                        );
                    }
                    candidateBatch = [];
                    batchTimeout = null;
                }, 2000); // Send batches every 2000ms
            }
        } else {
            // Gathering is complete. If there are any candidates left in the batch, send them now.
            if (candidateBatch.length > 0) {
                clearTimeout(batchTimeout);
                if (pc.connectionState !== 'connected') {
                    setDoc(
                        doc(db, "rooms", roomId, "candidates", peerId, "incoming", myId), 
                        { candidates: arrayUnion(...candidateBatch) }, 
                        { merge: true }
                    );
                }
                candidateBatch = [];
                batchTimeout = null;
            }
            console.log(`Finished gathering all ICE candidates for ${name}.`);
        }
    };

    pc.oniceconnectionstatechange = () => {
        console.log(`ICE state with ${peerId}:`, pc.iceConnectionState);
        if (pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed") {
            logMessage(`${peerNames[peerId] || peerId.slice(0, 6)} left the chat.`, "System");
            delete peers[peerId];
            delete dataChannels[peerId];
        }
    };

    pc.ondatachannel = (event) => {
        setupDataChannel(event.channel, peerId);
    };

    peers[peerId] = pc;
    return pc;
}

function setupDataChannel(channel, peerId) {
    dataChannels[peerId] = channel;

    channel.onopen = () => {
        logMessage(`${peerNames[peerId] || peerId.slice(0, 6)} joined the chat.`, "System");
    };

    channel.onclose = () => {
        delete dataChannels[peerId];
    };

    channel.onmessage = (event) => {
        logMessage(event.data, peerNames[peerId] || peerId.slice(0, 6));
    };
}

async function connectToPeer(peerId) {
    const pc = createPeerConnection(peerId);
    const channel = pc.createDataChannel("chat");
    setupDataChannel(channel, peerId);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    await setDoc(doc(db, "rooms", roomId, "offers", peerId, "incoming", myId), {
        type: offer.type,
        sdp: offer.sdp
    });

    // 👻 THE GHOST HUNTER 👻
    const ghostTimeout = setTimeout(async () => {
        if (pc.connectionState !== 'connected') {
            const ghostName = peerNames[peerId] || peerId.slice(0, 6);
            // logMessage(`Connection to ${ghostName} timed out. Removing ghost...`, "System");
            
            try {
                // Delete their member doc
                await deleteDoc(doc(db, "rooms", roomId, "members", peerId));
                // Delete the offer WE created for them
                await deleteDoc(doc(db, "rooms", roomId, "offers", peerId, "incoming", myId));
                // NEW: Delete the candidates WE created for them
                await deleteDoc(doc(db, "rooms", roomId, "candidates", peerId, "incoming", myId));
            } catch (e) {
                console.warn("Could not sweep ghost from DB:", e);
            }

            unsubAnswer();
            unsubCandidates();
            
            pc.close();
            delete peers[peerId];
            delete dataChannels[peerId];
        }
    }, 10000); 

    const unsubAnswer = onSnapshot(doc(db, "rooms", roomId, "answers", myId, "incoming", peerId), (snapshot) => {
        if (snapshot.exists() && !pc.remoteDescription) {
            pc.setRemoteDescription(new RTCSessionDescription(snapshot.data()));
        }
    });

    const unsubCandidates = onSnapshot(doc(db, "rooms", roomId, "candidates", myId, "incoming", peerId), (snapshot) => {
        if (snapshot.exists()) {
            const data = snapshot.data();
            if (data.candidates && Array.isArray(data.candidates)) {
                data.candidates.forEach((candidate) => {
                    pc.addIceCandidate(new RTCIceCandidate(candidate));
                });
            }
        }
    });

    pc.addEventListener('connectionstatechange', async () => {
        if (pc.connectionState === 'connected') {
            clearTimeout(ghostTimeout); 
            unsubAnswer();      
            unsubCandidates();  
            try {
                await deleteDoc(doc(db, "rooms", roomId, "offers", peerId, "incoming", myId));
                await deleteDoc(doc(db, "rooms", roomId, "candidates", peerId, "incoming", myId));
                console.log("Cleaned up my offer and candidates!");
            } catch (e) {
                console.error("Cleanup failed:", e);
            }
        }
    });
}

async function answerPeer(peerId, offerData) {
    const pc = createPeerConnection(peerId);

    await pc.setRemoteDescription(new RTCSessionDescription(offerData));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    await setDoc(doc(db, "rooms", roomId, "answers", peerId, "incoming", myId), {
        type: answer.type,
        sdp: answer.sdp
    });

    // 👻 CALLEE GHOST HUNTER 👻
    // If the person who sent us the offer vanishes before connecting, clean up our answers!
    const answerGhostTimeout = setTimeout(async () => {
        if (pc.connectionState !== 'connected') {
            try {
                // Delete the answer and candidates WE created for them
                await deleteDoc(doc(db, "rooms", roomId, "answers", peerId, "incoming", myId));
                await deleteDoc(doc(db, "rooms", roomId, "candidates", peerId, "incoming", myId));
            } catch (e) {
                console.warn("Could not sweep dead answer from DB:", e);
            }

            unsubCandidates();
            pc.close();
            delete peers[peerId];
            delete dataChannels[peerId];
        }
    }, 10000);

    const unsubCandidates = onSnapshot(doc(db, "rooms", roomId, "candidates", myId, "incoming", peerId), (snapshot) => {
        if (snapshot.exists()) {
            const data = snapshot.data();
            if (data.candidates && Array.isArray(data.candidates)) {
                data.candidates.forEach((candidate) => {
                    pc.addIceCandidate(new RTCIceCandidate(candidate));
                });
            }
        }
    });

    pc.addEventListener('connectionstatechange', async () => {
        if (pc.connectionState === 'connected') {
            clearTimeout(answerGhostTimeout);
            unsubCandidates(); 
            try {
                await deleteDoc(doc(db, "rooms", roomId, "answers", peerId, "incoming", myId));
                await deleteDoc(doc(db, "rooms", roomId, "candidates", peerId, "incoming", myId));
                console.log("Cleaned up my answer and candidates!");
            } catch (e) {
                console.error("Cleanup failed:", e);
            }
        }
    });
}

async function enterRoom() {
    roomId = ROOM_ID;
    iceServers = await getIceServers();

    const myJoinTime = Date.now();
    roomDisplay.innerHTML = `Signed in as <b>${currentUser.displayName}</b>`;

    await setDoc(doc(db, "rooms", roomId, "members", myId), {
        joined: myJoinTime,
        name: currentUser.displayName,
        photoURL: currentUser.photoURL
    });

    window.addEventListener("beforeunload", () => {
        deleteDoc(doc(db, "rooms", roomId, "members", myId));
    });

    onSnapshot(collection(db, "rooms", roomId, "members"), (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type !== "added") return;
            const peerId = change.doc.id;
            if (peerId === myId) return;
            if (peers[peerId]) return;

            const data = change.doc.data();
            peerNames[peerId] = data.name;

            const peerJoinTime = change.doc.data().joined;
            if (peerJoinTime < myJoinTime) {
                connectToPeer(peerId);
            }
        });
    });

    onSnapshot(collection(db, "rooms", roomId, "offers", myId, "incoming"), (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type !== "added") return;
            const peerId = change.doc.id;
            if (!peers[peerId]) {
                answerPeer(peerId, change.doc.data());
            }
        });
    });

    logMessage("Waiting for other users...", "System");
}

function broadcast(msg) {
    Object.values(dataChannels).forEach((channel) => {
        if (channel.readyState === "open") channel.send(msg);
    });
}

sendButton.addEventListener("click", () => {
    const msg = messageInput.value.trim();
    if (!msg) return;
    broadcast(msg);
    logMessage(msg, currentUser.displayName);
    messageInput.value = "";
});

messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendButton.click();
});

function showChat() {
    const signInScreen = document.getElementById("signInScreen");
    if (signInScreen) signInScreen.style.display = "none";
    
    document.getElementById("chatScreen").style.display = "flex";
}


const signInScreen = document.getElementById("signInScreen");
const chatScreen = document.getElementById("chatScreen");
const usernameInput = document.getElementById("usernameInput");
const signInBtn = document.getElementById("signInBtn");

let isConnecting = false;
async function handleLogin() {
    if (isConnecting) return;
    isConnecting = true;
    // 1. Get the typed name, fallback to Anonymous if blank
    let typedName = usernameInput.value.trim();
    if (typedName !== "") {
        currentUser.displayName = typedName;
    }

    // 2. Hide the sign-in screen, show the chat screen
    signInScreen.style.display = "none";
    chatScreen.style.display = "flex";
    document.getElementById("signOutBtn").style.display = "block";

    // 3. NOW connect to the database and enter the room
    await enterRoom();
}

// Trigger login when the button is clicked
signInBtn.addEventListener("click", handleLogin);

// Trigger login when the "Enter" key is pressed inside the input
usernameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        handleLogin();
    }
});

// --- BACKGROUND IMAGE CYCLER ---

const totalImages = 11; 
let currentImageIndex = 0;

function cycleBackground() {
    // Move to the next index, and loop back to 0 if we hit the limit
    currentImageIndex = (currentImageIndex + 1) % totalImages;
    
    // Construct the new file path
    // IMPORTANT: Make sure the extension (.jpeg, .jpg, .png) matches your actual files
    const newImageUrl = `url('images/n${currentImageIndex}.jpeg')`; 

    // Apply the new background to both screens
    document.getElementById("signInScreen").style.backgroundImage = newImageUrl;
    document.getElementById("chatScreen").style.backgroundImage = newImageUrl;
}

// Change the background every 5 seconds (5000 milliseconds)
setInterval(cycleBackground, 8000);