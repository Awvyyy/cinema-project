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

// === LIVE MOVIES via TMDB ===
const TMDB_KEY = "6a46a3f1d4c614f4ec9bd84671e26e2a";

app.get("/api/movies/live", async (req, res) => {
  try {
    // 1. Получаем список актуальных фильмов
    const url = `https://api.themoviedb.org/3/movie/now_playing?api_key=${TMDB_KEY}&language=ru-RU&page=1`;
    const listResp = await fetch(url);
    const listData = await listResp.json();

    const movies = [];

    for (const m of listData.results) {
      // 2. Загружаем детали по каждому фильму
      const durl = `https://api.themoviedb.org/3/movie/${m.id}?api_key=${TMDB_KEY}&language=ru-RU&append_to_response=release_dates`;
      const detailResp = await fetch(durl);
      const detail = await detailResp.json();

      // возрастной рейтинг
      let age = "0+";
      try {
        const rel = detail.release_dates.results.find(x => x.iso_3166_1 === "RU");
        if (rel && rel.release_dates[0]?.certification?.length > 0) {
          age = rel.release_dates[0].certification;
        }
      } catch (e) {}

      movies.push({
        id: "tmdb-" + m.id,
        title: detail.title,
        poster: detail.poster_path
          ? `https://image.tmdb.org/t/p/w500${detail.poster_path}`
          : null,
        rating: detail.vote_average?.toFixed(1) ?? "—",
        durationMin: detail.runtime ?? 100,
        age: age || "12+",
        synopsis: detail.overview || "Описание недоступно.",
        genres: (detail.genres || []).map(g => g.name),
        tags: ["2D"] // можно заменить на реальные, если хочешь
      });
    }

    res.json({
      base_price: 8.9,
      cities: [{ id: "tallinn", name: "Tallinn" }],
      theaters: {
        tallinn: [{ id: "Awvy-sol", name: "Awvy Solaris" }]
      },
      movies,
      showtimes: generateShowtimes(movies.map(m => m.id))
    });

  } catch (err) {
    console.error("TMDB LIVE ERROR:", err);
    res.status(500).json({ error: "TMDB error" });
  }
});

// создаём фейковые даты и времена
function generateShowtimes(movieIds) {
  const today = new Date();
  const result = {};

  for (let i = 0; i < 5; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const iso = d.toISOString().slice(0,10);

    result[iso] = {
      "Awvy-sol": {}
    };

    const times = ["12:00", "14:30", "17:00", "19:30", "22:00"];

    for (const id of movieIds) {
      result[iso]["Awvy-sol"][id] = times;
    }
  }

  return result;
}

app.get("/api/movie", async (req, res) => {
  const id = req.query.id;
  if (!id) return res.status(400).json({ error: "missing id" });

  const TMDB = "6a46a3f1d4c614f4ec9bd84671e26e2a";

  try {
    const movieId = id.replace("tmdb-", "");

    const url = `https://api.themoviedb.org/3/movie/${movieId}?api_key=${TMDB}&language=ru-RU&append_to_response=videos`;
    const r = await fetch(url);
    const m = await r.json();

    const trailer = m.videos?.results?.find(v => v.type === "Trailer")
      ? `https://www.youtube.com/embed/${m.videos.results.find(v=>v.type==="Trailer").key}`
      : "https://www.youtube.com/embed/dQw4w9WgXcQ"; // fallback :)

    const year = (m.release_date || "0000").slice(0,4);

    const fakeTimes = ["13:00", "15:45", "18:00", "20:30", "22:10"];

    res.json({
      id,
      title: m.title,
      synopsis: m.overview,
      rating: m.vote_average?.toFixed(1),
      durationMin: m.runtime,
      age: "12+",
      year,
      backdrop: m.backdrop_path
        ? "https://image.tmdb.org/t/p/original" + m.backdrop_path
        : "/fallback.jpg",
      poster: m.poster_path
        ? "https://image.tmdb.org/t/p/w500" + m.poster_path
        : null,
      trailer,
      showtimes: fakeTimes
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "movie fetch error" });
  }
});


app.listen(PORT, () =>
  console.log(`🎬 Awvyyy Cinema backend запущен на http://localhost:${PORT}`)
);
