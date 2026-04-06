import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, updateDoc, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

let pc = null;
let dataChannel = null;

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

function createPeerConnection(iceServers) {
    pc = new RTCPeerConnection({ iceServers });

    pc.oniceconnectionstatechange = () => {
        console.log("ICE Connection State:", pc.iceConnectionState);
        if (pc.iceConnectionState === "failed") {
            console.error("Connection failed.");
        }
    };
}

function logMessage(text, sender) {
    const msgDiv = document.createElement("div");
    msgDiv.textContent = `${sender}: ${text}`;
    chatbox.appendChild(msgDiv);
    chatbox.scrollTop = chatbox.scrollHeight;
}

function setupDataChannel(channel) {
    dataChannel = channel;

    dataChannel.onopen = () => {
        logMessage("Connected! You can now chat.", "System");
        messageInput.disabled = false;
        sendButton.disabled = false;
    };

    dataChannel.onmessage = (event) => {
        logMessage(event.data, "Peer");
    };
}

async function createRoom() {
    createBtn.disabled = true;
    joinBtn.disabled = true;

    const iceServers = await getIceServers();
    createPeerConnection(iceServers);

    setupDataChannel(pc.createDataChannel("chat"));

    const customName = prompt("Enter a room name (e.g., MyChat):");
    if (!customName) return;
    const roomRef = doc(db, "rooms", customName);

    roomDisplay.innerHTML = `Room ID: <b>${roomRef.id}</b> (Setting up...)`;

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            addDoc(collection(roomRef, "callerCandidates"), event.candidate.toJSON());
        }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // Write offer immediately, let candidates trickle via onicecandidate
    await setDoc(roomRef, {
        offer: { type: offer.type, sdp: offer.sdp }
    });

    roomDisplay.innerHTML = `Room ID: <b>${roomRef.id}</b> - Ready! Share with your friend.`;

    onSnapshot(roomRef, (snapshot) => {
        const data = snapshot.data();
        if (!pc.remoteDescription && data && data.answer) {
            pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        }
    });

    onSnapshot(collection(roomRef, "calleeCandidates"), (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === 'added') {
                pc.addIceCandidate(new RTCIceCandidate(change.doc.data()));
            }
        });
    });
}

async function joinRoom(roomId) {
    createBtn.disabled = true;
    joinBtn.disabled = true;

    const iceServers = await getIceServers();
    createPeerConnection(iceServers);

    const roomRef = doc(db, "rooms", roomId);
    const roomSnapshot = await getDoc(roomRef);

    if (!roomSnapshot.exists()) {
        alert("Room not found!");
        return;
    }

    const data = roomSnapshot.data();
    roomDisplay.innerHTML = `Room ID: <b>${roomId}</b>`;

    pc.ondatachannel = (event) => {
        setupDataChannel(event.channel);
    };

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            addDoc(collection(roomRef, "calleeCandidates"), event.candidate.toJSON());
        }
    };

    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    // Write answer immediately, let candidates trickle
    await updateDoc(roomRef, {
        answer: { type: answer.type, sdp: answer.sdp }
    });

    onSnapshot(collection(roomRef, "callerCandidates"), (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === 'added') {
                pc.addIceCandidate(new RTCIceCandidate(change.doc.data()));
            }
        });
    });
}

createBtn.addEventListener("click", createRoom);

joinBtn.addEventListener("click", () => {
    const roomId = prompt("Enter Room ID:");
    if (roomId) joinRoom(roomId);
});

sendButton.addEventListener("click", () => {
    const msg = messageInput.value;
    if (msg && dataChannel) {
        dataChannel.send(msg);
        logMessage(msg, "Me");
        messageInput.value = "";
    }
});