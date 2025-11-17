// movie.js
// ЛОГИКА СТРАНИЦЫ ОТДЕЛЬНОГО ФИЛЬМА

const TMDB_API_KEY = "6a46a3f1d4c614f4ec9bd84671e26e2a"; // ← замени!
const TMDB_BASE = "https://api.themoviedb.org/3";
const IMG_ORIG = "https://image.tmdb.org/t/p/original";
const IMG_W500 = "https://image.tmdb.org/t/p/w500";

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

document.addEventListener("DOMContentLoaded", () => {
  initMoviePage().catch(err => {
    console.error(err);
    $("#movieTitle").textContent = "Ошибка загрузки фильма";
    $("#movieDesc").textContent  = "Не удалось получить данные с TMDB. Проверь API-ключ.";
  });
});

async function initMoviePage() {
  const tmdbId = getMovieIdFromUrl();
  if (!tmdbId) {
    $("#movieTitle").textContent = "Фильм не найден";
    $("#movieDesc").textContent  = "В адресной строке нет параметра id=tmdb-XXXX.";
    return;
  }

  const data = await fetchMovieFromTMDB(tmdbId);

  renderHero(data);
  renderDescription(data);
  renderActors(data.credits?.cast || []);
  renderShowtimes();
  renderSimilar(data.similar?.results || []);
  setupTrailer(data);

  // привязка закрытия модалки трейлера
  const trailerModal = $("#trailerModal");
  trailerModal.addEventListener("click", e => {
    if (e.target === trailerModal) {
      closeTrailer();
    }
  });
}

/* ===== URL / ID ===== */

function getMovieIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  let id = params.get("id");
  if (!id) return null;
  // ожидали формат tmdb-123456
  if (id.startsWith("tmdb-")) id = id.slice(5);
  if (!/^\d+$/.test(id)) return null;
  return id;
}

/* ===== TMDB FETCH ===== */

async function fetchMovieFromTMDB(id) {
  const url =
    `${TMDB_BASE}/movie/${id}` +
    `?api_key=${encodeURIComponent(TMDB_API_KEY)}` +
    `&language=ru-RU&append_to_response=credits,videos,similar`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("TMDB error: " + res.status);
  }
  return res.json();
}

/* ===== RENDER HERO ===== */

function renderHero(data) {
  const posterEl = $("#moviePoster");
  const titleEl  = $("#movieTitle");
  const yearEl   = $("#movieYear");
  const durEl    = $("#movieDur");
  const ratingEl = $("#movieRating");
  const ageEl    = $("#movieAge");

  const title = data.title || data.name || "Без названия";
  const year  = data.release_date ? data.release_date.slice(0, 4) : "—";
  const dur   = data.runtime ? `${data.runtime} мин` : "длина неизвестна";
  const rating = data.vote_average ? `${data.vote_average.toFixed(1)} ★` : "нет оценок";
  const age = data.adult ? "18+" : "12+";

  const backdrop = data.backdrop_path || data.poster_path;
  if (backdrop) {
    posterEl.src = IMG_ORIG + backdrop;
  } else {
    posterEl.src =
      "https://dummyimage.com/1600x900/020617/64748b&text=Awvyyy+Cinema";
  }

  titleEl.textContent  = title;
  yearEl.textContent   = year;
  durEl.textContent    = dur;
  ratingEl.textContent = rating;
  ageEl.textContent    = age;
}

/* ===== DESCRIPTION ===== */

function renderDescription(data) {
  const descEl = $("#movieDesc");
  if (data.overview && data.overview.trim()) {
    descEl.textContent = data.overview;
  } else {
    descEl.textContent =
      "Описание к этому фильму пока отсутствует на русском языке. " +
      "Но ты всё равно можешь выбрать сеанс и забронировать лучшие места 😉";
  }
}

/* ===== ACTORS ===== */

