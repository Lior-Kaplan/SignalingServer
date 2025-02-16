// server.js
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());

const PORT = 8080;

let rooms = {}; // Store rooms and their participants web sockets

const createRoomId = () => {
  let code = Math.random().toString(36).substring(2, 27);
  while (code.length < 25) {
    code += Math.random().toString(36).substring(2);
  }
  return code.substring(0, 25);
};

wss.on("connection", (ws) => {
  ws.on("message", (message) => {
    const data = JSON.parse(message);
    
    if (data.type === "create-room") {
      const roomId = createRoomId();
      rooms[roomId] = [ws];
      ws.roomId = roomId;
      console.log("Room created!!")
      ws.send(JSON.stringify({ type: "room-created", roomId }));
    }

    if (data.type === "join-room") {
      
      const { roomId, username } = data;
      console.log(roomId, username);
      if (rooms[roomId]) {
        rooms[roomId].push(ws);
        ws.roomId = roomId;

        // Notify all users in the room about the new joiner
        rooms[roomId].forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: "user-joined", username }));
          }
        });

        // When two users are present, trigger WebRTC negotiation on the first user.
        if (rooms[roomId].length >=2) {
          rooms[roomId][0].send(JSON.stringify({ type: "start-webrtc" }));
        }
      } else {
        ws.send(JSON.stringify({ type: "error", message: "Room not found" }));
      }
    }

    // Relay WebRTC signaling messages (offer, answer, ICE candidates)
    if (data.type === "webrtc-offer" || data.type === "webrtc-answer" || data.type === "webrtc-ice") {
      const roomUsers = rooms[data.roomId];
      if (roomUsers) {
        roomUsers.forEach(client => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
          }
        });
      }
    }
  });

  ws.on("close", () => {
    if (ws.roomId && rooms[ws.roomId]) {
      rooms[ws.roomId] = rooms[ws.roomId].filter((client) => client !== ws);
      if (rooms[ws.roomId].length === 0) {
        delete rooms[ws.roomId];
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`WebSocket server running on ws://localhost:${PORT}`);
});
