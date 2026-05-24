(function () {
  "use strict";

  const STORAGE_KEY = "ab_auth_v2";

  function loadSession() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const j = JSON.parse(raw);
      if (j && j.token) return j;
      return null;
    } catch {
      return null;
    }
  }

  function authHeaders() {
    const x = loadSession();
    if (!x || !x.token) return {};
    return { Authorization: "Bearer " + x.token };
  }

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtVol(n) {
    return Math.max(0, Math.min(100, Math.floor(Number(n) || 0)));
  }

  let state = {
    music_enabled: false,
    music_default_volume: 35,
    tracks: [],
  };

  function setStatus(msg, isErr) {
    const el = document.getElementById("admin-music-status");
    if (!el) return;
    el.textContent = msg || "";
    el.classList.toggle("admin-music-status--err", !!isErr);
  }

  function patchSettings(body) {
    return fetch("/api/admin/music/settings", {
      method: "PATCH",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    }).then(function (r) {
      return r.json().then(function (d) {
        return { ok: r.ok, d: d };
      });
    });
  }

  function loadMusic() {
    setStatus("Загрузка…", false);
    return fetch("/api/admin/music", { headers: authHeaders(), cache: "no-store" })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, d: d };
        });
      })
      .then(function (x) {
        if (!x.ok) {
          setStatus((x.d && x.d.error) || "Не удалось загрузить", true);
          return;
        }
        state.music_enabled = !!x.d.music_enabled;
        state.music_default_volume = fmtVol(x.d.music_default_volume);
        state.tracks = Array.isArray(x.d.tracks) ? x.d.tracks : [];
        paintMusic();
        setStatus("", false);
      })
      .catch(function () {
        setStatus("Ошибка сети", true);
      });
  }

  function paintMusic() {
    const toggle = document.getElementById("admin-music-enabled");
    const vol = document.getElementById("admin-music-volume");
    const volVal = document.getElementById("admin-music-volume-val");
    const list = document.getElementById("admin-music-tracks");
    const empty = document.getElementById("admin-music-empty");
    if (toggle) toggle.checked = !!state.music_enabled;
    if (vol) vol.value = String(state.music_default_volume);
    if (volVal) volVal.textContent = String(state.music_default_volume) + "%";
    if (!list) return;
    if (!state.tracks.length) {
      list.innerHTML = "";
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    list.innerHTML = state.tracks
      .map(function (t) {
        const id = Number(t.id);
        const title = esc(t.title || "Трек");
        const url = esc(t.file_url || "");
        const on = !!t.enabled;
        return (
          '<article class="admin-music-track" data-track-id="' +
          String(id) +
          '">' +
          '<div class="admin-music-track__main">' +
          '<input type="text" class="admin-music-track__title" value="' +
          title +
          '" maxlength="180" aria-label="Название трека" />' +
          '<a class="admin-music-track__link" href="' +
          url +
          '" target="_blank" rel="noopener noreferrer">Прослушать</a>' +
          "</div>" +
          '<div class="admin-music-track__actions">' +
          '<label class="admin-music-track__toggle">' +
          '<input type="checkbox" class="admin-music-track__enabled" data-track-id="' +
          String(id) +
          '" ' +
          (on ? "checked" : "") +
          " />" +
          '<span>В плейлисте</span>' +
          "</label>" +
          '<button type="button" class="admin-music-track__delete" data-track-id="' +
          String(id) +
          '">Удалить</button>' +
          "</div>" +
          "</article>"
        );
      })
      .join("");
  }

  function uploadTrack(file, titleHint) {
    const progress = document.getElementById("admin-music-upload-progress");
    const btn = document.getElementById("admin-music-upload-btn");
    return new Promise(function (resolve, reject) {
      const fd = new FormData();
      fd.append("file", file);
      if (titleHint) fd.append("title", titleHint);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/admin/music/upload");
      const h = authHeaders();
      if (h.Authorization) xhr.setRequestHeader("Authorization", h.Authorization);
      xhr.upload.onprogress = function (ev) {
        if (!progress || !ev.lengthComputable) return;
        const pct = Math.round((ev.loaded / ev.total) * 100);
        progress.textContent = "Загрузка " + String(pct) + "%";
      };
      xhr.onload = function () {
        let d = {};
        try {
          d = JSON.parse(xhr.responseText || "{}");
        } catch (_) {}
        if (xhr.status >= 200 && xhr.status < 300) resolve(d);
        else reject(new Error((d && d.error) || "Ошибка загрузки"));
      };
      xhr.onerror = function () {
        reject(new Error("Ошибка сети"));
      };
      if (btn) btn.disabled = true;
      if (progress) progress.textContent = "Загрузка…";
      xhr.send(fd);
    })
      .finally(function () {
        if (btn) btn.disabled = false;
        if (progress) progress.textContent = "";
      });
  }

  function bindMusicPanel() {
    const root = document.getElementById("admin-music-app");
    if (!root || root.dataset.abMusicBound === "1") return;
    root.dataset.abMusicBound = "1";

    const toggle = document.getElementById("admin-music-enabled");
    const vol = document.getElementById("admin-music-volume");
    const fileInput = document.getElementById("admin-music-file");
    const uploadBtn = document.getElementById("admin-music-upload-btn");
    const drop = document.getElementById("admin-music-drop");

    if (toggle) {
      toggle.addEventListener("change", function () {
        const on = !!toggle.checked;
        toggle.disabled = true;
        patchSettings({ music_enabled: on })
          .then(function (x) {
            if (!x.ok) throw new Error((x.d && x.d.error) || "Ошибка");
            state.music_enabled = !!x.d.music_enabled;
            state.music_default_volume = fmtVol(x.d.music_default_volume);
            setStatus(on ? "Музыка включена для всех" : "Музыка выключена — иконки на сайте не будет", false);
          })
          .catch(function (e) {
            toggle.checked = !on;
            setStatus(String((e && e.message) || "Ошибка"), true);
          })
          .finally(function () {
            toggle.disabled = false;
          });
      });
    }

    if (vol) {
      let volTimer = null;
      const commitVol = function () {
        const v = fmtVol(vol.value);
        vol.value = String(v);
        patchSettings({ music_default_volume: v })
          .then(function (x) {
            if (!x.ok) throw new Error((x.d && x.d.error) || "Ошибка");
            state.music_default_volume = fmtVol(x.d.music_default_volume);
            paintMusic();
            setStatus("Громкость по умолчанию: " + String(state.music_default_volume) + "%", false);
          })
          .catch(function (e) {
            setStatus(String((e && e.message) || "Ошибка"), true);
          });
      };
      vol.addEventListener("input", function () {
        const valEl = document.getElementById("admin-music-volume-val");
        if (valEl) valEl.textContent = fmtVol(vol.value) + "%";
        if (volTimer) clearTimeout(volTimer);
        volTimer = setTimeout(commitVol, 350);
      });
    }

    function handleFiles(files) {
      const list = files ? Array.from(files) : [];
      if (!list.length) return;
      let chain = Promise.resolve();
      list.forEach(function (file) {
        chain = chain.then(function () {
          return uploadTrack(file).then(function (d) {
            if (d && d.track) {
              state.tracks.push(d.track);
              paintMusic();
            }
          });
        });
      });
      chain
        .then(function () {
          setStatus("Треки загружены", false);
          return loadMusic();
        })
        .catch(function (e) {
          setStatus(String((e && e.message) || "Ошибка загрузки"), true);
        });
    }

    if (uploadBtn && fileInput) {
      uploadBtn.addEventListener("click", function () {
        fileInput.click();
      });
      fileInput.addEventListener("change", function () {
        handleFiles(fileInput.files);
        fileInput.value = "";
      });
    }

    if (drop) {
      drop.addEventListener("dragover", function (e) {
        e.preventDefault();
        drop.classList.add("is-dragover");
      });
      drop.addEventListener("dragleave", function () {
        drop.classList.remove("is-dragover");
      });
      drop.addEventListener("drop", function (e) {
        e.preventDefault();
        drop.classList.remove("is-dragover");
        handleFiles(e.dataTransfer && e.dataTransfer.files);
      });
    }

    root.addEventListener("click", function (e) {
      const del = e.target.closest(".admin-music-track__delete");
      if (del) {
        const id = Number(del.getAttribute("data-track-id"));
        if (!Number.isFinite(id)) return;
        if (!window.confirm("Удалить этот трек?")) return;
        del.disabled = true;
        fetch("/api/admin/music/tracks/" + String(id), {
          method: "DELETE",
          headers: authHeaders(),
          cache: "no-store",
        })
          .then(function (r) {
            return r.json().then(function (d) {
              return { ok: r.ok, d: d };
            });
          })
          .then(function (x) {
            if (!x.ok) throw new Error((x.d && x.d.error) || "Ошибка");
            state.tracks = state.tracks.filter(function (t) {
              return Number(t.id) !== id;
            });
            paintMusic();
            setStatus("Трек удалён", false);
          })
          .catch(function (err) {
            setStatus(String((err && err.message) || "Ошибка"), true);
          })
          .finally(function () {
            del.disabled = false;
          });
        return;
      }

      const en = e.target.closest(".admin-music-track__enabled");
      if (en) {
        const id = Number(en.getAttribute("data-track-id"));
        if (!Number.isFinite(id)) return;
        fetch("/api/admin/music/tracks/" + String(id), {
          method: "PATCH",
          headers: Object.assign({ "Content-Type": "application/json" }, authHeaders()),
          body: JSON.stringify({ enabled: !!en.checked }),
          cache: "no-store",
        })
          .then(function (r) {
            return r.json().then(function (d) {
              return { ok: r.ok, d: d };
            });
          })
          .then(function (x) {
            if (!x.ok) throw new Error((x.d && x.d.error) || "Ошибка");
            const tr = x.d.track;
            state.tracks = state.tracks.map(function (t) {
              return Number(t.id) === id ? tr : t;
            });
            setStatus(tr && tr.enabled ? "Трек в плейлисте" : "Трек скрыт из плейлиста", false);
          })
          .catch(function (err) {
            en.checked = !en.checked;
            setStatus(String((err && err.message) || "Ошибка"), true);
          });
      }
    });

    root.addEventListener(
      "blur",
      function (e) {
        const inp = e.target.closest(".admin-music-track__title");
        if (!inp) return;
        const card = inp.closest(".admin-music-track");
        const id = card ? Number(card.getAttribute("data-track-id")) : NaN;
        if (!Number.isFinite(id)) return;
        fetch("/api/admin/music/tracks/" + String(id), {
          method: "PATCH",
          headers: Object.assign({ "Content-Type": "application/json" }, authHeaders()),
          body: JSON.stringify({ title: String(inp.value || "").trim() }),
          cache: "no-store",
        })
          .then(function (r) {
            return r.json().then(function (d) {
              return { ok: r.ok, d: d };
            });
          })
          .then(function (x) {
            if (!x.ok) return;
            const tr = x.d.track;
            state.tracks = state.tracks.map(function (t) {
              return Number(t.id) === id ? tr : t;
            });
          })
          .catch(function () {});
      },
      true,
    );
  }

  window.abInitMusic = function () {
    bindMusicPanel();
    void loadMusic();
  };
})();
