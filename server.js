// server.js
import express from "express";
import fs from "fs";
import cors from "cors";
import bodyParser from "body-parser";

const app = express();
const PORT = 3000;
const HOLD_MS = 7 * 60 * 1000;
const SEATS_FILE = "./seats.json";
const DATA_FILE = "./data.json";

app.use(cors());
app.use(bodyParser.json());

// Helper: load & save
function loadSeats() {
  if (!fs.existsSync(SEATS_FILE)) return {};
  try {
    const data = JSON.parse(fs.readFileSync(SEATS_FILE, "utf8"));
    cleanupExpired(data);
    return data;
  } catch {
    return {};
  }
}
function saveSeats(data) {
  fs.writeFileSync(SEATS_FILE, JSON.stringify(data, null, 2));
}
function cleanupExpired(data) {
  const now = Date.now();
  for (const key in data) {
    data[key] = data[key].filter(seat => seat.expiresAt > now);
    if (!data[key].length) delete data[key];
  }
}

// 🔹 GET: data.json (фильмы и расписание)
app.get("/api/movies", (req, res) => {
  const json = fs.readFileSync(DATA_FILE, "utf8");
  res.type("application/json").send(json);
});

// 🔹 GET: список занятых мест для сеанса
app.get("/api/seats", (req, res) => {
  const { showKey } = req.query;
  if (!showKey) return res.status(400).json({ error: "Missing showKey" });
  const data = loadSeats();
  res.json(data[showKey] || []);
});

// 🔹 POST: забронировать места
app.post("/api/reserve", (req, res) => {
  const { showKey, seats } = req.body;
  if (!showKey || !Array.isArray(seats)) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const data = loadSeats();
  const now = Date.now();
  const expiresAt = now + HOLD_MS;
  if (!data[showKey]) data[showKey] = [];

  // Проверяем, не заняты ли уже места
  const occupied = new Set(data[showKey].map(s => s.seatId));
  const conflicts = seats.filter(id => occupied.has(id));
  if (conflicts.length) {
    return res.status(409).json({ error: "Seats already reserved", conflicts });
  }

  // Добавляем новые брони
  for (const id of seats) {
    data[showKey].push({ seatId: id, expiresAt });
  }
  saveSeats(data);

  res.json({ ok: true, expiresAt });
});

// 🔹 POST: освободить места
app.post("/api/release", (req, res) => {
  const { showKey, seats } = req.body;
  if (!showKey || !Array.isArray(seats)) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const data = loadSeats();
  if (!data[showKey]) return res.json({ ok: true });

  const drop = new Set(seats);
  data[showKey] = data[showKey].filter(s => !drop.has(s.seatId));
  if (!data[showKey].length) delete data[showKey];
  saveSeats(data);

  res.json({ ok: true });
});

// 🔹 Очистка старых броней (каждые 60 с)
setInterval(() => {
  const data = loadSeats();
  cleanupExpired(data);
  saveSeats(data);
}, 60000);

// Отдаём index.html и статические файлы из текущей папки
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Раздаём index.html и статику из папки проекта
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// --- AUTH SYSTEM ---
import crypto from "crypto";

const USERS_FILE = "./users.json";
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, "{}");

function loadUsers() {
  return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
}
function saveUsers(data) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
}
function hashPassword(pw) {
  return crypto.createHash("sha256").update(pw).digest("hex");
}
function generateToken() {
  return crypto.randomBytes(24).toString("hex");
}

// --- POST /api/register ---
app.post("/api/register", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Missing email or password" });

  const users = loadUsers();
  if (users[email]) return res.status(409).json({ error: "User already exists" });

  users[email] = {
    passwordHash: hashPassword(password),
    token: null
  };
  saveUsers(users);
  res.json({ ok: true });
});

// --- POST /api/login ---
app.post("/api/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Missing email or password" });

  const users = loadUsers();
  const user = users[email];
  if (!user || user.passwordHash !== hashPassword(password)) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = generateToken();
  user.token = token;
  saveUsers(users);
  res.json({ ok: true, token });
});

// --- GET /api/me ---
app.get("/api/me", (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "No token" });

  const users = loadUsers();
  const email = Object.keys(users).find(e => users[e].token === token);
  if (!email) return res.status(401).json({ error: "Invalid token" });

  res.json({ ok: true, email });
});


app.listen(PORT, () =>
  console.log(`🎬 Awvyyy Cinema backend запущен на http://localhost:${PORT}`)
);
