import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, doc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

const myId = crypto.randomUUID();
let roomId = null;
let iceServers = null;

const peers = {};
const dataChannels = {};

const createBtn = document.getElementById("createRoom");
const joinBtn = document.getElementById("joinRoom");
const roomDisplay = document.getElementById("roomDisplay");
const chatbox = document.getElementById("chatbox");
const messageInput = document.getElementById("messageInput");
const sendButton = document.getElementById("sendButton");

async function getIceServers() {
    const response = await fetch("https://mhs-chat.metered.live/api/v1/turn/credentials?apiKey=60346c336ffff46e32cf32b5d08f206e1875");
    return await response.json();
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
            logMessage(`A peer disconnected.`, "System");
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
        logMessage(`Peer joined.`, "System");
        messageInput.disabled = false;
        sendButton.disabled = false;
    };

    channel.onclose = () => {
        delete dataChannels[peerId];
    };

    channel.onmessage = (event) => {
        logMessage(event.data, peerId.slice(0, 6));
    };
}

async function connectToPeer(peerId) {
    const pc = createPeerConnection(peerId);
    const channel = pc.createDataChannel("chat");
    setupDataChannel(channel, peerId);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // Write offer TO peerId FROM myId
    await setDoc(doc(db, "rooms", roomId, "offers", peerId, "incoming", myId), {
        type: offer.type,
        sdp: offer.sdp
    });

    // Watch for answer FROM peerId TO myId
    onSnapshot(doc(db, "rooms", roomId, "answers", myId, "incoming", peerId), (snapshot) => {
        if (snapshot.exists() && !pc.remoteDescription) {
            pc.setRemoteDescription(new RTCSessionDescription(snapshot.data()));
        }
    });

    // Watch for ICE candidates FROM peerId TO myId
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

    // Write answer TO peerId FROM myId
    await setDoc(doc(db, "rooms", roomId, "answers", peerId, "incoming", myId), {
        type: answer.type,
        sdp: answer.sdp
    });

    // Watch for ICE candidates FROM peerId TO myId
    onSnapshot(collection(db, "rooms", roomId, "candidates", myId, peerId), (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === "added") {
                pc.addIceCandidate(new RTCIceCandidate(change.doc.data()));
            }
        });
    });
}

async function enterRoom(name) {
    roomId = name;
    iceServers = await getIceServers();

    roomDisplay.innerHTML = `Room: <b>${roomId}</b> — You are <b>${myId.slice(0, 6)}</b>`;

    // Register yourself
    await setDoc(doc(db, "rooms", roomId, "members", myId), { joined: Date.now() });

    window.addEventListener("beforeunload", () => {
        deleteDoc(doc(db, "rooms", roomId, "members", myId));
    });

    // Watch members — when a new peer appears, the higher ID initiates
    onSnapshot(collection(db, "rooms", roomId, "members"), (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type !== "added") return;
            const peerId = change.doc.id;
            if (peerId === myId) return;
            if (!peers[peerId] && myId > peerId) {
                connectToPeer(peerId);
            }
        });
    });

    // Watch for offers addressed TO me
    onSnapshot(collection(db, "rooms", roomId, "offers", myId, "incoming"), (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type !== "added") return;
            const peerId = change.doc.id;
            if (!peers[peerId]) {
                answerPeer(peerId, change.doc.data());
            }
        });
    });
}

function broadcast(msg) {
    Object.values(dataChannels).forEach((channel) => {
        if (channel.readyState === "open") channel.send(msg);
    });
}

createBtn.addEventListener("click", async () => {
    createBtn.disabled = true;
    joinBtn.disabled = true;
    const name = prompt("Enter a room name:");
    if (name) await enterRoom(name);
});

joinBtn.addEventListener("click", async () => {
    createBtn.disabled = true;
    joinBtn.disabled = true;
    const name = prompt("Enter room name to join:");
    if (name) await enterRoom(name);
});

sendButton.addEventListener("click", () => {
    const msg = messageInput.value.trim();
    if (!msg) return;
    broadcast(msg);
    logMessage(msg, "Me");
    messageInput.value = "";
});

messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendButton.click();
});