const byId = (id) => document.getElementById(id);
const tabs = [...document.querySelectorAll("[data-tab]")];
const sources = [...document.querySelectorAll("[data-source]")];
const tones = [...document.querySelectorAll("[data-tone]")];
const sessionKey = "shion-studio-session";
const durationChoices = [30, 60, 120, 180];
let token = sessionStorage.getItem(sessionKey) || "";
let endpoint = null;
let tab = "create";
let source = "prompt";
let instrumental = false;
let editSourceVisible = false;
let draftParent = null;
let selectedJob = "";
let jobs = [];
let visibleJob = "";
let playerUrl = "";
let notationTimer;
let noteRange = null;
let refreshing = false;

function message(id, value) {
  const node = byId(id);
  node.textContent = value;
  node.hidden = !value;
}

function connection(state) {
  const status = byId("connection");
  status.dataset.state = state;
  status.lastElementChild.textContent =
    state === "online"
      ? "PCに接続中"
      : state === "offline"
        ? "PCはオフライン"
        : "接続を確認中";
}

async function resolveEndpoint() {
  if (location.origin === "http://127.0.0.1:8190") return "";
  const response = await fetch("./endpoint.json", { cache: "no-store" });
  if (!response.ok) throw new Error("接続先が見つかりません。");
  const config = await response.json();
  if (!config.api) throw new Error("PC側の公開接続が準備中です。");
  const url = new URL(config.api);
  if (
    url.protocol !== "https:" ||
    !/^[a-z0-9-]+\.trycloudflare\.com$/.test(url.hostname) ||
    url.origin + "/" !== url.href
  ) {
    throw new Error("PC側の接続先を確認してください。");
  }
  return url.origin;
}

async function api(path, options = {}) {
  const { body, auth = true, blob = false, timeout = 15000 } = options;
  const headers = {};
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  if (body && !(body instanceof FormData))
    headers["Content-Type"] = "application/json";
  if (endpoint === null) endpoint = await resolveEndpoint();
  let response;
  try {
    response = await fetch(endpoint + path, {
      method: body === undefined ? "GET" : "POST",
      headers,
      body:
        body === undefined || body instanceof FormData
          ? body
          : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(timeout),
    });
  } catch {
    endpoint = null;
    connection("offline");
    throw new Error(
      "PCに接続できません。PC側で紫音スタジオを起動してください。",
    );
  }
  if (response.status === 401 && auth)
    signOut("セッションが終了しました。もう一度ログインしてください。");
  if (response.ok && blob) return response.blob();
  const result = await response.json().catch(() => null);
  if (!response.ok || !result)
    throw new Error(result?.error || "PCに接続できませんでした。");
  connection("online");
  return result;
}

function signIn() {
  byId("gate").hidden = true;
  byId("studio").hidden = false;
  byId("logout").hidden = false;
}

function signOut(note = "") {
  token = "";
  sessionStorage.removeItem(sessionKey);
  byId("gate").hidden = false;
  byId("studio").hidden = true;
  byId("logout").hidden = true;
  byId("current").replaceChildren();
  byId("jobs").replaceChildren();
  byId("current").hidden = true;
  byId("empty").hidden = false;
  if (playerUrl) URL.revokeObjectURL(playerUrl);
  playerUrl = "";
  draftParent = null;
  selectedJob = "";
  visibleJob = "";
  jobs = [];
  byId("song-form").reset();
  byId("audio-label").textContent = "音源を選択";
  setTab("create");
  setSource("prompt");
  setTone(false);
  message("login-error", note);
}

