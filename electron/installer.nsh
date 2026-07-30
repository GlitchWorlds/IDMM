; IDMM NSIS Custom Installer Script v1.3.0
; Multi-browser extension installer: Chrome, Edge, Brave, Firefox
; Features: auto-start, extension auto-install via HKCU registry, desktop shortcuts, uninstall cleanup
;
; KEY INSIGHT: The extension has a "key" field in manifest.json.
; For Chromium MV3 with key field, the correct external extension registration
; is HKCU\Software\<Browser>\Extensions\<id>\ (NOT HKLM ExtensionInstallForcelist).
; This works WITHOUT publishing to Chrome Web Store / Edge Addons.
;
; Firefox uses HKCU registry for native messaging + .xpi copy to profiles.
;
; Removed: Opera, Vivaldi (per user request).

; ============================================================
; GLOBAL VARIABLES (set in customInstall, used in customUnInstall)
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
; ============================================================
!macro customInstall
  ; === Close any running IDMM instance ===
  nsExec::ExecToStack 'taskkill /F /IM IDMM.exe'
  Pop $0
  Pop $1
  Sleep 1000

  ; === Extension path (extraResources copies ../extension → $INSTDIR\resources\extension) ===
  StrCpy $ExtPath "$INSTDIR\resources\extension"

  ; === Chromium extension ID (derived from RSA public key in manifest.json) ===
  StrCpy $ExtId "oacdlfdjmjepdjgcjhdihbfemioifhao"

  ; === Auto-start IDMM on Windows boot ===
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
  IfFileExists "$PROGRAMFILES\Google\Chrome\Application\chrome.exe" 0 ChromeDetected
    StrCpy $FoundChrome "1"
    StrCpy $ChromePath "$PROGRAMFILES\Google\Chrome\Application\chrome.exe"
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
  ; CHROMIUM EXTENSION INSTALL (HKLM External Extension Registration)
  ;
  ; How this works: Chrome/Edge/Brave scan HKLM\Software\<Browser>\Extensions\<id>\
  ; on startup for registry entries containing a "path" and "version" key.
  ; If the extension at that path has a matching "key" field in its
  ; manifest.json, Chrome loads it as a sideloaded extension with a stable ID.
  ;
  ; This is the CORRECT method for unpacked MV3 extensions with key field.
  ; The old method (HKLM ExtensionInstallForcelist) ONLY works for extensions
  ; published on Chrome Web Store / Edge Addons.
  ; ============================================================

  ; Force 64-bit registry view for 64-bit browsers
  SetRegView 64

  ; --- Chrome ---
  StrCmp $FoundChrome "0" SkipChrome
    WriteRegStr HKLM "Software\Google\Chrome\Extensions\$ExtId" "path" "$ExtPath"

    WriteRegStr HKLM "Software\WOW6432Node\Google\Chrome\Extensions\$ExtId" "path" "$ExtPath"
    WriteRegStr HKLM "Software\Google\Chrome\Extensions\$ExtId" "version" "1.3.0"

    WriteRegStr HKLM "Software\WOW6432Node\Google\Chrome\Extensions\$ExtId" "version" "1.3.0"
  SkipChrome:

  ; --- Edge ---
  StrCmp $FoundEdge "0" SkipEdge
    WriteRegStr HKLM "Software\Microsoft\Edge\Extensions\$ExtId" "path" "$ExtPath"
    WriteRegStr HKLM "Software\Microsoft\Edge\Extensions\$ExtId" "version" "1.3.0"
  SkipEdge:

  ; --- Brave (HKLM registry + desktop shortcut fallback) ---
  StrCmp $FoundBrave "0" SkipBrave
    WriteRegStr HKLM "Software\BraveSoftware\Brave\Extensions\$ExtId" "path" "$ExtPath"
    WriteRegStr HKLM "Software\BraveSoftware\Brave\Extensions\$ExtId" "version" "1.3.0"
    CreateShortCut "$DESKTOP\IDMM - Brave.lnk" "$BravePath" '--load-extension="$ExtPath" --no-first-run' "" "" SW_SHOWNORMAL "" "IDMM - Brave (with extension)"
  SkipBrave:

  ; ============================================================
  ; FIREFOX EXTENSION INSTALL
  ;
  ; Firefox sideloading via registry:
  ;   HKCU\Software\Mozilla\Firefox\Extensions\<gecko-id> = path to .xpi
  ; Firefox reads this on next launch and installs the addon silently.
  ;
  ; Additionally, we copy idmm.xpi to all active Firefox profile
  ; extension directories for broader compatibility.
  ;
  ; The .xpi is included via extraResources and extracted to:
  ;   $INSTDIR\resources\extension\idmm.xpi
  ; Firefox extension ID (from manifest.json browser_specific_settings.gecko.id):
  ;   idmm-extension@glitchworlds
  ; ============================================================
  StrCmp $FoundFirefox "0" SkipFirefox
    ; Step 1: Register via HKLM registry (primary method)
    WriteRegStr HKLM "Software\Mozilla\Firefox\Extensions" "idmm-extension@glitchworlds" "$ExtPath\idmm.xpi"

    ; Step 2: Copy to all active Firefox profiles (belt-and-suspenders)
    ; The profile extension directory requires the xpi to be named exactly
    ; as the gecko ID + .xpi extension
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
    DetailPrint "[OK] Chrome extension registered via HKCU (ID: $ExtId)"
    Goto LogEdge
  LogNoChrome:
    DetailPrint "[--] Chrome not found, skipped"

  LogEdge:
  StrCmp $FoundEdge "0" LogNoEdge
    DetailPrint "[OK] Edge extension registered via HKCU (ID: $ExtId)"
    Goto LogBrave
  LogNoEdge:
    DetailPrint "[--] Edge not found, skipped"

  LogBrave:
  StrCmp $FoundBrave "0" LogNoBrave
    DetailPrint "[OK] Brave extension registered via HKCU + desktop shortcut created"
    Goto LogFirefox
  LogNoBrave:
    DetailPrint "[--] Brave not found, skipped"

  LogFirefox:
  StrCmp $FoundFirefox "0" LogNoFirefox
    DetailPrint "[OK] Firefox extension registered via HKCU + .xpi copied to profiles"
    Goto LogDone
  LogNoFirefox:
    DetailPrint "[--] Firefox not found, skipped"

  LogDone:
    DetailPrint "=== Installation complete ==="

