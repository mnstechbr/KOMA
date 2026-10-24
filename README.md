# KOMA

**English** · [Português](README.pt-BR.md)

**Pick a series. KOMA does the rest.** KOMA is a personal desktop library for manga, manhwa and manhua. Add a series and it finds the chapters, downloads the pages, reads the text in the speech balloons, translates it and gives you pages ready to read in your language.

Runs on Linux (x86_64) and Windows 11. Personal project, free software, no account and no server.

## What it does

- **Library:** search by title, with cover, synopsis and alternative names. It tracks favorites, "continue reading", new chapters and progress per chapter. When you add a series you can pick which chapters to download and tell KOMA where you stopped reading: it prepares from there to the latest chapter first, then goes back to the start, and marks the earlier chapters as read.
- **Sources:** MangaDex, the official WEBTOON (free episodes) and the original publisher when it has public pages (Naver Webtoon). Shonen Jump+ is used only as a chapter index, since its pages are protected. **KOMA ships with no unofficial source.** You can add your own sites in **Settings → Sources** (sites built with the Madara WordPress theme, by pasting the link to a title), at your own responsibility.
- **Fast collection:** pages are downloaded several at a time, and the daily check for new chapters stops at the first chapter it already knows.
- **Local OCR:** balloon detection, free-text detection and PP-OCRv5 recognition for Latin script and Korean, on your computer (CPU or, in the Maximum profile, the graphics card).
- **Translated pages:** the original text is erased (with the comic-text-detector and LaMa models) and the translation is drawn inside the balloon. The original page is one click away.
- **Performance:** in **Settings → Performance**, KOMA picks a profile for your computer (Light, Balanced or Maximum). It only uses the graphics card when the card is faster than the processor and gives the same result. You can cap usage at 100%, 75% or 50% and let KOMA slow down when the computer gets hot. On Linux with an NVIDIA card, an optional CUDA add-on (a separate download, not in the installer) speeds up drawing in the Maximum profile.
- **Reader:** continuous scrolling, auto-scroll with 15 speeds (space bar pauses), middle-click scrolling, "Redo this chapter", a **balloon editor** (click a balloon, fix the text, only that page is redrawn, and the fix goes into the series glossary) and **Report error** (see below).
- **Background:** closing the window keeps KOMA in the system tray. It can start with the computer, checks for new chapters every day at the time you choose, and shows a notification that opens the new chapter in the reader.
- **Read on your phone (optional):** over your home Wi-Fi, with a QR code and an access code. The phone only reads and marks chapters as read; nothing is exposed to the internet.
- **AniList (optional):** when you mark a chapter as read, your AniList progress goes up, through AniList's official authorization.
- **Languages:** interface in Portuguese, English or Spanish. Each series can be translated into Brazilian Portuguese, English, Spanish, French, German or Italian.
- **External device (optional):** keep older chapters on an HDD, SSD, USB drive, memory card or network folder. In **Settings → Storage → External device**, pick the device from the list. Each chapter becomes a `.cbz` file on it (opens in any comic reader), checked byte by byte before it leaves the computer. Only the newest chapters of each series and the next ones after where you stopped stay on the computer (3 + 3 by default, adjustable). With the device connected, an old chapter opens in seconds; without it, KOMA asks you to connect it. The device is recognized by a `koma-disco.json` file, even if its path or drive letter changes.
- **Cloud storage (optional):** Google Drive, OneDrive or any rclone service. Each chapter becomes a `.cbz` file. Chapters can live only in the cloud, with a size-limited local cache.

## Who translates

Set it up in **Settings → Translation**:

| Option | How it works |
|---|---|
| **Google Translate (free)** | No account or key. Line by line, without the chapter's context. |
| **DeepL API Free** | Free within the monthly allowance of a DeepL API Free account. The key (ending in `:fx`) is stored encrypted in KOMA, and the settings show how much of the allowance is used. Line by line, without the chapter's context. |
| **Claude or ChatGPT subscription** | Uses this computer's [Claude Code](https://claude.com/claude-code) or Codex (bundled with the ChatGPT app) login. No API key; it uses your plan's limits. Translates the whole chapter with context and can re-read blurry lines from the image. |
| **KPassword** | DeepSeek, Xiaomi MiMo, OpenAI, Anthropic and Z.ai, with keys kept in the KPassword vault and reached through its Secrets Bridge (Linux). KOMA never sees the key. |
| **OpenRouter** | Key stored encrypted in KOMA; any model in the OpenRouter catalog. |

With an AI model, a second model can review the translation. The free translators work on their own, without a reviewer. Text is only sent to a provider after you authorize it. **Settings → Performance** shows how long each step took in recent chapters.

## Install

### Windows 11