function setPressed(buttons, attribute, value) {
  for (const button of buttons) {
    const active = button.dataset[attribute] === value;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

function setTab(next, parent = null) {
  if (next !== tab || parent) draftParent = parent;
  if (next === "edit" && tab !== "edit") {
    editSourceVisible = !["style", "lyrics", "abc"].some((id) =>
      byId(id).value.trim(),
    );
  }
  tab = next;
  setPressed(tabs, "tab", tab);
  syncFields();
}

function setSource(next) {
  if (next === "chords") draftParent = null;
  source = next;
  setPressed(sources, "source", source);
  syncFields();
}

function setTone(value) {
  instrumental = value;
  setPressed(tones, "tone", value ? "instrumental" : "vocal");
  syncFields();
}

function syncFields() {
  const labels = {
    create: ["01 / CREATE", "作曲", "曲のイメージ", "曲を生成"],
    cover: ["02 / COVER", "カバー制作", "アレンジのイメージ", "カバーを生成"],
    abc: ["03 / SCORE", "楽譜から作曲", "曲のイメージ", "楽譜から再生成"],
    edit: ["04 / AI EDIT", "AIで編集", "元の曲調", "AIで下書きを編集"],
  };
  const [kicker, title, style, submit] = labels[tab];
  const editing = tab === "edit";
  byId("workspace-kicker").textContent = kicker;
  byId("workspace-title").textContent = title;
  byId("style-label").textContent = style;
  byId("submit-label").textContent = submit;
  message("draft-source", draftParent ? `編集元　${draftParent.title}` : "");
  byId("style").placeholder =
    tab === "cover"
      ? "アコースティックなボサノバに。軽いギターと柔らかいベース。"
      : "夜明けの街を歩く、透明感のあるピアノポップ。";
  byId("sources").hidden = tab !== "create";
  byId("chord-field").hidden = tab !== "create" || source !== "chords";
  byId("cover-field").hidden = tab !== "cover";
  byId("abc-field").hidden = tab !== "abc";
  byId("edit-field").hidden = !editing;
  byId("edit-tools").hidden = !editing;
  byId("render-options").hidden = editing;
  byId("style-field").hidden = editing && !editSourceVisible;
  byId("lyrics-field").hidden = editing
    ? !editSourceVisible
    : instrumental || (tab === "create" && source === "prompt");
  const editToggle = byId("toggle-edit-source");
  editToggle.setAttribute(
    "aria-expanded",
    String(editing && editSourceVisible),
  );
  editToggle.textContent = editSourceVisible
    ? "元の曲調・歌詞を閉じる"
    : "元の曲調・歌詞を表示";
  const submitButton = byId("submit-song");
  const slot = byId(editing ? "edit-submit-slot" : "standard-submit-slot");
  if (submitButton.parentElement !== slot)
    slot.append(byId("form-error"), submitButton);
  byId("lyric-note").textContent =
    tab === "cover"
      ? "空欄なら音源から認識"
      : tab === "create" && source === "lyrics"
        ? ""
        : "任意";
  message("form-error", "");
  drawNotation();
}

function drawNotation() {
  clearTimeout(notationTimer);
  noteRange = null;
  byId("note-editor").hidden = true;
  byId("note-hint").hidden = true;
  const notation = byId("notation");
  const abc = byId("abc").value;
  if (
    byId("abc-field").hidden ||
    !abc.trim() ||
    !window.ABCJS ||
    !/^K:/m.test(abc)
  ) {
    notation.hidden = true;
    notation.replaceChildren();
    return;
  }
  notationTimer = setTimeout(() => {
    try {
      notation.hidden = false;
      const width = Math.max(260, notation.clientWidth - 25);
      window.ABCJS.renderAbc(notation, abc, {
        responsive: "resize",
        staffwidth: width,
        paddingtop: 8,
        paddingbottom: 8,
        add_classes: true,
        selectTypes: ["note"],
        clickListener(element) {
          const { startChar: start, endChar: end } = element;
          if (
            element.el_type !== "note" ||
            !Number.isInteger(start) ||
            !Number.isInteger(end) ||
            start < 0 ||
            end <= start ||
            end > abc.length
          )
            return;
          noteRange = { start, end, abc };
          byId("note-token").value = abc.slice(start, end).trim();
          byId("note-editor").hidden = false;
          byId("note-hint").hidden = true;
        },
      });
      byId("note-hint").hidden = false;
    } catch {
      notation.hidden = true;
    }
  }, 180);
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function openDraft(job, next) {
  const result = job.result || job;
  byId("style").value = result.style || "";
  byId("lyrics").value =
    result.lyrics === "[instrumental]" ? "" : result.lyrics || "";
  byId("abc").value = result.abc || "";
  if (next === "edit") editSourceVisible = false;
  if (durationChoices.includes(job.seconds))
    byId("seconds").value = String(job.seconds);
  setTone(job.instrumental);
  setTab(next, job);
  byId("workspace-title").scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
  byId(next === "edit" ? "instruction" : "abc").focus({ preventScroll: true });
}

function action(text, callback) {
  const button = document.createElement("button");
  button.className = "button";
  button.type = "button";
  button.textContent = text;
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await callback();
    } catch (error) {
      const note = document.createElement("p");
      note.className = "error";
      note.setAttribute("role", "alert");
      note.textContent = error.message;
      button.closest(".current")?.append(note);
    } finally {
      button.disabled = false;
    }
  });
  return button;
}

