; IDMM NSIS Custom Installer Script v1.3.0
; Multi-browser extension installer: Chrome, Edge, Brave, Firefox
;
; Changelog:
;   - Removed RequestExecutionLevel admin (electron-builder manages this via perMachine:true)
;   - Removed duplicate .onInstSuccess callback (was conflicting with customInstall)
;   - Fixed WOW6432Node registry paths after SetRegView 64
;   - Fixed DetailPrint messages to say HKLM (not HKCU)
;   - Version now uses ${VERSION} define from electron-builder
;
; How this works:
;   electron-builder includes this file via the "include" option in package.json.
;   It must define !macro customInstall and !macro customUnInstall.
;   electron-builder calls these via !ifmacrodef / !insertmacro in its NSIS templates:
;     installSection.nsh -> !ifmacrodef customInstall -> !insertmacro customInstall
;     uninstaller.nsh    -> !ifmacrodef customUnInstall -> !insertmacro customUnInstall
;
; For Chromium MV3 with key field, the correct external extension registration
; is HKLM\Software\<Browser>\Extensions\<id>\ (64-bit view) or
; software\WOW6432Node\... via SetRegView 32 for 32-bit browsers.
; This works WITHOUT publishing to Chrome Web Store / Edge Addons.
;
; Firefox uses HKLM registry for sideloading + .xpi copy to profiles.

; NOTE: Do NOT put RequestExecutionLevel here.
;  - perMachine:true in package.json makes electron-builder set RequestExecutionLevel admin
;  - Setting it manually here causes a duplicate directive warning in NSIS and
;    can conflict with the UAC dual-instance pattern (outer unelevated + inner elevated)

; ============================================================
; GLOBAL VARIABLES
; ============================================================
Var /GLOBAL FoundChrome
Var /GLOBAL FoundEdge
Var /GLOBAL FoundBrave
Var /GLOBAL FoundFirefox
Var /GLOBAL ChromePath
Var /GLOBAL EdgePath
Var /GLOBAL BravePath
Var /GLOBAL FirefoxPath
Var /GLOBAL ExtPath
Var /GLOBAL ExtId

