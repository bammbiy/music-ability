const params = new URLSearchParams(window.location.search);
const demo = params.get("demo") === "1";
const provider = params.get("provider") || "spotify";

const VU_CENTER = { x: 120, y: 128 };
const VU_SWEEP = 50;

const metricInfo = {
  diversity: { name: "장르 다양성", help: "여러 장르를 고르게 들을수록 높아요." },
  detailDepth: { name: "감상 깊이", help: "세부 장르와 여러 앨범을 들을수록 높아요." },
  discovery: { name: "발견 성향", help: "덜 알려진 아티스트를 많이 들을수록 높아요." },
  concentration: { name: "취향 확장성", help: "한 아티스트에 몰리지 않을수록 높아요." },
  newReleaseSense: { name: "신보 감도", help: "최근 6개월 안에 나온 음악을 들을수록 높아요." },
  criticTaste: { name: "평단 감각", help: "평론가, 음악상, 청취자 커뮤니티가 높게 평가한 앨범을 들을수록 높아요." },
  hiddenGems: { name: "숨은 명반 발굴", help: "평단 평가는 높은데 덜 알려진 앨범을 들을수록 높아요." },
  mainstream: { name: "대중성", help: "인기 있는 곡을 많이 들을수록 높아요." }
};

const state = { analysis: null, ratingsEnabled: false };

const POLL_INTERVAL_MS = 5000;
const POLL_LIMIT = 60;
let pollCount = 0;

const capColors = ["blue", "yellow", "green", "red", "white", "purple", "orange", "grey"];

drawVuScale();
loadAnalysis();
bindFeedback();
bindRatings();
bindMedia();
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
    if (provider === "apple") sessionStorage.removeItem("appleMusicUserToken");
    if (!response.ok) throw new Error("analysis request failed");
    render(await response.json(), { initial: true });
  } catch (error) {
    document.querySelector("#listener-label").textContent = "불러오지 못함";
    document.querySelector("#summary").textContent = "청취 기록을 불러오지 못했어요. 처음 화면에서 다시 로그인하거나 예시 결과를 열어 보세요.";
    console.error(error);
  }
}

async function pollAnalysis() {
  pollCount += 1;
  try {
    const response = await fetch("/api/analysis?cached=1");
    if (!response.ok) return;
    render(await response.json(), { initial: false });
  } catch (error) {
    console.error(error);
  }
}

function render(data, { initial }) {
  state.analysis = data;
  state.ratingsEnabled = state.ratingsEnabled || Boolean(data.ratingsEnabled);
  document.querySelector("#score").textContent = String(clampPercent(data.score));
  document.querySelector("#listener-label").textContent = data.metrics?.label || "";
  document.querySelector("#summary").textContent = data.summary || "";
  document.querySelector("#vu-needle").style.transform = `rotate(${-VU_SWEEP + clampPercent(data.score) * (VU_SWEEP * 2) / 100}deg)`;
  const valueArc = document.querySelector("#vu-value");
  if (valueArc) {
    const length = valueArc.getTotalLength();
    valueArc.style.strokeDasharray = `${(length * clampPercent(data.score)) / 100} ${length + 10}`;
  }

  renderPercentile(data.percentile);
  if (initial) renderChannels(data.buckets || []);
  renderKnobs(data.metrics || {}, data.weights || {}, data.acclaim);
  renderAcclaim(data.acclaim, data.source === "demo");
  renderRatings(data.listenedAlbums || [], data.source === "demo");

  const settling = ["collecting", "updating"].includes(data.acclaim?.status);
  if (settling && !demo && pollCount < POLL_LIMIT) setTimeout(pollAnalysis, POLL_INTERVAL_MS);
  renderTags(data.genres || []);
  renderTracks(data.topTracks || []);
  renderCritics(data.criticMatches || []);
}