!macroend

; ============================================================
; CUSTOM UNINSTALL
; ============================================================
!macro customUnInstall
  ; === Close any running IDMM instance ===
  nsExec::ExecToStack 'taskkill /F /IM IDMM.exe'
  Pop $0
  Pop $1
  Sleep 1000

  ; === Remove auto-start registry entry ===
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "IDMM"

  ; ============================================================
  ; REMOVE BROWSER EXTENSION REGISTRY ENTRIES
  ; ============================================================
  SetRegView 64

  ; --- Chrome ---
  DeleteRegKey HKLM "Software\Google\Chrome\Extensions\$ExtId"

  DeleteRegKey HKLM "Software\WOW6432Node\Google\Chrome\Extensions\$ExtId"

  ; --- Edge ---
  DeleteRegKey HKLM "Software\Microsoft\Edge\Extensions\$ExtId"

  ; --- Brave ---
  DeleteRegKey HKLM "Software\BraveSoftware\Brave\Extensions\$ExtId"

  ; --- Firefox ---
  DeleteRegValue HKLM "Software\Mozilla\Firefox\Extensions" "idmm-extension@glitchworlds"

  ; ============================================================
  ; REMOVE FIREFOX .XPI FROM PROFILES
  ; ============================================================
  nsExec::ExecToStack 'cmd /c for /d %%P in ("%APPDATA%\Mozilla\Firefox\Profiles\*.default*") do del /q "%%P\extensions\idmm-extension@glitchworlds.xpi" 2>nul'
  Pop $0
  Pop $1

  ; ============================================================
  ; REMOVE PROTOCOL HANDLER & FILE ASSOCIATION
  ; ============================================================
  SetRegView Default
  DeleteRegKey HKCU "Software\Classes\idmm"
  DeleteRegKey HKCU "Software\Classes\.idmm"
  DeleteRegKey HKCU "Software\Classes\IDMM.DownloadConfig"

  ; ============================================================
  ; REMOVE DESKTOP SHORTCUTS
  ; ============================================================
  Delete "$DESKTOP\IDMM - Brave.lnk"

  ; ============================================================
  ; REMOVE USER DATA
  ; ============================================================
  RMDir /r "$PROFILE\.idmm"

!macroend
