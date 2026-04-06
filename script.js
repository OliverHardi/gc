// 1. Import Firebase SDKs from CDN
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, updateDoc, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// 2. Your Web App's Firebase Configuration (Pasted from your prompt)
const firebaseConfig = {
  apiKey: "AIzaSyAZVleqPUw4XD-Z6bWo0hdZk3WZV53KNCY",
  authDomain: "chat-b5188.firebaseapp.com",
  projectId: "chat-b5188",
  storageBucket: "chat-b5188.firebasestorage.app",
  messagingSenderId: "932995779691",
  appId: "1:932995779691:web:87fab0b6e700c3e5c1b52e",
  measurementId: "G-ZFEL28SYEG"
};

// Initialize Firebase & Firestore
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// 3. WebRTC Configuration (Google's public STUN server helps find IP addresses)
const servers = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const pc = new RTCPeerConnection(servers);
let dataChannel = null;

// Grab UI elements
const createBtn = document.getElementById("create-room");
const joinBtn = document.getElementById("join-room");


// 4. Handle Incoming Data Channel Messages
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

// =======================================================
// CALLER FLOW (Computer A creates the room)
// =======================================================
async function createRoom() {
    createBtn.disabled = true;
    joinBtn.disabled = true;

    // Create the data channel first
    setupDataChannel(pc.createDataChannel("chat"));

    // Create a room in Firebase
    const roomRef = await addDoc(collection(db, "rooms"), {});
    roomDisplay.innerHTML = `Room ID: <b>${roomRef.id}</b> (Share this with your friend!)`;
    
    // Save Caller's ICE Candidates to Firebase
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            addDoc(collection(roomRef, "callerCandidates"), event.candidate.toJSON());
        }
    };

    // Create Offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    // Save Offer to Firebase
    await updateDoc(roomRef, { offer: { type: offer.type, sdp: offer.sdp } });

    // Listen for Callee's Answer
    onSnapshot(roomRef, (snapshot) => {
        const data = snapshot.data();
        if (!pc.remoteDescription && data && data.answer) {
            pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        }
    });

    // Listen for Callee's ICE Candidates
    onSnapshot(collection(roomRef, "calleeCandidates"), (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === 'added') {
                pc.addIceCandidate(new RTCIceCandidate(change.doc.data()));
            }
        });
    });
}

// =======================================================
// CALLEE FLOW (Computer B joins the room)
// =======================================================
async function joinRoom(roomId) {
    createBtn.disabled = true;
    joinBtn.disabled = true;

    const roomRef = doc(db, "rooms", roomId);
    const roomSnapshot = await getDoc(roomRef);
    
    if (!roomSnapshot.exists()) {
        alert("Room not found!");
        return;
    }
    
    const data = roomSnapshot.data();
    roomDisplay.innerHTML = `Room ID: <b>${roomId}</b>`;

    // Listen for the incoming Data Channel
    pc.ondatachannel = (event) => {
        setupDataChannel(event.channel);
    };

    // Save Callee's ICE Candidates to Firebase
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            addDoc(collection(roomRef, "calleeCandidates"), event.candidate.toJSON());
        }
    };

    // Set Remote Offer
    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));

    // Create Answer
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    // Save Answer to Firebase
    await updateDoc(roomRef, { answer: { type: answer.type, sdp: answer.sdp } });

    // Listen for Caller's ICE candidates
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

function sendMessage(message){
    if (dataChannel && dataChannel.readyState === "open") {
        dataChannel.send(message);
        logMessage(message, "You");
    } else {
        alert("Connection not established yet!");
    }
}