function drawVuScale() {
  const group = document.querySelector("#vu-scale");
  if (!group) return;
  const point = (value, radius) => {
    const angle = ((-VU_SWEEP + value * (VU_SWEEP * 2) / 100) * Math.PI) / 180;
    return { x: VU_CENTER.x + radius * Math.sin(angle), y: VU_CENTER.y - radius * Math.cos(angle) };
  };
  const arc = (from, to, radius) => {
    const a = point(from, radius);
    const b = point(to, radius);
    return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} A ${radius} ${radius} 0 0 1 ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  };

  let markup = `<path class="vu-arc" d="${arc(0, 100, 72)}"></path><path id="vu-value" class="vu-arc-value" d="${arc(0, 100, 72)}"></path><path class="vu-arc-hot" d="${arc(80, 100, 92)}"></path>`;
  for (let value = 0; value <= 100; value += 5) {
    const major = value % 20 === 0;
    const inner = point(value, major ? 82 : 86);
    const outer = point(value, 92);
    markup += `<line class="vu-tick${value >= 80 ? " is-hot" : ""}" x1="${inner.x.toFixed(1)}" y1="${inner.y.toFixed(1)}" x2="${outer.x.toFixed(1)}" y2="${outer.y.toFixed(1)}"></line>`;
    if (major) {
      const label = point(value, 106);
      markup += `<text class="vu-num" x="${label.x.toFixed(1)}" y="${(label.y + 4).toFixed(1)}">${value}</text>`;
    }
  }
  group.innerHTML = markup;
}

function renderChannels(buckets) {
  const mixer = document.querySelector("#buckets");
  const max = Math.max(1, ...buckets.map((bucket) => clampPercent(bucket.percent)));
  mixer.classList.add("is-off");
  mixer.innerHTML = buckets
    .map((bucket, index) => {
      const percent = clampPercent(bucket.percent);
      const level = Math.round((percent / max) * 90);
      return `
        <div class="strip" style="--level: ${level}; --cap: var(--cap-${capColors[index % capColors.length]})">
          <span class="strip-name">${escapeHtml(bucket.name)}</span>
          <div class="fader" role="img" aria-label="${escapeHtml(bucket.name)} ${percent}%"><span class="fader-cap"></span></div>
          <span class="strip-value">${percent}%</span>
        </div>
      `;
    })
    .join("");
  requestAnimationFrame(() => requestAnimationFrame(() => mixer.classList.remove("is-off")));
}

function renderPercentile(percentile) {
  const element = document.querySelector("#percentile");
  if (!Number.isFinite(percentile)) {
    element.hidden = true;
    return;
  }
  element.hidden = false;
  element.textContent = `분석한 사람 중 상위 ${Math.max(1, 100 - clampPercent(percentile))}%`;
}

function renderKnobs(metrics, weights, acclaim) {
  const waiting = {
    collecting: "평론 점수를 모으는 중이에요.",
    unreachable: "평론 데이터에 연결하지 못했어요.",
    unavailable: "평론 점수 수집이 꺼져 있어요."
  }[acclaim?.status] || "평론 점수가 있는 앨범이 부족해요.";
  document.querySelector("#metrics").innerHTML = Object.entries(metricInfo)
    .filter(([key]) => key in metrics)
    .map(([key, info]) => {
      const ready = Number.isFinite(metrics[key]);
      const value = ready ? clampPercent(metrics[key]) : 0;
      const weight = weights[key];
      const weightText = key === "mainstream" ? "점수에 반영 안 함" : Number.isFinite(weight) ? `점수에 ${weight}% 반영` : "아직 반영 안 함";
      return `
        <div class="knob-cell${ready ? "" : " is-empty"}">
          <div class="knob" style="--v: ${value}" role="img" aria-label="${escapeHtml(info.name)} ${ready ? value : "데이터 없음"}"></div>
          <span class="knob-value">${ready ? value : "–"}</span>
          <span class="knob-name">${escapeHtml(info.name)}</span>
          <span class="knob-help">${escapeHtml(ready ? info.help : waiting)}</span>
          <span class="knob-weight">${escapeHtml(weightText)}</span>
        </div>
      `;
    })
    .join("");
}

const CREDIBILITY_LABEL = { high: "높음", medium: "보통", low: "낮음", none: "없음" };
const BASIS_LABEL = { critic: "평론 기준", audience: "청취자 평점 기준", members: "Music Ability 사용자 평가 기준", awards: "수상 기준" };