; ============================================================
; CUSTOM INSTALL
; Called by electron-builder at the end of "Section install"
; via:  !ifmacrodef customInstall / !insertmacro customInstall
; ============================================================
!macro customInstall
  ; Close any running IDMM instance
  nsExec::ExecToStack 'taskkill /F /IM IDMM.exe'
  Pop $0
  Pop $1
  Sleep 1000

  ; Extension path — extraResources copies ../extension to $INSTDIR\resources\extension
  StrCpy $ExtPath "$INSTDIR\resources\extension"

  ; Chromium extension ID (derived from RSA public key in manifest.json)
  StrCpy $ExtId "oacdlfdjmjepdjgcjhdihbfemioifhao"

  ; Auto-start IDMM on Windows boot
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "IDMM" '"$INSTDIR\IDMM.exe" --hidden'

  ; ============================================================
  ; BROWSER DETECTION
  ; ============================================================
  StrCpy $FoundChrome "0"
  StrCpy $FoundEdge "0"
  StrCpy $FoundBrave "0"
  StrCpy $FoundFirefox "0"

  ; --- Chrome ---
  IfFileExists "$LOCALAPPDATA\Google\Chrome\Application\chrome.exe" 0 ChromeSystemWide
    StrCpy $FoundChrome "1"
    StrCpy $ChromePath "$LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    Goto ChromeDetected
  ChromeSystemWide:
  IfFileExists "$PROGRAMFILES64\Google\Chrome\Application\chrome.exe" 0 ChromeSystemWide32
    StrCpy $FoundChrome "1"
    StrCpy $ChromePath "$PROGRAMFILES64\Google\Chrome\Application\chrome.exe"
    Goto ChromeDetected
  ChromeSystemWide32:
  IfFileExists "$PROGRAMFILES32\Google\Chrome\Application\chrome.exe" 0 ChromeDetected
    StrCpy $FoundChrome "1"
    StrCpy $ChromePath "$PROGRAMFILES32\Google\Chrome\Application\chrome.exe"
  ChromeDetected:

  ; --- Edge ---
  IfFileExists "$PROGRAMFILES(X86)\Microsoft\Edge\Application\msedge.exe" 0 EdgeUserMode
    StrCpy $FoundEdge "1"
    StrCpy $EdgePath "$PROGRAMFILES(X86)\Microsoft\Edge\Application\msedge.exe"
    Goto EdgeDetected
  EdgeUserMode:
  IfFileExists "$LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe" 0 EdgeDetected
    StrCpy $FoundEdge "1"
    StrCpy $EdgePath "$LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe"
  EdgeDetected:

  ; --- Brave ---
  IfFileExists "$LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe" 0 BraveDetected
    StrCpy $FoundBrave "1"
    StrCpy $BravePath "$LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe"
  BraveDetected:

  ; --- Firefox ---
  IfFileExists "$PROGRAMFILES\Mozilla Firefox\firefox.exe" 0 FirefoxUserMode
    StrCpy $FoundFirefox "1"
    StrCpy $FirefoxPath "$PROGRAMFILES\Mozilla Firefox\firefox.exe"
    Goto FirefoxDetected
  FirefoxUserMode:
  IfFileExists "$LOCALAPPDATA\Mozilla Firefox\firefox.exe" 0 FirefoxDetected
    StrCpy $FoundFirefox "1"
    StrCpy $FirefoxPath "$LOCALAPPDATA\Mozilla Firefox\firefox.exe"
  FirefoxDetected:

  ; ============================================================
  ; CHROMIUM EXTENSION INSTALL
  ; Chrome/Edge/Brave scan HKLM\Software\<Browser>\Extensions\<id>\
  ; for "path" and "version" values. The extension must have a
  ; "key" field in manifest.json for a stable ID.
  ; ============================================================

  ; --- Chrome (64-bit view) ---
  StrCmp $FoundChrome "0" SkipChrome
    SetRegView 64
    WriteRegStr HKLM "Software\Google\Chrome\Extensions\$ExtId" "path" "$ExtPath"
    WriteRegStr HKLM "Software\Google\Chrome\Extensions\$ExtId" "version" "${VERSION}"
    ; Also write to 32-bit view for 32-bit Chrome on 64-bit Windows
    SetRegView 32
    WriteRegStr HKLM "Software\Google\Chrome\Extensions\$ExtId" "path" "$ExtPath"
    WriteRegStr HKLM "Software\Google\Chrome\Extensions\$ExtId" "version" "${VERSION}"
    SetRegView 64
  SkipChrome:

  ; --- Edge ---
  StrCmp $FoundEdge "0" SkipEdge
    WriteRegStr HKLM "Software\Microsoft\Edge\Extensions\$ExtId" "path" "$ExtPath"
    WriteRegStr HKLM "Software\Microsoft\Edge\Extensions\$ExtId" "version" "${VERSION}"
  SkipEdge:

  ; --- Brave ---
  StrCmp $FoundBrave "0" SkipBrave
    WriteRegStr HKLM "Software\BraveSoftware\Brave\Extensions\$ExtId" "path" "$ExtPath"
    WriteRegStr HKLM "Software\BraveSoftware\Brave\Extensions\$ExtId" "version" "${VERSION}"
    CreateShortCut "$DESKTOP\IDMM - Brave.lnk" "$BravePath" '--load-extension="$ExtPath" --no-first-run' "" "" SW_SHOWNORMAL "" "IDMM - Brave"
  SkipBrave:

  ; ============================================================
  ; FIREFOX EXTENSION INSTALL
  ; Firefox sideloads via HKLM\Software\Mozilla\Firefox\Extensions\<gecko-id> = path
  ; ============================================================
  StrCmp $FoundFirefox "0" SkipFirefox
    WriteRegStr HKLM "Software\Mozilla\Firefox\Extensions" "idmm-extension@glitchworlds" "$ExtPath\idmm.xpi"

    IfFileExists "$ExtPath\idmm.xpi" 0 SkipXpiCopy
      nsExec::ExecToStack 'cmd /c for /d %%P in ("%APPDATA%\Mozilla\Firefox\Profiles\*.default*") do copy /Y "$ExtPath\idmm.xpi" "%%P\extensions\idmm-extension@glitchworlds.xpi" >nul 2>&1'
      Pop $0
    SkipXpiCopy:
  SkipFirefox:

  ; ============================================================
  ; PROTOCOL HANDLER & FILE ASSOCIATION
  ; ============================================================
  SetRegView Default

  WriteRegStr HKCU "Software\Classes\idmm" "" "URL:IDMM Download Protocol"
  WriteRegStr HKCU "Software\Classes\idmm" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\idmm\shell\open\command" "" '"$INSTDIR\IDMM.exe" "%1"'

  WriteRegStr HKCU "Software\Classes\.idmm" "" "IDMM.DownloadConfig"
  WriteRegStr HKCU "Software\Classes\IDMM.DownloadConfig" "" "IDMM Download Configuration"
  WriteRegStr HKCU "Software\Classes\IDMM.DownloadConfig\DefaultIcon" "" '"$INSTDIR\IDMM.exe",0'
  WriteRegStr HKCU "Software\Classes\IDMM.DownloadConfig\shell\open\command" "" '"$INSTDIR\IDMM.exe" "%1"'

  ; ============================================================
  ; INSTALLATION LOG
  ; ============================================================
  DetailPrint "=== IDMM Browser Extension Installation ==="
  StrCmp $FoundChrome "0" LogNoChrome
    DetailPrint "[OK] Chrome extension registered (ID: $ExtId)"
    Goto LogEdge
  LogNoChrome:
    DetailPrint "[--] Chrome not found, skipped"

  LogEdge:
  StrCmp $FoundEdge "0" LogNoEdge
    DetailPrint "[OK] Edge extension registered (ID: $ExtId)"
    Goto LogBrave
  LogNoEdge:
    DetailPrint "[--] Edge not found, skipped"

  LogBrave:
  StrCmp $FoundBrave "0" LogNoBrave
    DetailPrint "[OK] Brave extension registered"
    Goto LogFirefox
  LogNoBrave:
    DetailPrint "[--] Brave not found, skipped"

  LogFirefox:
  StrCmp $FoundFirefox "0" LogNoFirefox
    DetailPrint "[OK] Firefox extension registered"
    Goto LogDone
  LogNoFirefox:
    DetailPrint "[--] Firefox not found, skipped"

  LogDone:
    DetailPrint "=== Installation complete ==="

