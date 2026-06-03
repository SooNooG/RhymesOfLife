(function () {
  const gettext = window.gettext || ((s) => s);
  const CFG = window.MY_HEALTH_CFG || {};
  const endpoints = CFG.endpoints || {};
  const i18n = CFG.i18n || {};
  const examApi = (id) => (endpoints.examApiPattern || "").replace("/0/", `/${id}/`);
  const docApi = (id) => (endpoints.docDeletePattern || "").replace("/0/", `/${id}/`);

  if (!endpoints.wellness || !endpoints.exams) return;

  let chart;
  const loaded = {};
  let currentDaysFilter = 90;

  function htmlLoad(paneId, url) {
    const pane = document.querySelector(paneId);
    if (!pane) return Promise.resolve();
    pane.innerHTML = '<div class="text-center py-5"><div class="spinner-border" role="status"></div></div>';
    return fetch(url, { credentials: "same-origin", headers: { "X-Requested-With": "XMLHttpRequest" } })
      .then(r => r.text())
      .then(html => {
        pane.innerHTML = html;
        if (paneId === "#pane-wellness") initWellness();
        if (paneId === "#pane-comments") wireCommentsPagination();
        if (paneId === "#pane-exams") initDocumentsTab();
        if (paneId === "#pane-medications") initMedicationsTab();
      })
      .catch(() => { pane.innerHTML = `<div class="alert alert-danger mb-0">${i18n.failedLoad || gettext("Failed to load.")}</div>`; });
  }

  function lazyLoadChartJs() {
    return new Promise((resolve) => {
      if (window.Chart) return resolve();
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js";
      s.onload = resolve;
      document.head.appendChild(s);
    });
  }

  function getCsrfToken() {
    const name = "csrftoken";
    const parts = document.cookie ? document.cookie.split(";") : [];
    for (let c of parts) { c = c.trim(); if (c.startsWith(name + "=")) return decodeURIComponent(c.substring(name.length + 1)); }
    return "";
  }

  function getUserTimeZone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch (_) {
      return "";
    }
  }

  function formatLocalDate(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function fetchEntries(days = 90) {
    return fetch(`${endpoints.apiEntries}?days=${days}`, { headers: { "X-Requested-With": "XMLHttpRequest" }, credentials: "same-origin" })
      .then(r => r.json());
  }

  function wrapNote(text, maxLen = 60) {
    if (!text) return [];
    const words = String(text).split(/\s+/);
    const lines = [];
    let line = "";
    for (const w of words) {
      if ((line + " " + w).trim().length <= maxLen) line = (line ? line + " " : "") + w;
      else {
        if (line) lines.push(line);
        if (w.length > maxLen) { for (let i = 0; i < w.length; i += maxLen) lines.push(w.slice(i, i + maxLen)); line = ""; }
        else line = w;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  function renderChart(items) {
    const canvas = document.getElementById("chart");
    if (!canvas) return;
    const dataPoints = items.map(i => ({ x: i.date, y: i.score, note: i.note || "" }));
    const labels = items.map(i => i.date);
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const displayWidth = Math.max(1, Math.round(rect.width));
    const displayHeight = Math.max(1, Math.round(rect.height));

    if (canvas.width !== displayWidth * dpr || canvas.height !== displayHeight * dpr) {
      canvas.width = displayWidth * dpr;
      canvas.height = displayHeight * dpr;
    }

    const ctx = canvas.getContext("2d");
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (chart) chart.destroy();

    chart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [{
          label: i18n.wellnessLabel || gettext("Wellness"),
          data: dataPoints,
          tension: 0.25,
          fill: false,
          parsing: { xAxisKey: "x", yAxisKey: "y" },
          pointRadius: 4,
          pointHoverRadius: 6
        }]
      },
      options: {
        interaction: { mode: "nearest", intersect: false },
        scales: {
          y: {
            min: 1,
            max: 11,
            ticks: {
              stepSize: 1,
              callback: (value) => {
                if (value === 1) return gettext("Tough");
                if (value === 10) return gettext("Great");
                return value;
              }
            }
          }
        },
        plugins: {
          tooltip: {
            displayColors: false,
            callbacks: {
              title: (ctx) => ctx[0]?.label || "",
              label: (ctx) => `${i18n.score || gettext("Score")}: ${ctx.raw?.y ?? ctx.parsed.y}`,
              afterBody: (ctx) => {
                const note = ctx[0]?.raw?.note?.trim();
                if (!note) return [];
                const header = `${i18n.note || gettext("Note")}:`;
                const lines = wrapNote(note, 60);
                return [header, ...lines];
              }
            }
          }
        }
      }
    });
  }

  function renderList(items) {
    const list = document.getElementById("entries-list");
    const empty = document.getElementById("no-entries");
    if (!list || !empty) return;

    list.innerHTML = "";
    if (!items || !items.length) {
      empty.classList.remove("d-none");
      updateEntriesCount(0);
      return;
    }
    empty.classList.add("d-none");

    items.slice().reverse().forEach(e => {
      const li = document.createElement("li");
      li.className = "timeline-item entry-item";

      const meta = document.createElement("div");
      meta.className = "entry-meta";

      const date = document.createElement("div");
      date.className = "entry-date";
      date.textContent = e.date || "";

      const score = document.createElement("div");
      score.className = "entry-score";
      score.textContent = `${i18n.score || gettext("Score")}: ${e.score}`;

      const actions = document.createElement("div");
      actions.className = "entry-actions";
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "btn btn-sm btn-outline-secondary entry-edit-btn";
      editBtn.setAttribute("aria-label", i18n.edit || gettext("Edit"));
      editBtn.setAttribute("title", i18n.edit || gettext("Edit"));
      editBtn.dataset.id = e.id;
      editBtn.dataset.date = e.date;
      editBtn.dataset.score = e.score;
      editBtn.dataset.note = e.note || "";
      editBtn.innerHTML = '<i class="bi bi-pencil"></i>';
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "btn btn-sm btn-outline-danger entry-delete-btn";
      delBtn.setAttribute("aria-label", i18n.delete || gettext("Delete"));
      delBtn.setAttribute("title", i18n.delete || gettext("Delete"));
      delBtn.dataset.id = e.id;
      delBtn.innerHTML = '<i class="bi bi-trash3"></i>';
      actions.appendChild(editBtn);
      actions.appendChild(delBtn);

      const note = document.createElement("div");
      note.className = "entry-note text-break";
      if (e.note) {
        note.textContent = e.note;
      } else {
        note.textContent = i18n.noNote || gettext("No additional notes");
        note.classList.add("is-empty");
      }

      meta.appendChild(date);
      meta.appendChild(score);
      meta.appendChild(actions);
      li.appendChild(meta);
      li.appendChild(note);
      list.appendChild(li);
    });

    updateEntriesCount(items.length);
  }

  function updateEntriesCount(count) {
    const countEl = document.getElementById("entries-count");
    if (countEl) countEl.textContent = count;
  }

  function applyIntervalState() {
    const el = document.getElementById("rem-interval");
    if (!el) return;
    const hour = document.getElementById("rem-hour");
    const minute = document.getElementById("rem-min");
    const tg = document.getElementById("tg-enabled");
    const email = document.getElementById("email-enabled");
    const badge = document.getElementById("frequency-badge");
    const disabled = parseInt(el.value || "3", 10) === 0;
    if (hour) hour.disabled = disabled;
    if (minute) minute.disabled = disabled;
    if (tg) tg.disabled = disabled;
    if (email) email.disabled = disabled;

    if (badge) {
      const intervalText = {
        "0": gettext("Never"),
        "1": gettext("Every day"),
        "3": gettext("Every 3 days"),
        "7": gettext("Every week"),
        "14": gettext("Every 2 weeks")
      }[el.value] || gettext("Every 3 days");
      badge.textContent = intervalText;
    }
  }

  function openSettings() {
    if (!window.bootstrap) return;
    const modalRoot = document.getElementById("settingsModal");
    if (!modalRoot) return;
    const modal = bootstrap.Modal.getOrCreateInstance(modalRoot);
    fetch(endpoints.apiSettings, { headers: { "X-Requested-With": "XMLHttpRequest" }, credentials: "same-origin" })
      .then(r => r.json())
      .then(d => {
        const s = d.settings || {};
        const h = document.getElementById("rem-hour");
        const m = document.getElementById("rem-min");
        const iv = document.getElementById("rem-interval");
        const tg = document.getElementById("tg-enabled");
        const email = document.getElementById("email-enabled");
        const tzLabel = document.getElementById("rem-tz-label");
        if (h) h.value = s.reminder_hour ?? 20;
        if (m) m.value = s.reminder_minute ?? 0;
        if (iv) iv.value = s.reminder_interval ?? 3;
        if (tg) tg.checked = !!s.tg_notifications_enabled;
        if (email) email.checked = !!s.email_notifications_enabled;
        if (tzLabel) {
          const tz = getUserTimeZone();
          tzLabel.textContent = tz ? `(${tz})` : "";
        }
        if (!s.reminder_tz) {
          const tz = getUserTimeZone();
          if (tz) {
            const fd = new FormData();
            fd.append("reminder_tz", tz);
            fetch(endpoints.apiSettings, {
              method: "POST",
              headers: { "X-Requested-With": "XMLHttpRequest", "X-CSRFToken": getCsrfToken() },
              body: fd, credentials: "same-origin"
            }).catch(() => {});
          }
        }
        applyIntervalState();
        modal.show();
      });
  }

  function saveSettings() {
    const fd = new FormData();
    fd.append("reminder_hour", document.getElementById("rem-hour").value || "0");
    fd.append("reminder_minute", document.getElementById("rem-min").value || "0");
    fd.append("reminder_interval", document.getElementById("rem-interval").value || "3");
    const tg = document.getElementById("tg-enabled");
    const email = document.getElementById("email-enabled");
    if (tg) fd.append("tg_notifications_enabled", tg.checked ? "1" : "0");
    if (email) fd.append("email_notifications_enabled", email.checked ? "1" : "0");
    const tz = getUserTimeZone();
    if (tz) fd.append("reminder_tz", tz);
    return fetch(endpoints.apiSettings, {
      method: "POST",
      headers: { "X-Requested-With": "XMLHttpRequest", "X-CSRFToken": getCsrfToken() },
      body: fd, credentials: "same-origin"
    }).then(r => r.json());
  }

  function saveEntry() {
    const form = document.getElementById("entry-form");
    if (!form) return Promise.resolve();
    const scoreInput = document.getElementById("score");
    if (!scoreInput || !scoreInput.value) {
      alert(i18n.pleaseSelectScore || gettext("Please select a wellness score"));
      return Promise.reject("No score selected");
    }
    const fd = new FormData(form);
    const dateInput = document.getElementById("entry-date");
    const dateVal = (dateInput && dateInput.value) ? dateInput.value : formatLocalDate();
    fd.set("date", dateVal);
    return fetch(endpoints.apiEntries, {
      method: "POST",
      headers: { "X-Requested-With": "XMLHttpRequest", "X-CSRFToken": getCsrfToken() },
      body: fd, credentials: "same-origin"
    }).then(r => r.json());
  }

  function wireCommentsPagination() {
    const pane = document.querySelector("#pane-comments");
    if (!pane) return;
    pane.addEventListener("click", (e) => {
      const a = e.target.closest("a.page-link");
      if (!a) return;
      const href = a.getAttribute("href");
      if (!href) return;
      e.preventDefault();
      const url = new URL(href, window.location.origin);
      const q = url.searchParams.toString();
      htmlLoad("#pane-comments", endpoints.recs + (q ? ("?" + q) : ""));
    });
  }

  function normalizeUrlMaybe(u) {
    if (!u) return "";
    let s = String(u).trim();
    if (!s) return "";
    if (!/^https?:\/\//i.test(s)) s = "https://" + s;
    return s;
  }

  function bindWellnessUI() {
    document.querySelectorAll("#pane-wellness textarea").forEach(function (ta) {
      const resize = () => {
        ta.style.height = "auto";
        ta.style.height = ta.scrollHeight + "px";
      };
      ta.addEventListener("input", resize);
      resize();
    });

    initScoreSelector();
    initChartFilter();
  }

  function setEditState(entry) {
    const dateInput = document.getElementById("entry-date");
    const noteInput = document.getElementById("note");
    const banner = document.getElementById("edit-banner");
    const bannerText = document.getElementById("edit-banner-text");
    const btnSave = document.getElementById("btn-save");
    const btnSaveMobile = document.getElementById("btn-save-mobile");
    if (!dateInput || !banner) return;
    if (!entry) {
      dateInput.value = "";
      banner.classList.add("d-none");
      return;
    }
    dateInput.value = entry.date || "";
    if (noteInput) noteInput.value = entry.note || "";
    if (noteInput) noteInput.dispatchEvent(new Event("input"));
    if (bannerText) {
      const tpl = i18n.editingEntry || gettext("Editing entry for %(date)s");
      bannerText.textContent = tpl.replace("%(date)s", entry.date || "");
    }
    banner.classList.remove("d-none");
    const scoreInput = document.getElementById("score");
    if (scoreInput) scoreInput.value = String(entry.score || 5);
    initScoreSelector();
    if (btnSave) {
      btnSave.dataset.defaultText = btnSave.dataset.defaultText || btnSave.textContent;
      btnSave.innerHTML = i18n.saveChanges || gettext("Save changes");
    }
    if (btnSaveMobile) {
      btnSaveMobile.dataset.defaultText = btnSaveMobile.dataset.defaultText || btnSaveMobile.textContent;
      btnSaveMobile.innerHTML = i18n.saveChanges || gettext("Save changes");
    }
    document.getElementById("entry-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function clearEditState() {
    const banner = document.getElementById("edit-banner");
    const dateInput = document.getElementById("entry-date");
    const noteInput = document.getElementById("note");
    const scoreInput = document.getElementById("score");
    const btnSave = document.getElementById("btn-save");
    const btnSaveMobile = document.getElementById("btn-save-mobile");
    if (dateInput) dateInput.value = "";
    if (noteInput) noteInput.value = "";
    if (scoreInput) scoreInput.value = "5";
    initScoreSelector();
    if (banner) banner.classList.add("d-none");
    if (btnSave && btnSave.dataset.defaultText) {
      btnSave.innerHTML = btnSave.dataset.defaultText;
    }
    if (btnSaveMobile && btnSaveMobile.dataset.defaultText) {
      btnSaveMobile.innerHTML = btnSaveMobile.dataset.defaultText;
    }
  }

  function initScoreSelector() {
    const options = document.querySelectorAll(".score-option");
    const hiddenSelect = document.getElementById("score");
    if (!hiddenSelect || !options.length) return;

    function apply(value) {
      const v = String(Math.max(1, Math.min(10, parseInt(value || "5", 10))));
      hiddenSelect.value = v;
      options.forEach(opt => {
        opt.classList.toggle("active", opt.dataset.value === v);
      });
    }

    options.forEach(option => {
      option.addEventListener("click", () => {
        apply(option.dataset.value);
      });
    });

    apply(hiddenSelect.value || "5");
  }

  function initChartFilter() {
    document.querySelectorAll("[data-days]").forEach(item => {
      item.addEventListener("click", (e) => {
        e.preventDefault();
        const days = parseInt(item.dataset.days, 10);
        if (!Number.isFinite(days)) return;
        currentDaysFilter = days;

        document.querySelectorAll("[data-days]").forEach(i => {
          i.closest(".dropdown-item")?.classList.remove("active");
        });
        item.closest(".dropdown-item")?.classList.add("active");

        fetchEntries(days).then(d => {
          const items = d.items || [];
          renderChart(items);
        });
      });
    });
  }

  function initWellness() {
    lazyLoadChartJs().then(() => {
      const modalEl = document.querySelector("#pane-wellness #settingsModal");
      if (modalEl && !modalEl.dataset.moved) { document.body.appendChild(modalEl); modalEl.dataset.moved = "1"; }
      document.addEventListener("show.bs.modal", () => { document.querySelectorAll(".modal-backdrop").forEach(el => el.remove()); });
      document.addEventListener("hidden.bs.modal", () => {
        document.querySelectorAll(".modal-backdrop").forEach(el => el.remove());
        document.body.classList.remove("modal-open");
        document.body.style.removeProperty("overflow");
        document.body.style.removeProperty("padding-right");
      });

      bindWellnessUI();

      fetchEntries(currentDaysFilter).then(d => {
        const items = d.items || [];
        renderChart(items);
        renderList(items);
      });

      const btnSave = document.getElementById("btn-save");
      const btnSaveMobile = document.getElementById("btn-save-mobile");
      const btnSettings = document.getElementById("btn-settings");
      const btnSaveSettings = document.getElementById("btn-save-settings");
      const btnCancelEdit = document.getElementById("btn-cancel-edit");
      const entriesList = document.getElementById("entries-list");

      if (btnSave && !btnSave.dataset.bound) {
        btnSave.dataset.bound = "1";
        btnSave.addEventListener("click", () => {
          saveEntry().then(() => fetchEntries(currentDaysFilter).then(d => {
            const items = d.items || [];
            renderChart(items);
            renderList(items);
            clearEditState();
          }));
        });
      }

      if (btnSaveMobile && !btnSaveMobile.dataset.bound) {
        btnSaveMobile.dataset.bound = "1";
        btnSaveMobile.addEventListener("click", () => {
          saveEntry().then(() => fetchEntries(currentDaysFilter).then(d => {
            const items = d.items || [];
            renderChart(items);
            renderList(items);
            clearEditState();
          }));
        });
      }
      if (btnSettings && !btnSettings.dataset.bound) {
        btnSettings.dataset.bound = "1";
        btnSettings.addEventListener("click", openSettings);
      }
      if (btnSaveSettings && !btnSaveSettings.dataset.bound) {
        btnSaveSettings.dataset.bound = "1";
        btnSaveSettings.addEventListener("click", () => {
          saveSettings().then(() => {
            if (!window.bootstrap) return;
            const modalRoot = document.getElementById("settingsModal");
            const modal = bootstrap.Modal.getInstance(modalRoot);
            if (modal) modal.hide();
          });
        });
      }
      const intervalSelect = document.getElementById("rem-interval");
      if (intervalSelect && !intervalSelect.dataset.bound) {
        intervalSelect.dataset.bound = "1";
        intervalSelect.addEventListener("change", applyIntervalState);
      }

      if (btnCancelEdit && !btnCancelEdit.dataset.bound) {
        btnCancelEdit.dataset.bound = "1";
        btnCancelEdit.addEventListener("click", () => {
          clearEditState();
        });
      }

      if (entriesList && !entriesList.dataset.bound) {
        entriesList.dataset.bound = "1";
        entriesList.addEventListener("click", (e) => {
          const editBtn = e.target.closest(".entry-edit-btn");
          const delBtn = e.target.closest(".entry-delete-btn");
          if (editBtn) {
            setEditState({
              id: editBtn.dataset.id,
              date: editBtn.dataset.date,
              score: parseInt(editBtn.dataset.score || "5", 10),
              note: editBtn.dataset.note || ""
            });
            return;
          }
          if (delBtn) {
            const id = delBtn.dataset.id;
            if (!id) return;
            if (!confirm(i18n.deleteEntryQ || gettext("Delete this entry?"))) return;
            fetch(`${endpoints.apiEntries}?id=${encodeURIComponent(id)}`, {
              method: "DELETE",
              headers: { "X-CSRFToken": getCsrfToken(), "X-Requested-With": "XMLHttpRequest" },
              credentials: "same-origin"
            })
            .then(r => r.json())
            .then(j => {
              if (j.status === "ok") {
                fetchEntries(currentDaysFilter).then(d => {
                  const items = d.items || [];
                  renderChart(items);
                  renderList(items);
                  clearEditState();
                });
              } else {
                alert(j.message || i18n.deletionFailed || gettext("Deletion failed."));
              }
            })
            .catch(() => alert(i18n.networkError || gettext("Network error.")));
          }
        });
      }
    });
  }

  function refreshDocumentsPane() { return htmlLoad("#pane-exams", endpoints.exams); }

  function initDocumentsTab() {
    const root = document.querySelector("#pane-exams");
    if (!root) return;

    const form = root.querySelector("#exam-form");
    if (!form || form.dataset.bound) return;
    form.dataset.bound = "1";

    const dateInput = form.querySelector("#exam_date");
    const descInput = form.querySelector("#description");
    const csrfEl = form.querySelector("[name=csrfmiddlewaretoken]");
    const csrfToken = csrfEl ? csrfEl.value : getCsrfToken();

    const dropZone = form.querySelector("#drop-zone");
    const fileInput = form.querySelector("#file-input");
    const fileList = form.querySelector("#file-list");
    const submitBtn = form.querySelector("#submit-exam");
    const examIdInput = form.querySelector("#exam_id");

    const linkList = form.querySelector("#link-list");
    const addLinkBtn = form.querySelector("#add-link-btn");
    const singleLink = form.querySelector("#external_url");

    const allowedExts = (dropZone?.dataset.allowedExt || ".pdf,.jpg,.jpeg,.png").split(",").map(s => s.trim().replace(/^\./, "").toLowerCase());
    const maxSize = parseInt(dropZone?.dataset.maxSize || "20971520", 10);

    function formatMB(bytes) { const mb = bytes / (1024 * 1024); return (Math.round(mb * 10) / 10) + " MB"; }

    (function ensureDropHint() {
      const extsText = allowedExts.map(e => "." + e).join(", ");
      const sizeText = formatMB(maxSize);
      const tpl = i18n.allowedFilesTpl || gettext("Allowed: %(ext)s. Max size: %(size)s");
      const text = tpl.replace("%(ext)s", extsText).replace("%(size)s", sizeText);
      let hint = form.querySelector("#drop-hint");
      if (!hint) {
        hint = document.createElement("div");
        hint.id = "drop-hint";
        hint.className = "form-text mt-2";
        if (dropZone) dropZone.appendChild(hint); else form.appendChild(hint);
      }
      hint.textContent = text;
    })();

    (function ensureLinkHint() {
      if (!linkList) return;
      let h = form.querySelector("#link-hint");
      if (!h) {
        h = document.createElement("div");
        h.id = "link-hint";
        h.className = "form-text mt-1";
        linkList.parentElement.appendChild(h);
      }
      h.textContent = i18n.linkHint || gettext("You can attach external links (e.g., Google Drive, Dropbox, OneDrive).");
    })();

    let filesToUpload = [];

    function addLinkInput(prefill = "") {
      const wrap = document.createElement("div");
      wrap.className = "link-item";
      wrap.innerHTML = `
        <input type="url" class="form-control ext-link" placeholder="${i18n.pasteLink || gettext("Paste link")}" value="${prefill}">
        <button type="button" class="btn btn-sm btn-outline-danger remove-link-btn" aria-label="${i18n.removeLink || gettext("Remove link")}">тЬЦ</button>
      `;
      linkList.appendChild(wrap);
      wrap.querySelector(".remove-link-btn").onclick = () => wrap.remove();
    }
    if (addLinkBtn && linkList) addLinkBtn.addEventListener("click", () => addLinkInput(""));

    function renderFileCard(file) {
      const div = document.createElement("div");
      div.className = "file-card d-flex justify-content-between align-items-center border p-2 mb-2 rounded";
      div.dataset.name = file.name; div.dataset.size = file.size;
      div.innerHTML = `
        <span class="me-2">Файл: <strong>${file.name}</strong></span>
        <button type="button" class="btn btn-sm btn-outline-danger remove-file-btn" data-name="${file.name}" data-size="${file.size}" aria-label="${i18n.removeFile || gettext("Remove file")}">тЬЦ</button>
      `;
      fileList.appendChild(div);
    }

    function attachRemoveHandlers() {
      form.querySelectorAll(".remove-file-btn").forEach(btn => {
        btn.onclick = () => {
          const { name, size } = btn.dataset;
          filesToUpload = filesToUpload.filter(f => !(f.name === name && String(f.size) === String(size)));
          btn.closest(".file-card")?.remove();
        };
      });
    }

    function extOf(name) { const p = name.lastIndexOf("."); return p >= 0 ? name.slice(p + 1).toLowerCase() : ""; }

    function handleFiles(list) {
      Array.from(list).forEach(file => {
        const ext = extOf(file.name);
        if (!allowedExts.includes(ext)) {
          const tpl = i18n.unsupportedTypeTpl || gettext("Unsupported file type: %(name)s");
          alert(tpl.replace("%(name)s", file.name));
          return;
        }
        if (file.size > maxSize) {
          const mb = Math.ceil(maxSize / (1024 * 1024));
          const tpl = i18n.tooLargeTpl || gettext("File is too large (max %(size)s MB): %(name)s");
          alert(tpl.replace("%(size)s", String(mb)).replace("%(name)s", file.name));
          return;
        }
        if (filesToUpload.some(f => f.name === file.name && f.size === file.size)) {
          alert(i18n.duplicateFile || gettext("This file is already in the list."));
          return;
        }
        filesToUpload.push(file);
        renderFileCard(file);
      });
      attachRemoveHandlers();
    }

    if (dropZone && fileInput && fileList) {
      dropZone.addEventListener("click", e => { if (!e.target.closest(".dropdown")) fileInput.click(); });
      dropZone.addEventListener("dragover", e => { e.preventDefault(); dropZone.classList.add("dragover"); });
      dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
      dropZone.addEventListener("drop", e => { e.preventDefault(); dropZone.classList.remove("dragover"); handleFiles(e.dataTransfer.files); });
      fileInput.addEventListener("change", e => handleFiles(e.target.files));
    }

    if (submitBtn) {
      submitBtn.addEventListener("click", () => {
        if (!dateInput || !dateInput.value) { alert(i18n.pleaseDate || gettext("Please specify the exam date.")); return; }

        const fd = new FormData();
        fd.append("exam_date", dateInput.value);
        fd.append("description", (descInput?.value || "").trim());

        if (singleLink && singleLink.value.trim()) fd.append("external_url", normalizeUrlMaybe(singleLink.value));
        const multiLinks = Array.from(form.querySelectorAll(".ext-link")).map(inp => normalizeUrlMaybe(inp.value)).filter(v => v.length > 0);
        multiLinks.forEach(u => fd.append("external_urls[]", u));

        filesToUpload.forEach(f => fd.append("files", f));

        const id = examIdInput?.value || "";
        const url = id ? examApi(id) : endpoints.examsCreate;

        fetch(url, {
          method: "POST",
          headers: { "X-CSRFToken": csrfToken, "X-Requested-With": "XMLHttpRequest" },
          body: fd,
          credentials: "same-origin"
        })
        .then(r => r.json())
        .then(j => {
          if (j.status === "ok") {
            filesToUpload = [];
            if (fileList) fileList.innerHTML = "";
            if (fileInput) fileInput.value = "";
            refreshDocumentsPane();
          } else {
            alert(j.message || i18n.failedSave || gettext("Failed to save."));
          }
        })
        .catch(() => alert(i18n.networkError || gettext("Network error.")));
      });
    }

    root.addEventListener("click", (e) => {
      const editBtn = e.target.closest(".edit-exam-btn");
      const delBtn = e.target.closest(".delete-exam-btn");
      const delFileBtn = e.target.closest(".remove-existing-file-btn");

      if (editBtn) {
        const id = editBtn.dataset.id; if (!id) return;
        fetch(examApi(id), { headers: { "X-Requested-With": "XMLHttpRequest" }, credentials: "same-origin" })
          .then(r => r.json())
          .then(data => {
            if (!data || !data.id) return;
            const dateInput = form.querySelector("#exam_date");
            const descInput = form.querySelector("#description");
            const fileList = form.querySelector("#file-list");
            if (examIdInput) examIdInput.value = data.id;
            if (dateInput) dateInput.value = data.exam_date || "";
            if (descInput) descInput.value = data.description || "";
            if (fileList) fileList.innerHTML = "";
            (data.documents || []).forEach(doc => {
              const div = document.createElement("div");
              div.className = "file-card d-flex justify-content-between align-items-center border p-2 mb-2 rounded";
              div.innerHTML = `
                <a href="${doc.url}" target="_blank" class="text-decoration-none me-2" rel="noopener noreferrer">Файл: <strong>${doc.name}</strong></a>
                <button class="btn btn-sm btn-outline-danger remove-existing-file-btn" data-id="${doc.id}" aria-label="${i18n.removeFile || gettext("Remove file")}">тЬЦ</button>
              `;
              fileList && fileList.appendChild(div);
            });
            form.scrollIntoView({ behavior: "smooth" });
          })
          .catch(() => alert(i18n.unableLoad || gettext("Unable to load data.")));
      }

      if (delBtn) {
        const id = delBtn.dataset.id;
        if (!id) return;
        if (!confirm(i18n.deleteExamQ || gettext("Delete this exam?"))) return;
        fetch(examApi(id), {
          method: "DELETE",
          headers: { "X-CSRFToken": getCsrfToken(), "X-Requested-With": "XMLHttpRequest" },
          credentials: "same-origin"
        })
        .then(r => r.json())
        .then(j => { if (j.status === "ok") refreshDocumentsPane(); else alert(i18n.deletionFailed || gettext("Deletion failed.")); })
        .catch(() => alert(i18n.networkError || gettext("Network error.")));
      }

      if (delFileBtn) {
        const id = delFileBtn.dataset.id;
        if (!id) return;
        if (!confirm(i18n.deleteFileQ || gettext("Delete this file?"))) return;
        fetch(docApi(id), {
          method: "DELETE",
          headers: { "X-CSRFToken": getCsrfToken(), "X-Requested-With": "XMLHttpRequest" },
          credentials: "same-origin"
        })
        .then(r => r.json())
        .then(j => { if (j.status === "ok") delFileBtn.closest(".file-card")?.remove(); else alert(i18n.deletionFailed || gettext("Deletion failed.")); })
        .catch(() => alert(i18n.networkError || gettext("Network error.")));
      }
    });
  }

  function labelForTarget(target) {
    const btn = document.querySelector(`[data-bs-target="${target}"]`);
    const a = btn?.getAttribute("aria-label") || btn?.title || btn?.querySelector(".label")?.textContent || "";
    return a.trim();
  }

  function setMobileTitle(target) {
    const el = document.getElementById("mobile-section-title");
    if (!el) return;
    const txt = labelForTarget(target) || (i18n.mobileDefault || gettext("My health"));
    el.textContent = txt;
  }

  document.addEventListener("DOMContentLoaded", function () {
    htmlLoad("#pane-wellness", endpoints.wellness).then(() => {
      loaded["#pane-wellness"] = true;
      setMobileTitle("#pane-wellness");
    });

    function onShown(e) {
      const target = e.target.getAttribute("data-bs-target");
      if (!target) return;
      if (!loaded[target]) {
        loaded[target] = true;
        if (target === "#pane-exams") htmlLoad("#pane-exams", endpoints.exams);
        if (target === "#pane-comments") htmlLoad("#pane-comments", endpoints.recs);
        if (target === "#pane-wellness") htmlLoad("#pane-wellness", endpoints.wellness);
        if (target === "#pane-medications") htmlLoad("#pane-medications", endpoints.medications);

        sessionStorage.setItem("my-health-tab-id", target.substring(1));
      }
      setMobileTitle(target);
    }

    if (window.bootstrap) {
      const tabs = document.getElementById("healthTabs");
      if (tabs) tabs.addEventListener("shown.bs.tab", onShown);
    } else {
      const check = setInterval(() => {
        if (window.bootstrap) {
          clearInterval(check);
          const tabs = document.getElementById("healthTabs");
          if (tabs) tabs.addEventListener("shown.bs.tab", onShown);
        }
      }, 20);
    }
  });
  function initMedicationsTab() {
    const root = document.querySelector("#pane-medications");
    if (!root || root.dataset.bound) return;
    root.dataset.bound = "1";

    const form = root.querySelector("#medication-form");
    const input = root.querySelector("#medication_description");

    function csrf() {
      const m = document.cookie.match(/csrftoken=([^;]+)/);
      return m ? m[1] : "";
    }

    if (form) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const val = (input?.value || "").trim();
        if (!val) {
          input.classList.add("is-invalid");
          return;
        }
        input.classList.remove("is-invalid");

        const fd = new FormData();
        fd.append("description", val);

        fetch(endpoints.medicationsAdd, {
          method: "POST",
          headers: { "X-CSRFToken": csrf(), "X-Requested-With": "XMLHttpRequest" },
          body: fd,
          credentials: "same-origin",
        }).then(() => {
          const pane = document.querySelector("#pane-medications");
          if (pane) delete pane.dataset.bound;
          htmlLoad("#pane-medications", endpoints.medications);
        });
      });
    }

    root.addEventListener("click", (e) => {
      const btn = e.target.closest(".delete-medication-btn");
      if (!btn) return;

      fetch(
        endpoints.medicationsDeletePattern.replace("/0/", `/${btn.dataset.id}/`),
        {
          method: "POST",
          headers: { "X-CSRFToken": csrf(), "X-Requested-With": "XMLHttpRequest" },
          credentials: "same-origin",
        }
      ).then(() => btn.closest(".card")?.remove());
    });
  }

})();