function renderActors(cast) {
  const wrap = $("#actorList");
  if (!cast.length) {
    wrap.innerHTML = `<div class="description">Нет информации об актёрах.</div>`;
    return;
  }

  const top = cast.slice(0, 8);
  wrap.innerHTML = top
    .map(actor => {
      const img = actor.profile_path
        ? IMG_W500 + actor.profile_path
        : "https://dummyimage.com/200x200/020617/64748b&text=No+Photo";
      const name = actor.name || "Без имени";
      const role = actor.character || "";
      return `
        <div class="actor">
          <img src="${img}" alt="${escapeHtml(name)}">
          <div>${escapeHtml(name)}</div>
          <div style="font-size:13px;color:var(--muted)">${escapeHtml(role)}</div>
        </div>`;
    })
    .join("");
}

/* ===== SHOWTIMES (фейковые даты) ===== */

function renderShowtimes() {
  const wrap = $("#showtimeList");
  const base = new Date();
  const times = ["13:00", "16:30", "20:15"];

  let html = "";
  for (let i = 0; i < 3; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() + 7 + i); // через неделю, +1, +2 — не настоящие

    const dateLabel = d.toLocaleDateString("ru-RU", {
      weekday: "short",
      day: "2-digit",
      month: "short",
    });

    const btns = times
      .map(
        t => `<button class="showtime-btn" data-time="${t}" data-date="${d.toISOString().slice(0,10)}">
                ${t}
              </button>`
      )
      .join("");

    html += `
      <div class="showday">
        <div class="showday-date">${dateLabel}</div>
        <div class="showday-times">${btns}</div>
      </div>`;
  }

  wrap.innerHTML = html;

  $$(".showtime-btn", wrap).forEach(btn => {
    btn.addEventListener("click", () => {
      // здесь можно сделать редирект на главную и авто-открывать выбор мест
      alert(
        "В демо бронирование мест делается на главной странице Awvyyy Cinema. " +
        "Мы просто показываем пример расписания сеансов 🙂"
      );
    });
  });
}

/* ===== SIMILAR MOVIES ===== */

function renderSimilar(list) {
  const wrap = $("#similarList");
  if (!list.length) {
    wrap.innerHTML =
      `<div class="description">Похожие фильмы не найдены.</div>`;
    return;
  }

  const top = list.slice(0, 8);
  wrap.innerHTML = top
    .map(m => {
      const img = m.poster_path
        ? IMG_W500 + m.poster_path
        : "https://dummyimage.com/200x300/020617/64748b&text=No+Poster";
      const title = m.title || m.name || "Без названия";
      const rating = m.vote_average
        ? m.vote_average.toFixed(1) + " ★"
        : "—";
      return `
        <div class="actor similar-card" data-id="${m.id}">
          <img src="${img}" alt="${escapeHtml(title)}">
          <div class="name">${escapeHtml(title)}</div>
          <div style="font-size:13px;color:var(--muted)">${rating}</div>
        </div>`;
    })
    .join("");

  $$(".similar-card", wrap).forEach(card => {
    card.addEventListener("click", () => {
      const id = card.dataset.id;
      if (!id) return;
      // открываем эту же страницу, но для другого фильма
      window.location.href = `movie.html?id=tmdb-${id}`;
    });
  });
}

/* ===== TRAILER ===== */

function setupTrailer(data) {
  const btn = $("#playTrailer");
  const modal = $("#trailerModal");
  const frame = $("#trailerFrame");

  const videos = data.videos?.results || [];
  const trailer = videos.find(
    v => v.site === "YouTube" && v.type === "Trailer"
  ) || videos.find(v => v.site === "YouTube");

  if (!trailer) {
    btn.textContent = "Трейлер недоступен";
    btn.disabled = true;
    btn.style.opacity = 0.6;
    return;
  }

  const videoId = trailer.key;
  const url = `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`;

  btn.addEventListener("click", () => {
    frame.src = url;
    modal.classList.add("open");
  });
}

function closeTrailer() {
  const modal = $("#trailerModal");
  const frame = $("#trailerFrame");
  frame.src = "";
  modal.classList.remove("open");
}

/* ===== UTILS ===== */

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