function renderAcclaim(acclaim, isSample) {
  const note = document.querySelector("#acclaim-note");
  const trust = document.querySelector("#acclaim-trust");
  const list = document.querySelector("#acclaim-albums");
  if (!acclaim) return;

  const found = `자주 듣는 앨범 ${acclaim.albumsTotal}장 중 ${acclaim.albumsWithData}장의 평가를 찾았어요.`;
  const notes = {
    ready: found,
    updating: `${found} 나머지 ${acclaim.pending}장은 모으는 중이고, 화면은 자동으로 갱신돼요.`,
    collecting: `앨범 ${acclaim.pending}장의 평가를 모으고 있어요. 공개 API마다 요청 간격 제한이 있어서 앨범 하나에 몇 초씩 걸려요. 화면은 자동으로 갱신돼요.`,
    unreachable: "평가 데이터 사이트(MusicBrainz, Wikidata)에 연결하지 못해서 평단 지표는 점수에서 뺐어요. 한 시간 뒤에 다시 시도해요.",
    insufficient: `믿을 만한 평가가 있는 앨범이 부족해서(${acclaim.albumsTotal}장 중 ${acclaim.reliableAlbums ?? 0}장) 평단 지표는 점수에서 뺐어요.`,
    unavailable: "평가 수집이 꺼져 있어요. 서버 설정에서 ACCLAIM_ENABLED를 확인해 주세요."
  };
  note.textContent = isSample
    ? "예시 데이터예요. 실제 평론지의 점수가 아니라 화면 구성을 보여 주기 위한 값이에요."
    : notes[acclaim.status] || "";

  const evidence = acclaim.evidence || {};
  const parts = [
    evidence.criticReviews ? `평론 ${evidence.criticReviews}건` : "",
    evidence.awards ? `수상 ${evidence.awards}건` : "",
    evidence.nominations ? `후보 ${evidence.nominations}건` : "",
    evidence.votes ? `청취자 투표 ${evidence.votes.toLocaleString("ko-KR")}표` : ""
  ].filter(Boolean);
  trust.hidden = !acclaim.albumsWithData;
  trust.className = `trust is-${escapeHtml(acclaim.credibility || "none")}`;
  trust.innerHTML = `
    <strong>신뢰도 ${CREDIBILITY_LABEL[acclaim.credibility] || "없음"}</strong>
    <span>${parts.length ? `근거: ${parts.join(", ")}` : "근거가 아직 없어요"}. 근거가 적을수록 평단 지표가 점수에 덜 반영돼요.</span>
  `;

  list.innerHTML = (acclaim.albums || [])
    .map((album) => {
      const critics = album.critics || [];
      const criticText = critics.length
        ? `평론 ${critics.slice(0, 5).map((review) => `${escapeHtml(review.label)} ${escapeHtml(review.raw)}`).join(", ")}${critics.length > 5 ? ` 외 ${critics.length - 5}곳` : ""}`
        : "";
      const recognition = [
        album.awards?.length ? `수상: ${album.awards.slice(0, 2).map(escapeHtml).join(", ")}` : "",
        album.nominations?.length ? `후보: ${album.nominations.slice(0, 2).map(escapeHtml).join(", ")}` : ""
      ].filter(Boolean).join(" / ");
      const facts = [
        album.audienceVotes ? `청취자 평점 ${Math.round(album.audienceScore)} (${album.audienceVotes}표)` : "",
        album.communityVotes ? `사용자 평균 ${album.communityAverage}/10 (${album.communityVotes}명)` : "",
        album.sitelinks ? `위키백과 ${album.sitelinks}개 언어` : "",
        Number.isFinite(album.popularity) ? `대중성 ${clampPercent(album.popularity)}` : "",
        album.releaseDate ? `${escapeHtml(String(album.releaseDate).slice(0, 4))}년` : ""
      ].filter(Boolean).join(", ");
      const confidence = Number.isFinite(album.confidence) ? Math.round(album.confidence * 100) : null;
      const wikiUrl = album.wikipedia && critics.some((review) => review.via === "wikipedia")
        ? safeHttpUrl(`https://en.wikipedia.org/wiki/${encodeURIComponent(album.wikipedia.replace(/ /g, "_"))}`)
        : "";
      return `
        <li>
          <span class="album-score is-${escapeHtml(album.qualityBasis || "audience")}" aria-label="평가 ${Math.round(album.qualityScore)}점, ${escapeHtml(BASIS_LABEL[album.qualityBasis] || "")}">${Math.round(album.qualityScore)}</span>
          <div>
            <strong>${escapeHtml(album.album)}${album.gem ? ' <em class="gem">숨은 명반</em>' : ""}</strong>
            <small>${escapeHtml(album.artist)}${facts ? `, ${facts}` : ""}</small>
            ${criticText ? `<small class="album-critics">${criticText}</small>` : ""}
            ${recognition ? `<small class="album-critics">${recognition}</small>` : ""}
            <small class="album-meta">${escapeHtml(BASIS_LABEL[album.qualityBasis] || "")}${confidence !== null ? `, 근거 신뢰도 ${confidence}%` : ""}${wikiUrl ? `, <a href="${escapeHtml(wikiUrl)}" target="_blank" rel="noopener noreferrer">위키백과 평가표</a>` : ""}</small>
          </div>
        </li>
      `;
    })
    .join("");
}

