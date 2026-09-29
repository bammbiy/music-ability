// Example dataset for demo mode. Album acclaim values for these albums live in
// acclaim/sample-albums.json and are clearly marked as sample data in the UI.

export const demoDataset = {
  source: "demo",
  provider: "demo",
  // Fixed so the new-release metric has something to show in the example.
  generatedAt: "2023-03-01T00:00:00.000Z",
  artists: [
    { id: "newjeans", name: "NewJeans", genres: ["k-pop", "k-pop girl group"], popularity: 86 },
    { id: "fujii", name: "Fujii Kaze", genres: ["j-pop", "japanese r&b"], popularity: 74 },
    { id: "pinkpantheress", name: "PinkPantheress", genres: ["bedroom pop", "drum and bass", "uk pop"], popularity: 78 },
    { id: "wave", name: "wave to earth", genres: ["korean indie", "korean city pop"], popularity: 69 },
    { id: "kendrick", name: "Kendrick Lamar", genres: ["hip hop", "rap"], popularity: 91 }
  ],
  tracks: [
    { name: "Ditto", album: "OMG", releaseDate: "2023-01-02", popularity: 83, image: null, artists: [{ name: "NewJeans", genres: ["k-pop", "k-pop girl group"] }] },
    { name: "Matsuri", album: "LOVE ALL SERVE ALL", releaseDate: "2022-03-23", popularity: 72, image: null, artists: [{ name: "Fujii Kaze", genres: ["j-pop", "japanese r&b"] }] },
    { name: "Pain", album: "to hell with it", releaseDate: "2021-10-15", popularity: 75, image: null, artists: [{ name: "PinkPantheress", genres: ["bedroom pop", "drum and bass", "uk pop"] }] },
    { name: "bad", album: "", releaseDate: "", popularity: 68, image: null, artists: [{ name: "wave to earth", genres: ["korean indie", "korean city pop"] }] },
    { name: "N95", album: "Mr. Morale & the Big Steppers", releaseDate: "2022-05-13", popularity: 82, image: null, artists: [{ name: "Kendrick Lamar", genres: ["hip hop", "rap"] }] }
  ],
  recentTracks: []
};
