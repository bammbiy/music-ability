const params = new URLSearchParams(window.location.search);

setupProviders();
powerOnPreview();

if (params.get("missingSpotify") === "1") {
  const notice = document.createElement("p");
  notice.className = "notice";
  notice.textContent = "서버에 Spotify 앱 키가 아직 없어요. .env에 키를 넣기 전까지는 예시 결과로 둘러볼 수 있어요.";
  document.querySelector(".landing-copy")?.append(notice);
}

async function setupProviders() {
  const appleButton = document.querySelector("#apple-login");
  const youtubeButton = document.querySelector("#youtube-login");
  const notice = document.querySelector("#provider-notice");
  if (!appleButton || !youtubeButton || !notice) return;

  youtubeButton.addEventListener("click", () => {
    notice.hidden = false;
    notice.textContent = "YouTube Music은 청취 기록을 가져오는 공식 API가 없어서 아직 연결할 수 없어요. 플레이리스트와 내보내기 파일로 분석하는 기능을 준비하고 있어요.";
  });

  const response = await fetch("/api/status");
  const status = await response.json();
  if (!status.appleConfigured || !window.MusicKit) {
    appleButton.addEventListener("click", () => {
      notice.hidden = false;
      notice.textContent = "Apple Music으로 분석하려면 서버에 MusicKit 개발자 토큰을 설정해야 해요.";
    });
    return;
  }

  await window.MusicKit.configure({ developerToken: status.appleDeveloperToken });
  const music = window.MusicKit.getInstance();
  appleButton.addEventListener("click", async () => {
    try {
      const musicUserToken = await music.authorize();
      sessionStorage.setItem("appleMusicUserToken", musicUserToken);
      window.location.href = "/dashboard.html?provider=apple";
    } catch (error) {
      notice.hidden = false;
      notice.textContent = "Apple Music 로그인이 끝나지 않았어요. 다시 눌러서 로그인을 완료해 주세요.";
      console.error(error);
    }
  });
}

function powerOnPreview() {
  const mixer = document.querySelector("#preview-mixer");
  if (!mixer) return;
  mixer.classList.add("is-off");
  requestAnimationFrame(() => requestAnimationFrame(() => mixer.classList.remove("is-off")));
}
