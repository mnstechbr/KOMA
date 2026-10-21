; Instalador do KOMA para Windows (por usuário, sem administrador).
; Gerado por scripts/build-windows.mjs com -DVERSION, -DBUNDLE e -DOUTFILE.
; A biblioteca fica em %LOCALAPPDATA%\KOMA e nunca é apagada aqui.
Unicode true
SetCompressor /SOLID lzma
!include "MUI2.nsh"

!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\KOMA"
Name "KOMA"
Caption "KOMA ${VERSION}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\KOMA"
RequestExecutionLevel user
ShowInstDetails nevershow
ShowUninstDetails nevershow
VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=0 "ProductName" "KOMA"
VIAddVersionKey /LANG=0 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=0 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=0 "FileDescription" "Instalador do KOMA"
VIAddVersionKey /LANG=0 "LegalCopyright" "Jean Vitor (MIT)"

!define MUI_ICON "${BUNDLE}\koma.ico"
!define MUI_UNICON "${BUNDLE}\koma.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\electron\KOMA.exe"
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "PortugueseBR"
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "Spanish"

LangString CloseKoma ${LANG_PORTUGUESEBR} "Feche o KOMA antes de continuar e clique em OK."
LangString CloseKoma ${LANG_ENGLISH} "Close KOMA before continuing, then click OK."
LangString CloseKoma ${LANG_SPANISH} "Cierre KOMA antes de continuar y haga clic en Aceptar."

; Arquivo em uso = KOMA aberto. Renomear falha nesse caso sem apagar nada.
!macro WaitClosed FILE
  IfFileExists "${FILE}" 0 +7
  ClearErrors
  Rename "${FILE}" "${FILE}.old"
  IfErrors 0 +3
  MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(CloseKoma)" IDOK -3
  Abort
  Rename "${FILE}.old" "${FILE}"
!macroend

Section "KOMA"
  !insertmacro WaitClosed "$INSTDIR\electron\KOMA.exe"
  !insertmacro WaitClosed "$INSTDIR\runtime\node.exe"
  ; Versão anterior sai inteira para não sobrar arquivo velho do servidor.
  RMDir /r "$INSTDIR\electron"
  RMDir /r "$INSTDIR\server"
  RMDir /r "$INSTDIR\runtime"
  SetOutPath "$INSTDIR"
  File /r "${BUNDLE}\*"
  WriteUninstaller "$INSTDIR\Desinstalar KOMA.exe"
  CreateShortcut "$SMPROGRAMS\KOMA.lnk" "$INSTDIR\electron\KOMA.exe" "" "$INSTDIR\koma.ico" 0
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "KOMA"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "Jean Vitor"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\koma.ico"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Desinstalar KOMA.exe"'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  !insertmacro WaitClosed "$INSTDIR\electron\KOMA.exe"
  Delete "$SMPROGRAMS\KOMA.lnk"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
SectionEnd
