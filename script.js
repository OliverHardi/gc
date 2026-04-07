import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, doc, setDoc, deleteDoc, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

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
    // try {
    //     const response = await fetch("https://mhs-chat.metered.live/api/v1/turn/credentials?apiKey=60346c336ffff46e32cf32b5d08f206e1875");
    //     if (!response.ok) throw new Error("Failed");
    //     return await response.json();
    // } catch (e) {
    //     console.warn("Could not fetch TURN credentials, falling back to STUN:", e);
    //     return [
    //         { urls: "stun:stun.l.google.com:19302" },
    //         { urls: "stun:stun1.l.google.com:19302" }
    //     ];
    // }
    return [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
    ];
}

function logMessage(text, sender) {
    const msgDiv = document.createElement("div");
    // msgDiv.textContent = `${sender}: ${text}`;
    msgDiv.classList.add("message");

    if (sender === "System") {
        // System logs (Centered, no bubble)
        msgDiv.classList.add("system");
        msgDiv.textContent = text;
        
    } else if (sender === currentUser.displayName) {
        // Your messages (Right side, blue bubble)
        msgDiv.classList.add("me");
        // We usually don't put our own name in our own bubbles
        msgDiv.textContent = text; 
        
    } else {
        // Other people's messages (Left side, gray bubble)
        msgDiv.classList.add("other");
        // Keep their name visible so you know who is talking
        msgDiv.textContent = `${sender}: ${text}`; 
    }

    chatbox.appendChild(msgDiv);
    chatbox.scrollTop = chatbox.scrollHeight;
}

function createPeerConnection(peerId) {
    const pc = new RTCPeerConnection({ iceServers });
    const localCandidates = []; // Array to hold candidates locally

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            // Push to local array instead of writing to Firestore
            localCandidates.push(event.candidate.toJSON());
        } else if (localCandidates.length > 0) {
            // event.candidate is null, meaning gathering is done.
            // Write the whole array in ONE single database operation.
            setDoc(doc(db, "rooms", roomId, "candidates", peerId, "incoming", myId), {
                candidates: localCandidates
            });
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
        // logMessage("A peer joined.", "System");
        logMessage(`${peerNames[peerId] || peerId.slice(0, 6)} joined the chat.`, "System");
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
            unsubAnswer();      // Stop listening to DB
            unsubCandidates();  // Stop listening to DB
            try {
                // Delete the documents WE created for them
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

    // 2. ADD THE CLEANUP LISTENER
    pc.addEventListener('connectionstatechange', async () => {
        if (pc.connectionState === 'connected') {
            unsubCandidates(); // Stop listening to DB
            try {
                // Delete the documents WE created for them
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

    try {
        const stuckOffers = await getDocs(collection(db, "rooms", roomId, "offers", myId, "incoming"));
        stuckOffers.forEach(snap => deleteDoc(snap.ref));

        const stuckAnswers = await getDocs(collection(db, "rooms", roomId, "answers", myId, "incoming"));
        stuckAnswers.forEach(snap => deleteDoc(snap.ref));

        const stuckCandidates = await getDocs(collection(db, "rooms", roomId, "candidates", myId, "incoming"));
        stuckCandidates.forEach(snap => deleteDoc(snap.ref));
        
        console.log("Swept up old ghost connections!");
    } catch (e) {
        console.warn("Cleanup sweep failed, moving on:", e);
    }

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
    document.getElementById("signOutBtn").style.display = "block";
}

document.getElementById("signInBtn").addEventListener("click", signIn);


document.getElementById("signOutBtn").addEventListener("click", async () => {
    // 1. Delete yourself from the database so others see you leave
    if (roomId && myId) {
        try {
            await deleteDoc(doc(db, "rooms", roomId, "members", myId));
        } catch (e) {
            console.error("Failed to remove member doc:", e);
        }
    }

    // 2. Tell Firebase to sign the user out
    await signOut(auth);
    // reload window
    window.location.reload();
});