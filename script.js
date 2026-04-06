import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc, onSnapshot, updateDoc, doc } from "firebase/firestore";

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const servers = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const pc = new RTCPeerConnection(servers);
const dataChannel = pc.createDataChannel("chat");

async function createRoom() {
    // 1. Create a room in Firebase
    const roomRef = await addDoc(collection(db, "rooms"), {});
    
    // 2. Get ICE candidates and save them to Firebase
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            addDoc(collection(roomRef, "callerCandidates"), event.candidate.toJSON());
        }
    };

    // 3. Create Offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    // 4. Save Offer to Firebase
    await updateDoc(roomRef, { offer: { type: offer.type, sdp: offer.sdp } });

    // 5. Listen for the Answer from Computer B
    onSnapshot(roomRef, (snapshot) => {
        const data = snapshot.data();
        if (!pc.remoteDescription && data && data.answer) {
            const rtcAnswer = new RTCSessionDescription(data.answer);
            pc.setRemoteDescription(rtcAnswer);
        }
    });

    console.log("Room created! Share this ID with your friend:", roomRef.id);
}

async function joinRoom(roomId) {
    const roomRef = doc(db, "rooms", roomId);
    const roomSnapshot = await getDoc(roomRef);
    const data = roomSnapshot.data();

    // 1. Set Remote Offer
    const offer = data.offer;
    await pc.setRemoteDescription(new RTCSessionDescription(offer));

    // 2. Create Answer
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    // 3. Save Answer to Firebase
    await updateDoc(roomRef, { answer: { type: answer.type, sdp: answer.sdp } });

    // 4. Listen for ICE candidates from Computer A
    onSnapshot(collection(roomRef, "callerCandidates"), (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === 'added') {
                pc.addIceCandidate(new RTCIceCandidate(change.doc.data()));
            }
        });
    });
}

pc.ondatachannel = (event) => {
    const receiveChannel = event.channel;
    receiveChannel.onmessage = (event) => {
        console.log("New message:", event.data);
    };
};

function sendMessage(message) {
    dataChannel.send(message);
}