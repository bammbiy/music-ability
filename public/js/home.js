const params = new URLSearchParams(window.location.search);

setupProviders();

if (params.get("missingSpotify") === "1") {
  const notice = document.createElement("p");
  notice.className = "notice";
  notice.textContent = "아직 Spotify 키가 없어서 데모 화면으로 이동할 수 있어요. .env 설정 후 실제 로그인이 열립니다.";
  document.querySelector(".hero-copy")?.append(notice);
}

async function setupProviders() {
  const appleButton = document.querySelector("#apple-login");
  const youtubeButton = document.querySelector("#youtube-login");
  const notice = document.querySelector("#provider-notice");
  if (!appleButton || !youtubeButton || !notice) return;

  youtubeButton.addEventListener("click", () => {
    notice.hidden = false;
    notice.textContent = "YouTube Music은 공식 청취 기록 API가 없어 현재는 로그인 연동을 열지 않았어요. 플레이리스트/파일 가져오기를 준비 중입니다.";
  });

  const response = await fetch("/api/status");
  const status = await response.json();
  if (!status.appleConfigured || !window.MusicKit) {
    appleButton.addEventListener("click", () => {
      notice.hidden = false;
      notice.textContent = "Apple Music 연동을 사용하려면 서버에 Apple MusicKit 개발자 토큰을 설정해야 해요.";
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
      notice.textContent = "Apple Music 로그인을 완료하지 못했어요.";
      console.error(error);
    }
  });
}
