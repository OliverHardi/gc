import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, doc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

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
const auth = getAuth(app);

let currentUser = null; // will hold { uid, displayName, photoURL }
const peerNames = {};

const ROOM_ID = "main";
const myId = crypto.randomUUID();
let roomId = null;
let iceServers = null;

const peers = {};
const dataChannels = {};

const roomDisplay = document.getElementById("roomDisplay");
const chatbox = document.getElementById("chatbox");
const messageInput = document.getElementById("messageInput");
const sendButton = document.getElementById("sendButton");

async function signIn() {
    const provider = new GoogleAuthProvider();
    try {
        const result = await signInWithPopup(auth, provider);
        return result.user;
    } catch (e) {
        console.error("Sign in failed:", e);
    }
}

async function getIceServers() {
    try {
        const response = await fetch("https://mhs-chat.metered.live/api/v1/turn/credentials?apiKey=60346c336ffff46e32cf32b5d08f206e1875");
        if (!response.ok) throw new Error("Failed");
        return await response.json();
    } catch (e) {
        console.warn("Could not fetch TURN credentials, falling back to STUN:", e);
        return [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" }
        ];
    }
}

function logMessage(text, sender) {
    const msgDiv = document.createElement("div");
    msgDiv.textContent = `${sender}: ${text}`;
    chatbox.appendChild(msgDiv);
    chatbox.scrollTop = chatbox.scrollHeight;
}

function createPeerConnection(peerId) {
    const pc = new RTCPeerConnection({ iceServers });

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            addDoc(collection(db, "rooms", roomId, "candidates", peerId, myId), event.candidate.toJSON());
        }
    };

    pc.oniceconnectionstatechange = () => {
        console.log(`ICE state with ${peerId}:`, pc.iceConnectionState);
        if (pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed") {
            // logMessage("A peer disconnected.", "System");
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
        logMessage("A peer joined.", "System");
        messageInput.disabled = false;
        sendButton.disabled = false;
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

    onSnapshot(doc(db, "rooms", roomId, "answers", myId, "incoming", peerId), (snapshot) => {
        if (snapshot.exists() && !pc.remoteDescription) {
            pc.setRemoteDescription(new RTCSessionDescription(snapshot.data()));
        }
    });

    onSnapshot(collection(db, "rooms", roomId, "candidates", myId, peerId), (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === "added") {
                pc.addIceCandidate(new RTCIceCandidate(change.doc.data()));
            }
        });
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

    onSnapshot(collection(db, "rooms", roomId, "candidates", myId, peerId), (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === "added") {
                pc.addIceCandidate(new RTCIceCandidate(change.doc.data()));
            }
        });
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

    // Watch members — offer to anyone who was already here when we joined
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

    // Watch for offers addressed to me
    onSnapshot(collection(db, "rooms", roomId, "offers", myId, "incoming"), (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type !== "added") return;
            const peerId = change.doc.id;
            if (!peers[peerId]) {
                answerPeer(peerId, change.doc.data());
            }
        });
    });

    logMessage("Waiting for others to join...", "System");
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

// join room after sign in
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        showChat();
        await enterRoom();
    } else {
        showSignIn();
    }
});

function showSignIn() {
    document.getElementById("signInScreen").style.display = "flex";
    document.getElementById("chatScreen").style.display = "none";
}

function showChat() {
    document.getElementById("signInScreen").style.display = "none";
    document.getElementById("chatScreen").style.display = "flex";
}

document.getElementById("signInBtn").addEventListener("click", signIn);