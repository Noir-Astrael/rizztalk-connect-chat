// 38 provinsi Indonesia dengan kode resmi (BPS)
export const PROVINCES_ID = [
  { code: "AC", name: "Aceh" },
  { code: "BA", name: "Bali" },
  { code: "BB", name: "Bangka Belitung" },
  { code: "BT", name: "Banten" },
  { code: "BE", name: "Bengkulu" },
  { code: "YO", name: "DI Yogyakarta" },
  { code: "JK", name: "DKI Jakarta" },
  { code: "GO", name: "Gorontalo" },
  { code: "JA", name: "Jambi" },
  { code: "JB", name: "Jawa Barat" },
  { code: "JT", name: "Jawa Tengah" },
  { code: "JI", name: "Jawa Timur" },
  { code: "KB", name: "Kalimantan Barat" },
  { code: "KS", name: "Kalimantan Selatan" },
  { code: "KT", name: "Kalimantan Tengah" },
  { code: "KI", name: "Kalimantan Timur" },
  { code: "KU", name: "Kalimantan Utara" },
  { code: "KR", name: "Kepulauan Riau" },
  { code: "LA", name: "Lampung" },
  { code: "MA", name: "Maluku" },
  { code: "MU", name: "Maluku Utara" },
  { code: "NB", name: "Nusa Tenggara Barat" },
  { code: "NT", name: "Nusa Tenggara Timur" },
  { code: "PA", name: "Papua" },
  { code: "PB", name: "Papua Barat" },
  { code: "PD", name: "Papua Barat Daya" },
  { code: "PP", name: "Papua Pegunungan" },
  { code: "PS", name: "Papua Selatan" },
  { code: "PT", name: "Papua Tengah" },
  { code: "RI", name: "Riau" },
  { code: "SR", name: "Sulawesi Barat" },
  { code: "SN", name: "Sulawesi Selatan" },
  { code: "SG", name: "Sulawesi Tenggara" },
  { code: "ST", name: "Sulawesi Tengah" },
  { code: "SA", name: "Sulawesi Utara" },
  { code: "SB", name: "Sumatera Barat" },
  { code: "SS", name: "Sumatera Selatan" },
  { code: "SU", name: "Sumatera Utara" },
] as const;

export const PRESET_INTERESTS = [
  "Musik", "Game", "Film", "Anime", "Olahraga", "Sepak Bola", "Basket",
  "Coding", "Traveling", "Foodie", "Kuliner", "Fotografi", "Buku",
  "Otomotif", "Fashion", "Gym", "Kpop", "Jpop", "Drakor", "Meme",
  "Crypto", "Saham", "Politik", "Sains", "Sejarah", "Spiritual",
] as const;

export function findProvinceByText(input: string) {
  const q = input.trim().toLowerCase();
  if (!q) return null;
  // Try exact code (case-insensitive) or name match (substring)
  for (const p of PROVINCES_ID) {
    if (p.code.toLowerCase() === q) return p;
  }
  for (const p of PROVINCES_ID) {
    if (p.name.toLowerCase() === q) return p;
  }
  for (const p of PROVINCES_ID) {
    if (p.name.toLowerCase().includes(q) || q.includes(p.name.toLowerCase())) return p;
  }
  return null;
}
