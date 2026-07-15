const params = new URLSearchParams(window.location.search);
const demo = params.get("demo") === "1";

const state = {
  loading: true,
  analysis: null
};

loadAnalysis();

async function loadAnalysis() {
  try {
    const response = await fetch(`/api/analysis${demo ? "?demo=1" : ""}`);
    if (!response.ok) throw new Error("analysis request failed");
    state.analysis = await response.json();
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