function renderJobs() {
  const list = byId("jobs");
  const active = document.activeElement?.dataset?.job;
  list.replaceChildren();
  byId("empty").hidden = jobs.length > 0;
  for (const job of jobs) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.job = job.id;
    button.classList.toggle("selected", job.id === selectedJob);
    const name = document.createElement("span");
    name.className = "job-name";
    name.textContent = job.title;
    const label = document.createElement("span");
    label.className = "job-label";
    label.append(name);
    if (job.lineage?.source) {
      const origin = document.createElement("span");
      origin.className = "job-origin";
      origin.textContent = `${job.mode === "edit" ? "AI編集" : "再生成"} · ${job.lineage.source.title}`;
      label.append(origin);
    }
    const state = document.createElement("span");
    state.className = "job-state";
    state.textContent =
      job.status === "done" ? (job.has_audio ? "FLAC" : "下書き") : job.stage;
    button.append(label, state);
    button.onclick = () => {
      selectedJob = job.id;
      renderJobs();
    };
    item.append(button);
    list.append(item);
    if (active === job.id) button.focus({ preventScroll: true });
  }
  renderCurrent(jobs.find((job) => job.id === selectedJob));
}

async function selectRelatedJob(id) {
  if (!jobs.some((job) => job.id === id))
    jobs.push(await api(`/api/jobs/${id}`));
  selectedJob = id;
  renderJobs();
}

function renderLineage(panel, lineage) {
  if (!lineage) return;
  const details = document.createElement("dl");
  details.className = "lineage";

  function row(label, value) {
    const term = document.createElement("dt");
    term.textContent = label;
    const content = document.createElement("dd");
    content.append(value);
    details.append(term, content);
  }

  function related(label, job) {
    const button = action(job.title, () => selectRelatedJob(job.id));
    button.className = "lineage-link";
    row(label, button);
  }

  if (lineage.source)
    related(
      lineage.source.mode === "edit" ? "元の下書き" : "元の曲",
      lineage.source,
    );
  if (lineage.parent && lineage.parent.id !== lineage.source?.id)
    related(
      lineage.parent.mode === "edit" ? "使った下書き" : "直前の曲",
      lineage.parent,
    );
  if (lineage.instruction) row("AI編集の指示", lineage.instruction);
  const labels = { style: "曲調", lyrics: "歌詞", abc: "楽譜" };
  if (lineage.changes?.length) {
    row("変更点", lineage.changes.map((key) => labels[key]).join("・"));
  }
  if (details.childElementCount) panel.append(details);
  if (lineage.style_after) {
    const comparison = document.createElement("details");
    comparison.className = "style-comparison";
    const summary = document.createElement("summary");
    summary.textContent = "曲調の変更前・変更後";
    comparison.append(summary);
    for (const [label, text] of [
      ["変更前", lineage.style_before],
      ["変更後", lineage.style_after],
    ]) {
      if (!text) continue;
      const line = document.createElement("p");
      const heading = document.createElement("strong");
      heading.textContent = label;
      line.append(heading, ` ${text}`);
      comparison.append(line);
    }
    panel.append(comparison);
  }
}

