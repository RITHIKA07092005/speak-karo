import express from 'express';
import multer from 'multer';
import fs from 'fs';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { exec } from 'child_process';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';

dotenv.config();
const app = express();
const upload = multer({ dest: 'uploads/' });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const httpServer = http.createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: { origin: "*" }
});

app.use(express.static('.'));

// Upload route
app.post('/upload', upload.single('audio'), async (req, res) => {
  const audioPath = req.file.path;
  console.log('Audio received at:', audioPath);

  try {
    const transcript = await transcribeAudio(audioPath);
    console.log('Transcript:', transcript);
    const feedback = await analyzeTranscript(transcript);
    res.json({ transcript, feedback });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.toString() });
  }
});

async function transcribeAudio(audioPath) {
  return new Promise((resolve, reject) => {
    exec(`whisper ${audioPath} --language en --output_format txt`, (error, stdout, stderr) => {
      if (error) return reject(error);
      const transcriptFile = `${audioPath}.txt`;
      const transcript = fs.readFileSync(transcriptFile, 'utf8');
      resolve(transcript);
    });
  });
}

async function analyzeTranscript(transcript) {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: "You are an English communication trainer. Give feedback on grammar, clarity, and confidence based on the transcript." },
      { role: "user", content: transcript }
    ],
  });
  return completion.choices[0].message.content;
}

const gdTopics = [
  "Is AI a boon or a bane?",
  "Should social media be regulated?",
  "Is remote work the future of employment?",
  "Is online learning better than classroom learning?"
];

let lastTopic = null;
function getRandomTopic() {
  if (gdTopics.length === 1) return gdTopics[0];
  let newTopic;
  do {
    newTopic = gdTopics[Math.floor(Math.random() * gdTopics.length)];
  } while (newTopic === lastTopic);
  lastTopic = newTopic;
  return newTopic;
}

app.get('/topic', (req, res) => {
  const topic = getRandomTopic();
  res.json({ topic });
});

app.get('/start-gd', (req, res) => {
  const topic = getRandomTopic();
  console.log("GD started via REST. Topic:", topic);
  res.json({ topic });
});

// WebSocket: GD Topic broadcast + WebRTC room management
io.on('connection', (socket) => {
  console.log("Participant connected:", socket.id);

  // GD Start
  socket.on('startGD', () => {
    const topic = getRandomTopic();
    console.log("Moderator started GD via WebSocket. Topic:", topic);
    io.emit('gdTopic', topic);
  });

  // Join Room (WebRTC)
  socket.on("join-room", (roomId) => {
    socket.join(roomId);
    socket.to(roomId).emit("user-joined", socket.id);

    socket.on("offer", (data) => {
      io.to(data.to).emit("offer", { from: socket.id, offer: data.offer });
    });

    socket.on("answer", (data) => {
      io.to(data.to).emit("answer", { from: socket.id, answer: data.answer });
    });

    socket.on("ice-candidate", (data) => {
      io.to(data.to).emit("ice-candidate", { from: socket.id, candidate: data.candidate });
    });

    socket.on("disconnect", () => {
      socket.to(roomId).emit("user-left", socket.id);
      console.log("Participant disconnected:", socket.id);
    });
  });
});

httpServer.listen(3000, () => console.log('Server & WebSocket running at http://localhost:3000'));