function renderRatings(albums, isSample) {
  const note = document.querySelector("#rate-note");
  const list = document.querySelector("#rate-albums");
  const enabled = state.ratingsEnabled && !isSample;

  if (isSample) {
    note.textContent = "예시 결과에서는 평가할 수 없어요. 로그인해서 내 청취 기록을 분석하면 평가할 수 있어요.";
  } else if (!enabled) {
    note.textContent = "아래 '분석 개선에 참여하기'에서 참여하면 평가할 수 있어요. 내 평가는 다른 사람의 분석에 근거로 쓰이고, 내 점수에는 반영되지 않아요.";
  } else {
    note.textContent = "10점 만점으로 평가해 주세요. 내 평가는 다른 사람의 분석에 근거로 쓰이고, 내 점수에는 반영되지 않아요. 언제든 바꾸거나 지울 수 있어요.";
  }

  const options = (selected) => [
    `<option value="">평가 안 함</option>`,
    ...Array.from({ length: 10 }, (_, index) => 10 - index).map((value) => `<option value="${value}"${selected === value ? " selected" : ""}>${value}점</option>`)
  ].join("");

  list.innerHTML = albums
    .map((album, index) => `
      <li>
        <div>
          <strong>${escapeHtml(album.album)}</strong>
          <small>${escapeHtml(album.artist)}${album.communityVotes ? `, 사용자 평균 ${escapeHtml(album.communityAverage)}/10 (${album.communityVotes}명)` : ""}</small>
        </div>
        <label class="sr-only" for="rate-${index}">${escapeHtml(album.album)} 평가</label>
        <select id="rate-${index}" data-key="${escapeHtml(album.key)}"${enabled ? "" : " disabled"}>${options(album.myRating)}</select>
        <small class="rate-status" role="status"></small>
      </li>
    `)
    .join("");
}

function bindRatings() {
  const list = document.querySelector("#rate-albums");
  if (!list) return;
  list.addEventListener("change", async (event) => {
    const select = event.target.closest("select[data-key]");
    if (!select) return;
    const status = select.parentElement.querySelector(".rate-status");
    const rating = select.value ? Number(select.value) : null;
    select.disabled = true;
    try {
      const response = await fetch("/api/ratings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: select.dataset.key, rating })
      });
      if (response.ok) {
        status.textContent = rating ? "저장했어요." : "평가를 지웠어요.";
      } else if (response.status === 403) {
        status.textContent = "먼저 '분석 개선에 참여하기'를 눌러 주세요.";
      } else if (response.status === 409) {
        status.textContent = "분석이 만료됐어요. 페이지를 새로고침한 뒤 다시 평가해 주세요.";
      } else {
        status.textContent = "저장하지 못했어요. 잠시 뒤 다시 골라 주세요.";
      }
    } catch {
      status.textContent = "저장하지 못했어요. 잠시 뒤 다시 골라 주세요.";
    } finally {
      select.disabled = false;
    }
  });
}