Download `KOMA-Setup-<version>.exe` from the [Releases](https://github.com/mnstechbr/KOMA/releases) page and run it. It installs for your user, with no admin rights, and keeps data in `%LOCALAPPDATA%\KOMA`. The installer is built and tested on Windows 11 by GitHub Actions (install, open, uninstall keeping the library). If the firewall asks when you turn on "Read on your phone", allow KOMA on private networks.

### Linux (from source)

Requirements: Linux x86_64, Node 24, npm, Git with [Git LFS](https://git-lfs.com/) and tar. rclone is optional (cloud storage). Building the RPM also needs `rpm-build`.

```bash
git lfs install
git clone https://github.com/mnstechbr/KOMA.git koma && cd koma
npm ci
npm ci --prefix desktop
node desktop/node_modules/electron/install.js
npm run desktop:resources
NEXT_TELEMETRY_DISABLED=1 SKIP_DB_BOOTSTRAP=1 npm run build
npm run desktop:prepare
npm run desktop:install
```

Then open **KOMA** from your applications menu. To check everything before installing, run `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:desktop` and `npm run test:production`. `npm run desktop:rpm` builds an RPM package in `artifacts/rpm/`; `npm run desktop:windows` builds the Windows installer in `artifacts/`.

## Where data lives

| What | Linux | Windows |
|---|---|---|
| Library, SQLite database and pages | `~/.local/share/koma/library` | `%LOCALAPPDATA%\KOMA\library` |
| Installed app | `~/.local/share/koma/app/current` | `%LOCALAPPDATA%\Programs\KOMA` |
| Diagnostics | `~/.local/state/koma/logs/backend.log` | `%LOCALAPPDATA%\KOMA\logs` |
| Chapters on an external device (optional) | `KOMA` folder on the device | `KOMA` folder on the device |

On Linux, `XDG_DATA_HOME`, `XDG_CONFIG_HOME` and `XDG_STATE_HOME` are respected. To back up, close KOMA (Quit in the tray menu) and copy the whole `library` folder.

## Privacy

KOMA has no account, server or telemetry. The library, OCR and reading progress stay on your computer. Only these leave it:
- requests to the series' sources;
- balloon text sent to the translation providers you authorize;
- chapters uploaded to the cloud you connect (optional);
- your reading progress sent to AniList, if you connect it (optional);
- pages shown to your phone on your home network, if you turn on "Read on your phone" (optional);
- an error report you choose to send to GitHub, which opens in your browser for you to review (optional).

## Reporting problems

In the reader, the flag button reports a translation error on a page. The page becomes a permanent check in the quality gate. **Report and send to GitHub** opens a pre-filled [issue](https://github.com/mnstechbr/KOMA/issues/new/choose) in your browser with text only (no image, no title name, no links); you review it and submit it with your own account. App bugs go through the **App bug** form.

## Legal notice

KOMA does not host or distribute any series and includes no unofficial source. It reads public pages over your own connection, for personal use, the way a browser would. Sites you add yourself are your responsibility. Respect copyright and each site's terms of use. Whenever you can, support the creators by reading and buying on official platforms.

## Credits

- Based on the open-source project [translate-manga-br](https://github.com/marco0antonio0/translate-manga-br) (MIT license). Original authorship is preserved in [LICENSE](LICENSE) and [THIRD-PARTY-NOTICES](THIRD-PARTY-NOTICES).
- OCR: [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) (Apache-2.0); the Korean model was converted to ONNX by monkt/paddleocr-onnx.
- Balloon detector (`models/yolo.onnx`): inherited from translate-manga-br. Its metadata says it was trained with Ultralytics under the AGPL-3.0 license, the same license as KOMA.
- Text erasing: [comic-text-detector](https://github.com/dmMaze/comic-text-detector) (GPL-3.0 upstream; ONNX conversion by mayocream) and [LaMa](https://github.com/advimman/lama) (Apache-2.0; ONNX conversion by Carve), downloaded with a pinned SHA-256 by `scripts/fetch-desktop-resources.mjs`.
- Interface fonts: Dela Gothic One and IBM Plex Sans (SIL Open Font License 1.1).
- Library planning was inspired by [Suwayomi-Server](https://github.com/Suwayomi/Suwayomi-Server); none of its code is included.

Release history (in Portuguese) lives in [docs/koma/NOTAS-DE-VERSAO.md](docs/koma/NOTAS-DE-VERSAO.md).

## Author

Created by **Jean Vitor**, full-stack developer · [LinkedIn](https://www.linkedin.com/in/jean-vitor-16a19642a/) · [GitHub](https://github.com/mnstechbr)

Licensed under the [GNU Affero General Public License v3.0 or later](LICENSE) (AGPL-3.0-or-later). The code inherited from translate-manga-br keeps its MIT notice, reproduced in the same file.