function relatedTitle(job, suffix) {
  return `${(job.lineage?.source?.title || job.title).slice(0, 70)}（${suffix}）`;
}

function renderCurrent(job) {
  const panel = byId("current");
  if (!job) {
    panel.hidden = true;
    return;
  }
  const signature = [job.id, job.status, job.stage, job.progress].join("|");
  if (visibleJob === signature) return;
  if (playerUrl) URL.revokeObjectURL(playerUrl);
  playerUrl = "";
  visibleJob = signature;
  panel.hidden = false;
  panel.replaceChildren();
  const title = document.createElement("h3");
  title.textContent = job.title;
  const stage = document.createElement("p");
  stage.textContent = job.error || job.stage;
  panel.append(title, stage);
  renderLineage(panel, job.lineage);
  if (job.status === "running" || job.status === "queued") {
    const progress = document.createElement("progress");
    progress.max = 100;
    progress.setAttribute("aria-label", "生成の進捗");
    if (Number.isFinite(job.progress)) progress.value = job.progress;
    panel.append(progress);
  }
  if (job.status !== "done") return;
  const actions = document.createElement("div");
  actions.className = "actions";
  const audio = document.createElement("audio");
  audio.controls = true;
  audio.hidden = true;
  if (job.has_audio) {
    const fetchAudio = () =>
      api(`/api/jobs/${job.id}/audio`, { blob: true, timeout: 120000 });
    actions.append(
      action("再生", async () => {
        if (!playerUrl) {
          const recording = await fetchAudio();
          if (selectedJob !== job.id || !token) return;
          playerUrl = URL.createObjectURL(recording);
        }
        if (!audio.src) audio.src = playerUrl;
        audio.hidden = false;
        await audio.play().catch(() => {});
      }),
    );
    actions.append(
      action("FLAC保存", async () =>
        download(await fetchAudio(), "shion.flac"),
      ),
    );
  }
  if (job.mode === "edit" && job.result?.style) {
    actions.append(
      action("この内容で再生成", () => {
        const { style, lyrics, abc } = job.result;
        return queueJob({
          mode: abc ? "abc" : lyrics ? "lyrics" : "prompt",
          title: relatedTitle(job, "編集後"),
          style,
          lyrics,
          abc,
          parent_id: job.id,
          instrumental: job.instrumental,
          seconds: job.seconds,
          seed: job.seed,
        });
      }),
    );
  }
  if (job.result?.abc)
    actions.append(action("楽譜を開く", () => openDraft(job, "abc")));
  if (job.mode === "edit" && !job.result?.abc)
    actions.append(
      action("下書きを使う", () => {
        openDraft(job, "create");
        setSource(job.result?.lyrics ? "lyrics" : "prompt");
        byId("style").focus({ preventScroll: true });
      }),
    );
  actions.append(action("AIで編集", () => openDraft(job, "edit")));
  panel.append(actions, audio);
}

async function queueJob(body) {
  const created = await api("/api/jobs", { body, timeout: 120000 });
  selectedJob = created.id;
  jobs = [created, ...jobs].slice(0, 24);
  renderJobs();
  if (matchMedia("(max-width: 820px)").matches)
    byId("current").scrollIntoView({ behavior: "smooth", block: "center" });
}

async function refresh() {
  if (!token || refreshing) return;
  const startedWith = token;
  refreshing = true;
  try {
    const result = await api("/api/jobs");
    if (token !== startedWith) return;
    const previous = jobs.find((job) => job.id === selectedJob);
    jobs = result.jobs;
    if (previous && !jobs.some((job) => job.id === previous.id))
      jobs.push(previous);
    if (!selectedJob && jobs.length) selectedJob = jobs[0].id;
    signIn();
    renderJobs();
  } finally {
    refreshing = false;
  }
}

