import fs from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '..')
const { version } = JSON.parse(await fs.readFile(path.join(root, 'desktop/package.json'), 'utf8'))
const bundle = (await fs.readFile(path.join(root, 'artifacts/latest-bundle.txt'), 'utf8')).trim()
const topdir = path.join(root, 'artifacts/rpm')
for (const dir of ['BUILD', 'BUILDROOT', 'RPMS', 'SOURCES', 'SPECS', 'SRPMS', 'tmp']) await fs.mkdir(path.join(topdir, dir), { recursive: true })
const spec = `Name: koma
Version: ${version}
Release: 1%{?dist}
Summary: Biblioteca pessoal e tradução de mangás em português brasileiro
License: AGPL-3.0-or-later
URL: https://github.com/mnstechbr
BuildArch: x86_64
AutoReqProv: no
Requires: gtk3, nss, alsa-lib, libdrm, libgbm, libX11, libXcomposite, libXdamage, libXfixes, libXrandr, libxcb, libxkbcommon, libstdc++
%define _build_id_links none
%define __os_install_post %{nil}

%description
KOMA (AGPL-3.0-or-later), baseado em translate-manga-br (MIT). Inclui Node e Electron,
OCR em CPU e biblioteca persistente por usuário. Tradução externa exige
autorização nas preferências. Pesos originais para uso pessoal local.

%install
mkdir -p "%{buildroot}/opt" "%{buildroot}/usr/share/applications"
cp -a "$KOMA_RPM_BUNDLE" "%{buildroot}/opt/koma"
cat > "%{buildroot}/usr/share/applications/koma.desktop" <<'DESKTOP'
[Desktop Entry]
Version=1.0
Type=Application
Name=KOMA
Comment=Biblioteca pessoal e tradução de mangás em português brasileiro
Exec=/opt/koma/koma
Icon=/opt/koma/electron/resources/app/koma.png
Terminal=false
Categories=Graphics;Viewer;
StartupWMClass=KOMA
DESKTOP

%files
/opt/koma
/usr/share/applications/koma.desktop
`
const specPath = path.join(topdir, 'SPECS/koma.spec')
await fs.writeFile(specPath, spec)
execFileSync('rpmbuild', ['-bb', '--define', `_topdir ${topdir}`, '--define', '_binary_payload w3.zstdio', '--define', `_tmppath ${path.join(topdir, 'tmp')}`, specPath], {
  stdio: 'inherit', env: { ...process.env, KOMA_RPM_BUNDLE: bundle },
})
