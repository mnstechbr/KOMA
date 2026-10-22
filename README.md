# KOMA

**English** · [Português](README.pt-BR.md)

**Pick a series. KOMA does the rest.** KOMA is a personal desktop library for manga, manhwa and manhua. Add a series and it finds the chapters, downloads the pages, reads the text in the speech balloons, translates it with the AI model you choose and gives you pages ready to read in your language.

> Personal, experimental project. Tested on Fedora 44 (Linux x86_64). A Windows 11 installer is available as an experimental build, not yet tested on a real Windows machine.

## What it does

- **Series library:** search by title, with cover, synopsis and alternative names. It tracks favorites, "continue reading", new chapters and progress per chapter.
- **Multi-source collection:** tries the original publisher first (Naver Webtoon, Shonen Jump+), then versions in your language, official editions and MangaDex. If a source fails, it tries another version of the same chapter. KOMA ships with no unofficial source. You can add your own sites in **Settings → Sources** (any site built with the Madara WordPress theme, by pasting the link to a title), at your own responsibility.
- **Local OCR:** balloon detection (YOLO) and free-text detection, with PP-OCRv5 recognition for Latin script and Korean. Everything runs on your computer.
- **Chapter-level translation:** the whole chapter goes in a single request, with neighboring lines, a glossary and character voices as context. One model can translate and another can review.
- **Truly translated pages:** the original text is erased and the translation is drawn inside the balloon. The original page is one click away.
- **Reader:** continuous scrolling, auto-scroll with 15 speeds (space bar pauses) and middle-click scrolling.
- **Languages:** interface in Portuguese, English or Spanish. Each series can be translated into Brazilian Portuguese, English, Spanish, French, German or Italian.
- **Cloud storage (optional):** Google Drive, OneDrive or any rclone service. Each chapter becomes a `.cbz` file that opens in any comic reader. Chapters can live only in the cloud, with a size-limited local cache.

## Who translates

Set it up in **Settings → Adaptation and review**:

| Option | How it works |
|---|---|
| **Claude or ChatGPT subscription** | Uses this computer's [Claude Code](https://claude.com/claude-code) or Codex (bundled with the ChatGPT app) login. No API key needed; it uses your plan's limits. |
| **KPassword** | DeepSeek, Xiaomi MiMo, OpenAI, Anthropic and Z.ai, with keys kept in the KPassword vault and reached through its Secrets Bridge. KOMA never sees the key. |
| **OpenRouter or Google (legacy)** | For chapters imported by hand. |

Text is only sent to a provider after you authorize it.

## Install from source

Requirements: Linux x86_64, Node 24, npm, Git with [Git LFS](https://git-lfs.com/) and tar. rclone is optional (cloud storage). Building the RPM also needs `rpm-build`.

```bash
git lfs install
git clone <this repository> koma && cd koma
npm ci
npm ci --prefix desktop
node desktop/node_modules/electron/install.js
npm run desktop:resources
NEXT_TELEMETRY_DISABLED=1 SKIP_DB_BOOTSTRAP=1 npm run build
npm run desktop:prepare
npm run desktop:install
```

Then open **KOMA** from your applications menu. To check everything before installing, run `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:desktop` and `npm run test:production`. `npm run desktop:rpm` builds an RPM package in `artifacts/rpm/`.

## Windows 11 (experimental)

Download `KOMA-Setup-<version>.exe` from the [Releases](https://github.com/mnstechbr/KOMA/releases) page. It installs per user, with no admin rights, and keeps data in `%LOCALAPPDATA%\KOMA`. It is untested on real hardware, so please [open an issue](https://github.com/mnstechbr/KOMA/issues) if something fails. To build it yourself, run `npm run build` and then `npm run desktop:windows`, on Linux or Windows; the installer lands in `artifacts/`.

## Where data lives

| What | Where |
|---|---|
| Library, SQLite database and pages | `~/.local/share/koma/library` |
| Installed app | `~/.local/share/koma/app/current` |
| Diagnostics | `~/.local/state/koma/logs/backend.log` |

`XDG_DATA_HOME`, `XDG_CONFIG_HOME` and `XDG_STATE_HOME` are respected. To back up, close KOMA and copy the whole `library` folder.

## Privacy

KOMA has no account, server or telemetry. The library, OCR and reading progress stay on your computer. Only these leave it:
- requests to the series' sources;
- balloon text sent to the translation providers you authorize;
- chapters uploaded to the cloud you connect.

## Reporting problems

In the reader, the flag button reports a translation error on a page. **Report and send to GitHub** opens a pre-filled [issue](https://github.com/mnstechbr/KOMA/issues/new/choose) in your browser with text only (no image, no title name, no links); you review it and submit it with your own account. App bugs go through the **App bug** form.

## Legal notice

KOMA does not host or distribute any series. It reads public pages over your own connection, for personal use, the way a browser would. Respect copyright and each site's terms of use. Whenever you can, support the creators by reading and buying on official platforms.

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