function renderTags(genres) {
  document.querySelector("#genres").innerHTML = genres
    .map((genre) => `<span class="tape">${escapeHtml(genre.name)}<small>${clampPercent(genre.percent)}%</small></span>`)
    .join("");
}

function renderTracks(tracks) {
  document.querySelector("#tracks").innerHTML = tracks.length
    ? tracks
        .map((track, index) => `
          <li>
            <span class="cue-num">${index + 1}</span>
            <div>
              <strong>${escapeHtml(track.name)}</strong>
              <small>${escapeHtml(track.artist || "아티스트 정보 없음")}</small>
            </div>
          </li>
        `)
        .join("")
    : "<li class=\"empty\">아직 자주 들은 트랙이 없어요.</li>";
}

function renderCritics(critics) {
  document.querySelector("#critics").innerHTML = critics
    .map((critic) => {
      const match = clampPercent(critic.match);
      return `
        <li>
          <span class="match-level" role="img" aria-label="일치도 ${match}%"><span style="--v: ${match}"></span></span>
          <div>
            <strong>${escapeHtml(critic.name)} <small>일치도 ${match}%</small></strong>
            <small>${escapeHtml(critic.note)}</small>
          </div>
        </li>
      `;
    })
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
      status.textContent = "Spotify나 Apple Music으로 로그인한 뒤에 참여할 수 있어요.";
      return;
    }
    consentButton.textContent = "참여 중";
    consentButton.disabled = true;
    state.ratingsEnabled = true;
    if (state.analysis) renderRatings(state.analysis.listenedAlbums || [], state.analysis.source === "demo");
    status.textContent = "참여했어요. 다음 분석부터 점수와 장르 비중이 익명으로 저장돼요.";
  });

  feedbackForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const rating = Number(new FormData(feedbackForm).get("rating"));
    const response = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetType: "analysis", targetId: "analysis-v1", rating })
    });
    status.textContent = response.ok ? "평가를 보냈어요." : "평가를 보내려면 먼저 참여하기를 눌러 주세요.";
  });
}

function bindMedia() {
  const form = document.querySelector("#media-form");
  const input = document.querySelector("#media-query");
  if (!form || !input) return;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    loadMedia(input.value.trim() || "new music");
  });
}

async function loadMedia(query) {
  const container = document.querySelector("#media-items");
  if (!container) return;

  container.innerHTML = "<p class=\"empty\">소식을 찾고 있어요.</p>";
  const response = await fetch(`/api/media?q=${encodeURIComponent(query)}`);
  if (!response.ok) {
    container.innerHTML = response.status === 429
      ? "<p class=\"empty\">검색을 너무 자주 했어요. 1분 뒤에 다시 찾아 주세요.</p>"
      : "<p class=\"empty\">소식을 불러오지 못했어요. 잠시 뒤 다시 찾아 주세요.</p>";
    return;
  }
  const data = await response.json();
  const items = data.items.filter((item) => safeHttpUrl(item.url));
  if (items.length === 0) {
    const configured = Object.values(data.configured || {}).some(Boolean);
    container.innerHTML = configured
      ? "<p class=\"empty\">검색 결과가 없어요. 다른 아티스트나 곡 이름으로 찾아 보세요.</p>"
      : "<p class=\"empty\">연결된 소식 출처가 아직 없어요. 서버에 YouTube API 키나 RSS 주소를 설정하면 여기에 보여요.</p>";
    return;
  }
  const typeLabel = { video: "영상", social: "소셜", article: "기사" };
  container.innerHTML = items.map((item) => `
    <a class="media-item" href="${escapeHtml(safeHttpUrl(item.url))}" target="_blank" rel="noopener noreferrer">
      ${safeHttpUrl(item.image) ? `<img src="${escapeHtml(safeHttpUrl(item.image))}" alt="">` : ""}
      <small>${escapeHtml(item.source)}, ${typeLabel[item.type] || "기사"}</small>
      <strong>${escapeHtml(item.title)}</strong>
      ${item.description ? `<p>${escapeHtml(item.description)}</p>` : ""}
    </a>
  `).join("");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  }[character]));
}

function clampPercent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : 0;
}

function safeHttpUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(String(value || ""), window.location.origin);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch {
    return "";
  }
}
