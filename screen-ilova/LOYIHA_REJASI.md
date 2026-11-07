# 📱🖥️📺 Screen Share & Mirroring Ilovasi — Loyiha Rejasi (Specification)

## 1. Loyihaning Asosiy Maqsadi
Barcha qurilmalar o‘rtasida ikki tomonlama (Peer-to-Peer) ekranni uzatish va ko‘rish imkonini beruvchi ilova:
* **Telefon ⇄ Kompyuter**
* **Kompyuter ⇄ Kompyuter**
* **Televizor (Smart / Android TV) ⇄ Kompyuter / Telefon**

Ilova har bir qurilmaga o‘rnatiladigan **to‘liq dastur (App)** ko‘rinishida bo‘ladi:
* Windows uchun: `.exe`
* Android telefonlar uchun: `.apk`
* Android TV uchun: `.apk` (TV moslashuvi bilan)

---

## 2. Aloqa va Ulanish Kanallari (Transport)

### 2.1. Standart (Bepul) Kanal
* **Lokal Tarmoq (Wi-Fi va LAN kabel):**
  * Uy yoki ofisdagi umumiy router orqali ulanadi.
  * Tashqi internet talab qilinmaydi (offline rejimda ishlaydi).
  * Video oqimi to‘g‘ridan-to‘g‘ri qurilmadan qurilmaga (P2P) yuqori tezlikda o‘tadi.
  * Tarmoqdagi qurilmalarni avtomatik qidirib topish (mDNS / UDP Broadcast).

### 2.2. Pro / Maxsus rejimlar (Faqat kod orqali ochiladigan)
* **Wi-Fi Hotspot (Avto-ulanish):**
  * Router yo‘q joylarda (yo‘lda, dalada) qurilmaning o‘zi Wi-Fi tarqatadi va ikkinchi qurilma unga to‘g‘ridan-to‘g‘ri ulanadi.
* **Bluetooth yordamida ulanish:**
  * Parol kiritmasdan tezda juftlash (Fast Pairing) yoki pult/boshqaruv buyruqlarini uzatish.

---

## 3. Tariflar va Cheklovlar Tizimi (Monetizatsiya va Xavfsizlik)

| Xususiyat | Standart (Bepul) | Pro Versiya (Kod kiritilganda) |
| :--- | :--- | :--- |
| **Ulanish kanali** | Faqat umumiy Wi-Fi / LAN | Wi-Fi + LAN + **Hotspot + Bluetooth** |
| **Seans vaqti** | Limitli (masalan: 10–15 daqiqa) | **Cheksiz (24/7)** |
| **Video sifati** | 720p / 30 FPS | **1080p / 4K / 60 FPS** |
| **Qurilmalar soni** | Bir vaqtda faqat 1 ta ulanish | Ko‘p ekranli ulanish (Multi-screen) |
| **Suv belgisi** | Kichik logotip/nom ko‘rinadi | Suv belgisiz (Toza ekran) |

### 3.1. Maxsus Kod / Litsenziya Tizimi
* Ilova ichida **"Pro kodni kiritish"** bo‘limi mavjud bo‘ladi.
* Siz o‘zingiz belgilagan **Master Kod** kiritilganda barcha cheklovlar bir zumda olinadi.
* Kelajakda boshqa foydalanuvchilar uchun alohida litsenziya kalitlari generatsiya qilish mumkin bo‘ladi.

---

## 4. Texnik Arxitektura (Bosqichlar)

```
[1. Ekranni ushlash] ──► [2. Siqish (H.264)] ──► [3. Tarmoq (WebRTC/UDP)] ──► [4. Dekodlash] ──► [5. Ko'rsatish]
  (Capture API)          (Hardware Encoder)        (Wi-Fi / Hotspot)           (GPU Decoder)       (Ekranga chizish)
```

1. **Ekranni tasvirga olish (Capture):**
   * Windows: `Desktop Duplication API` (DirectX/DXGI)
   * Android / Android TV: `MediaProjection API`
2. **Video siqish (Encoding):**
   * Apparat tezlatgichli H.264 / HEVC (GPU orqali, qotmaslik uchun).
3. **Uzatish (Streaming):**
   * Past kechikishli (Low Latency) WebRTC yoki to‘g‘ridan-to‘g‘ri UDP soketlar.
4. **Boshqaruv (Remote Input):**
   * Sichqoncha, klaviatura va sensorli teginishlarni (touch) teskari yo‘nalishda uzatish.

---

## 5. Keyingi Qadamlar
1. Dasturlash muhitini (Framework/Stack) aniq tanlash (tavsiya: **Flutter** — barcha platformalar uchun umumiy bitta kod).
2. Lokal tarmoqda qurilmalarni avtomatik topuvchi va ulovchi modulni sinash.
3. Ekranni uzatuvchi minimal prototipni ishga tushirish.
4. Vaqt limiti va Pro-kod tekshiruv modulini qo‘shish.
