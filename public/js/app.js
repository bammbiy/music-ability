const params = new URLSearchParams(window.location.search);
const demo = params.get("demo") === "1";
const provider = params.get("provider") || "spotify";

const state = {
  loading: true,
  analysis: null
};

loadAnalysis();
bindFeedback();
loadMedia("new music");

async function loadAnalysis() {
  try {
    const response = provider === "apple" && !demo
      ? await fetch("/api/apple/analysis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ musicUserToken: sessionStorage.getItem("appleMusicUserToken") })
        })
      : await fetch(`/api/analysis${demo ? "?demo=1" : ""}`);
    if (!response.ok) throw new Error("analysis request failed");
    state.analysis = await response.json();
    if (provider === "apple") sessionStorage.removeItem("appleMusicUserToken");
    render();
  } catch (error) {
    document.querySelector("#summary").textContent = "분석을 불러오지 못했습니다. Spotify 로그인 또는 데모 모드를 다시 시도해 주세요.";
    console.error(error);
  } finally {
    state.loading = false;
  }
}

function render() {
  const data = state.analysis;
  document.querySelector("#score").textContent = data.score;
  document.querySelector("#summary").textContent = data.summary;

  renderMetrics(data.metrics);
  renderBars("#buckets", data.buckets);
  renderChips("#genres", data.genres);
  renderTracks(data.topTracks);
  renderCritics(data.criticMatches);
}

function renderMetrics(metrics) {
  const labels = {
    diversity: "장르 다양성",
    detailDepth: "감상 깊이",
    discovery: "발견 성향",
    concentration: "취향 확장성",
    mainstream: "대중성"
  };

  document.querySelector("#metrics").innerHTML = Object.entries(metrics)
    .map(([key, value]) => `
      <div class="metric">
        <div><span>${labels[key]}</span><strong>${value}</strong></div>
        <meter min="0" max="100" value="${value}"></meter>
      </div>
    `)
    .join("");
}

function renderBars(selector, items) {
  document.querySelector(selector).innerHTML = items
    .map((item) => `
      <div class="bar-row">
        <div class="bar-label"><strong>${item.name}</strong><span>${item.percent}%</span></div>
        <div class="bar-track"><span style="width:${item.percent}%"></span></div>
      </div>
    `)
    .join("");
}

function renderChips(selector, items) {
  document.querySelector(selector).innerHTML = items
    .map((item) => `<span class="chip">${item.name} <strong>${item.percent}%</strong></span>`)
    .join("");
}

function renderTracks(tracks) {
  document.querySelector("#tracks").innerHTML = tracks
    .map((track, index) => `
      <div class="rank-item">
        <span>${index + 1}</span>
        <div>
          <strong>${track.name}</strong>
          <small>${track.artist || "Unknown artist"}</small>
        </div>
      </div>
    `)
    .join("");
}

function renderCritics(critics) {
  document.querySelector("#critics").innerHTML = critics
    .map((critic) => `
      <div class="rank-item">
        <span>${critic.match}</span>
        <div>
          <strong>${critic.name}</strong>
          <small>${critic.note}</small>
        </div>
      </div>
    `)
    .join("");
}

function bindFeedback() {
  const consentButton = document.querySelector("#consent-button");
  const feedbackForm = document.querySelector("#feedback-form");
  const status = document.querySelector("#feedback-status");
  if (!consentButton || !feedbackForm || !status) return;

  consentButton.addEventListener("click", async () => {
    const response = await fetch("/api/consent", { method: "POST" });
    if (!response.ok) {
      status.textContent = "Spotify 로그인 후 참여할 수 있어.";
      return;
    }
    consentButton.textContent = "참여 중 · 분석 저장 허용됨";
    status.textContent = "고마워. 다음 분석부터 익명화된 결과가 품질 개선에 사용돼.";
  });

  feedbackForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const rating = Number(new FormData(feedbackForm).get("rating"));
    const response = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetType: "analysis", targetId: "analysis-v1", rating })
    });
    status.textContent = response.ok ? "평가가 저장됐어. 다음 계산을 더 정확하게 만드는 데 반영할게." : "품질 개선 참여를 먼저 눌러줘.";
  });
}

async function loadMedia(query) {
  const container = document.querySelector("#media-items");
  const input = document.querySelector("#media-query");
  const button = document.querySelector("#media-search-button");
  if (!container || !input || !button) return;

  if (!button.dataset.bound) {
    button.dataset.bound = "1";
    button.addEventListener("click", () => loadMedia(input.value.trim() || "new music"));
  }
  container.innerHTML = "<p class=\"muted\">정보를 불러오는 중이야.</p>";
  const response = await fetch(`/api/media?q=${encodeURIComponent(query)}`);
  if (!response.ok) {
    container.innerHTML = "<p class=\"muted\">정보 피드를 불러오지 못했어.</p>";
    return;
  }
  const data = await response.json();
  if (data.items.length === 0) {
    container.innerHTML = "<p class=\"muted\">연결된 정보 소스가 아직 없어. API 키나 RSS 주소를 설정하면 여기에 표시돼.</p>";
    return;
  }
  container.innerHTML = data.items.map((item) => `
    <a class="media-item" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">
      ${item.image ? `<img src="${escapeHtml(item.image)}" alt="">` : ""}
      <div><small>${escapeHtml(item.source)} · ${item.type === "video" ? "영상" : item.type === "social" ? "소셜" : "기사"}</small><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.description || "")}</p></div>
    </a>
  `).join("");
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  }[character]));
}
