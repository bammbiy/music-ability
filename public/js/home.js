const params = new URLSearchParams(window.location.search);

if (params.get("missingSpotify") === "1") {
  const notice = document.createElement("p");
  notice.className = "notice";
  notice.textContent = "아직 Spotify 키가 없어서 데모 화면으로 이동할 수 있어요. .env 설정 후 실제 로그인이 열립니다.";
  document.querySelector(".hero-copy")?.append(notice);
}