byId("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = byId("login-submit");
  button.disabled = true;
  message("login-error", "");
  try {
    const result = await api("/api/session", {
      auth: false,
      body: { password: byId("password").value },
    });
    token = result.token;
    sessionStorage.setItem(sessionKey, token);
    byId("password").value = "";
    await refresh();
  } catch (error) {
    message("login-error", error.message);
  } finally {
    button.disabled = false;
  }
});

byId("logout").addEventListener("click", async () => {
  try {
    await api("/api/logout", { body: {} });
  } catch {
    /* Local logout also works while the PC is offline. */
  }
  signOut();
});
for (const button of tabs)
  button.addEventListener("click", () => setTab(button.dataset.tab));
for (const button of sources)
  button.addEventListener("click", () => setSource(button.dataset.source));
for (const button of tones)
  button.addEventListener("click", () =>
    setTone(button.dataset.tone === "instrumental"),
  );
byId("toggle-edit-source").addEventListener("click", () => {
  editSourceVisible = !editSourceVisible;
  syncFields();
});
byId("abc").addEventListener("input", drawNotation);
byId("apply-note").addEventListener("click", () => {
  const input = byId("abc");
  const token = byId("note-token").value.trim();
  if (!noteRange || input.value !== noteRange.abc || !token) return;
  const { start, end } = noteRange;
  const trailing = input.value.slice(start, end).match(/\s*$/)[0];
  input.setRangeText(token + trailing, start, end, "select");
  drawNotation();
});
byId("export-abc").addEventListener("click", () => {
  if (byId("abc").value.trim())
    download(
      new Blob([byId("abc").value], { type: "text/plain;charset=utf-8" }),
      "shion.abc",
    );
});
byId("source-audio").addEventListener("change", () => {
  byId("audio-label").textContent =
    byId("source-audio").files[0]?.name || "音源を選択";
});
byId("song-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = byId("submit-song");
  button.disabled = true;
  message("form-error", "");
  const mode = tab === "create" ? source : tab;
  const style = byId("style").value.trim();
  const instruction = byId("instruction").value.trim();
  const job = {
    mode,
    style,
    instruction,
    instrumental,
    title: draftParent
      ? relatedTitle(draftParent, mode === "edit" ? "AI編集" : "再生成")
      : (mode === "edit" ? instruction : style).slice(0, 36),
    parent_id: draftParent?.id || "",
    lyrics:
      mode === "edit" || !byId("lyrics-field").hidden
        ? byId("lyrics").value
        : "",
    chords: mode === "chords" ? byId("chords").value : "",
    abc: mode === "abc" || mode === "edit" ? byId("abc").value : "",
    seconds: Number(byId("seconds").value),
    bpm: mode === "chords" ? Number(byId("bpm").value) : 92,
  };
  try {
    let body = job;
    if (mode === "cover") {
      const file = byId("source-audio").files[0];
      if (!file) throw new Error("元の音源を選んでください。");
      if (file.size > 32 * 1024 * 1024)
        throw new Error("音源は32 MB以下にしてください。");
      body = new FormData();
      body.append("job", JSON.stringify(job));
      body.append("audio", file);
    }
    await queueJob(body);
  } catch (error) {
    message("form-error", error.message);
  } finally {
    button.disabled = false;
  }
});

syncFields();
if (token) refresh().catch((error) => message("login-error", error.message));
else
  api("/api/health", { auth: false, timeout: 8000 }).catch(() =>
    connection("offline"),
  );
setInterval(() => {
  if (token && !document.hidden) refresh().catch(() => {});
}, 5000);
document.addEventListener("visibilitychange", () => {
  if (token && !document.hidden) refresh().catch(() => {});
});