!macroend

; ============================================================
; CUSTOM UNINSTALL
; Called by electron-builder at the end of "Section un.install"
; via:  !ifmacrodef customUnInstall / !insertmacro customUnInstall
; ============================================================
!macro customUnInstall
  ; Close any running IDMM instance
  nsExec::ExecToStack 'taskkill /F /IM IDMM.exe'
  Pop $0
  Pop $1
  Sleep 1000

  ; Remove auto-start registry entry
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "IDMM"

  ; Remove browser extension registry entries
  SetRegView 64
  DeleteRegKey HKLM "Software\Google\Chrome\Extensions\$ExtId"
  DeleteRegKey HKLM "Software\Microsoft\Edge\Extensions\$ExtId"
  DeleteRegKey HKLM "Software\BraveSoftware\Brave\Extensions\$ExtId"
  DeleteRegValue HKLM "Software\Mozilla\Firefox\Extensions" "idmm-extension@glitchworlds"

  ; Also clean the 32-bit view registry entries (in case 32-bit browsers found them)
  SetRegView 32
  DeleteRegKey HKLM "Software\Google\Chrome\Extensions\$ExtId"
  SetRegView 64

  ; Remove Firefox .xpi from profiles
  nsExec::ExecToStack 'cmd /c for /d %%P in ("%APPDATA%\Mozilla\Firefox\Profiles\*.default*") do del /q "%%P\extensions\idmm-extension@glitchworlds.xpi" 2>nul'
  Pop $0
  Pop $1

  ; Remove protocol handler & file association
  SetRegView Default
  DeleteRegKey HKCU "Software\Classes\idmm"
  DeleteRegKey HKCU "Software\Classes\.idmm"
  DeleteRegKey HKCU "Software\Classes\IDMM.DownloadConfig"

  ; Remove desktop shortcuts
  Delete "$DESKTOP\IDMM - Brave.lnk"

  ; Remove user data (only if flag is set)
  ; RMDir /r "$PROFILE\.idmm"

!macroend
