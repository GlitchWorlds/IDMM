; IDMM NSIS Custom Installer Script v1.2.4
; Multi-browser extension installer: Chrome, Edge, Brave, Opera, Vivaldi, Firefox
; Features: auto-start, extension auto-install, desktop shortcuts, uninstall cleanup

; ============================================================
; GLOBAL VARIABLES (set in customInstall, used in customUnInstall)
; ============================================================
Var /GLOBAL FoundChrome
Var /GLOBAL FoundEdge
Var /GLOBAL FoundBrave
Var /GLOBAL FoundOpera
Var /GLOBAL FoundVivaldi
Var /GLOBAL FoundFirefox
Var /GLOBAL ChromePath
Var /GLOBAL EdgePath
Var /GLOBAL BravePath
Var /GLOBAL OperaPath
Var /GLOBAL VivaldiPath
Var /GLOBAL FirefoxPath
Var /GLOBAL ExtPath

; ============================================================
; CUSTOM INSTALL
; ============================================================
!macro customInstall
  ; === Close any running IDMM instance ===
  nsExec::ExecToStack 'taskkill /F /IM IDMM.exe'
  Pop $0
  Pop $1
  Sleep 1000

  ; === Store extension path for use in batch scripts ===
  StrCpy $ExtPath "$INSTDIR\resources\extension"

  ; === Auto-start IDMM on Windows boot ===
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "IDMM" '"$INSTDIR\IDMM.exe" --hidden'

  ; ============================================================
  ; BROWSER DETECTION
  ; ============================================================
  StrCpy $FoundChrome "0"
  StrCpy $FoundEdge "0"
  StrCpy $FoundBrave "0"
  StrCpy $FoundOpera "0"
  StrCpy $FoundVivaldi "0"
  StrCpy $FoundFirefox "0"

  ; --- Chrome ---
  IfFileExists "$LOCALAPPDATA\Google\Chrome\Application\chrome.exe" 0 +3
    StrCpy $FoundChrome "1"
    StrCpy $ChromePath "$LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    Goto ChromeDetected
  IfFileExists "$PROGRAMFILES\Google\Chrome\Application\chrome.exe" 0 ChromeDetected
    StrCpy $FoundChrome "1"
    StrCpy $ChromePath "$PROGRAMFILES\Google\Chrome\Application\chrome.exe"
  ChromeDetected:

  ; --- Edge ---
  IfFileExists "$PROGRAMFILES(X86)\Microsoft\Edge\Application\msedge.exe" 0 +3
    StrCpy $FoundEdge "1"
    StrCpy $EdgePath "$PROGRAMFILES(X86)\Microsoft\Edge\Application\msedge.exe"
    Goto EdgeDetected
  IfFileExists "$LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe" 0 EdgeDetected
    StrCpy $FoundEdge "1"
    StrCpy $EdgePath "$LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe"
  EdgeDetected:

  ; --- Brave ---
  IfFileExists "$LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe" 0 BraveDetected
    StrCpy $FoundBrave "1"
    StrCpy $BravePath "$LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe"
  BraveDetected:

  ; --- Opera ---
  IfFileExists "$LOCALAPPDATA\Programs\Opera\opera.exe" 0 OperaDetected
    StrCpy $FoundOpera "1"
    StrCpy $OperaPath "$LOCALAPPDATA\Programs\Opera\opera.exe"
  OperaDetected:

  ; --- Vivaldi ---
  IfFileExists "$LOCALAPPDATA\Vivaldi\Application\vivaldi.exe" 0 VivaldiDetected
    StrCpy $FoundVivaldi "1"
    StrCpy $VivaldiPath "$LOCALAPPDATA\Vivaldi\Application\vivaldi.exe"
  VivaldiDetected:

  ; --- Firefox ---
  IfFileExists "$PROGRAMFILES\Mozilla Firefox\firefox.exe" 0 +3
    StrCpy $FoundFirefox "1"
    StrCpy $FirefoxPath "$PROGRAMFILES\Mozilla Firefox\firefox.exe"
    Goto FirefoxDetected
  IfFileExists "$LOCALAPPDATA\Mozilla Firefox\firefox.exe" 0 FirefoxDetected
    StrCpy $FoundFirefox "1"
    StrCpy $FirefoxPath "$LOCALAPPDATA\Mozilla Firefox\firefox.exe"
  FirefoxDetected:

  ; ============================================================
  ; CHROMIUM EXTENSION INSTALL (Registry policy method)
  ; ============================================================

  ; ============================================================
  ; CHROMIUM EXTENSION INSTALL (Admin — Registry Policy)
  ; With admin rights, we can use HKLM which Chrome requires
  ; for auto-install via Group Policy.
  ; ============================================================

  ; --- Chrome (HKLM Policy — Admin only) ---
  StrCmp $FoundChrome "0" SkipChrome
    ReadRegDword $0 HKLM "Software\Google\Chrome" "Installed"
    ; Chrome extension ID from generated RSA key
    StrCpy $0 "oacdlfdjmjepdjgcjhdihbfemioifhao"
    WriteRegStr HKLM "Software\Policies\Google\Chrome\ExtensionInstallForcelist" "1" "$0;https://clients2.google.com/service/update2/crx"
    ; Also set for unpacked load (as fallback)
    WriteRegStr HKCU "Software\Google\Chrome\Extensions\$0" "path" "$ExtPath"
    WriteRegStr HKCU "Software\Google\Chrome\Extensions\$0" "version" "1.3.0"
    CreateShortCut "$DESKTOP\IDMM - Chrome.lnk" "$ChromePath" '--load-extension="$ExtPath"' "" "" SW_SHOWNORMAL "" "IDMM - Chrome"
  SkipChrome:

  ; --- Edge (HKLM Policy — Admin only) ---
  StrCmp $FoundEdge "0" SkipEdge
    StrCpy $0 "oacdlfdjmjepdjgcjhdihbfemioifhao"
    WriteRegStr HKLM "Software\Policies\Microsoft\Edge\ExtensionInstallForcelist" "1" "$0;https://edge.microsoft.com/extensionwebstorebase/v1/crx"
    WriteRegStr HKCU "Software\Microsoft\Edge\Extensions\$0" "path" "$ExtPath"
    WriteRegStr HKCU "Software\Microsoft\Edge\Extensions\$0" "version" "1.3.0"
    CreateShortCut "$DESKTOP\IDMM - Edge.lnk" "$EdgePath" '--load-extension="$ExtPath"' "" "" SW_SHOWNORMAL "" "IDMM - Edge"
  SkipEdge:

  ; --- Brave ---
  StrCmp $FoundBrave "0" SkipBrave
    CreateShortCut "$DESKTOP\IDMM - Brave.lnk" "$BravePath" '--load-extension="$ExtPath" --no-first-run' "" "" SW_SHOWNORMAL "" "IDMM - Brave"
  SkipBrave:

  ; --- Opera ---
  StrCmp $FoundOpera "0" SkipOpera
    CreateShortCut "$DESKTOP\IDMM - Opera.lnk" "$OperaPath" '--load-extension="$ExtPath" --no-first-run' "" "" SW_SHOWNORMAL "" "IDMM - Opera"
  SkipOpera:

  ; --- Vivaldi ---
  StrCmp $FoundVivaldi "0" SkipVivaldi
    CreateShortCut "$DESKTOP\IDMM - Vivaldi.lnk" "$VivaldiPath" '--load-extension="$ExtPath" --no-first-run' "" "" SW_SHOWNORMAL "" "IDMM - Vivaldi"
  SkipVivaldi:

  ; ============================================================
  ; FIREFOX EXTENSION INSTALL (Registry policy method)
  ; ============================================================
  StrCmp $FoundFirefox "0" SkipFirefox
    ; Firefox supports sideloading via registry (unpacked extension)
    WriteRegStr HKCU "Software\Mozilla\Firefox\Extensions" "idmm-extension" "$ExtPath"
    ; Also try to copy .xpi if available (Firefox reads .xpi from this registry path)
    ; The .xpi is included as extraResource and extracted to $INSTDIR
    IfFileExists "$INSTDIR\IDMM-Extension-1.2.4.xpi" 0 SkipXpiCopy
      ; Try to install into active Firefox profiles
      nsExec::ExecToStack 'cmd /c for /d %%P in ("%APPDATA%\Mozilla\Firefox\Profiles\*.default*") do copy /Y "$INSTDIR\IDMM-Extension-1.2.4.xpi" "%%P\extensions\{idmm-extension-id}@idmm.xpi" >nul 2>&1'
      Pop $0
    SkipXpiCopy:
    CreateShortCut "$DESKTOP\IDMM - Firefox.lnk" "$FirefoxPath" '--load-extension="$ExtPath"' "" "" SW_SHOWNORMAL "" "IDMM - Firefox"
  SkipFirefox:

  ; ============================================================
  ; LAUNCH HELPER SCRIPTS (backward compat + fallback)
  ; ============================================================

  ; --- Chrome launch helper ---
  StrCmp $FoundChrome "0" SkipChromeBat
    FileOpen $0 "$INSTDIR\launch-chrome.bat" w
    FileWrite $0 '@echo off$\r$\n'
    FileWrite $0 'REM Launch Chrome with IDMM extension$\r$\n'
    FileWrite $0 'set EXT_PATH=%~dp0resources\extension$\r$\n'
    FileWrite $0 '"${ChromePath}" --load-extension="%EXT_PATH%" --no-first-run$\r$\n'
    FileClose $0
  SkipChromeBat:

  ; --- Edge launch helper ---
  StrCmp $FoundEdge "0" SkipEdgeBat
    FileOpen $0 "$INSTDIR\launch-edge.bat" w
    FileWrite $0 '@echo off$\r$\n'
    FileWrite $0 'REM Launch Edge with IDMM extension$\r$\n'
    FileWrite $0 'set EXT_PATH=%~dp0resources\extension$\r$\n'
    FileWrite $0 '"${EdgePath}" --load-extension="%EXT_PATH%" --no-first-run$\r$\n'
    FileClose $0
  SkipEdgeBat:

  ; --- Brave launch helper ---
  StrCmp $FoundBrave "0" SkipBraveBat
    FileOpen $0 "$INSTDIR\launch-brave.bat" w
    FileWrite $0 '@echo off$\r$\n'
    FileWrite $0 'REM Launch Brave with IDMM extension$\r$\n'
    FileWrite $0 'set EXT_PATH=%~dp0resources\extension$\r$\n'
    FileWrite $0 '"${BravePath}" --load-extension="%EXT_PATH%" --no-first-run$\r$\n'
    FileClose $0
  SkipBraveBat:

  ; --- Opera launch helper ---
  StrCmp $FoundOpera "0" SkipOperaBat
    FileOpen $0 "$INSTDIR\launch-opera.bat" w
    FileWrite $0 '@echo off$\r$\n'
    FileWrite $0 'REM Launch Opera with IDMM extension$\r$\n'
    FileWrite $0 'set EXT_PATH=%~dp0resources\extension$\r$\n'
    FileWrite $0 '"${OperaPath}" --load-extension="%EXT_PATH%" --no-first-run$\r$\n'
    FileClose $0
  SkipOperaBat:

  ; --- Vivaldi launch helper ---
  StrCmp $FoundVivaldi "0" SkipVivaldiBat
    FileOpen $0 "$INSTDIR\launch-vivaldi.bat" w
    FileWrite $0 '@echo off$\r$\n'
    FileWrite $0 'REM Launch Vivaldi with IDMM extension$\r$\n'
    FileWrite $0 'set EXT_PATH=%~dp0resources\extension$\r$\n'
    FileWrite $0 '"${VivaldiPath}" --load-extension="%EXT_PATH%" --no-first-run$\r$\n'
    FileClose $0
  SkipVivaldiBat:

  ; ============================================================
  ; PROTOCOL HANDLER & FILE ASSOCIATION
  ; ============================================================
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
    DetailPrint "[OK] Chrome extension registered"
    Goto LogEdge
  LogNoChrome:
    DetailPrint "[--] Chrome not found, skipped"

  LogEdge:
  StrCmp $FoundEdge "0" LogNoEdge
    DetailPrint "[OK] Edge extension registered"
    Goto LogBrave
  LogNoEdge:
    DetailPrint "[--] Edge not found, skipped"

  LogBrave:
  StrCmp $FoundBrave "0" LogNoBrave
    DetailPrint "[OK] Brave shortcut created"
    Goto LogOpera
  LogNoBrave:
    DetailPrint "[--] Brave not found, skipped"

  LogOpera:
  StrCmp $FoundOpera "0" LogNoOpera
    DetailPrint "[OK] Opera shortcut created"
    Goto LogVivaldi
  LogNoOpera:
    DetailPrint "[--] Opera not found, skipped"

  LogVivaldi:
  StrCmp $FoundVivaldi "0" LogNoVivaldi
    DetailPrint "[OK] Vivaldi shortcut created"
    Goto LogFirefox
  LogNoVivaldi:
    DetailPrint "[--] Vivaldi not found, skipped"

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

  ; --- Chrome ---
  DeleteRegKey HKCU "Software\Google\Chrome\Extensions\oacdlfdjmjepdjgcjhdihbfemioifhao"
  DeleteRegKey HKLM "Software\Policies\Google\Chrome\ExtensionInstallForcelist"

  ; --- Edge ---
  DeleteRegKey HKCU "Software\Microsoft\Edge\Extensions\oacdlfdjmjepdjgcjhdihbfemioifhao"
  DeleteRegKey HKLM "Software\Policies\Microsoft\Edge\ExtensionInstallForcelist"

  ; --- Brave (no registry entry, just shortcuts) ---

  ; --- Opera (no registry entry, just shortcuts) ---

  ; --- Vivaldi (no registry entry, just shortcuts) ---

  ; --- Firefox ---
  DeleteRegValue HKCU "Software\Mozilla\Firefox\Extensions" "idmm-extension"

  ; ============================================================
  ; REMOVE FIREFOX .XPI FROM PROFILES
  ; ============================================================
  nsExec::ExecToStack 'cmd /c for /d %%P in ("%APPDATA%\Mozilla\Firefox\Profiles\*.default*") do del /q "%%P\extensions\idmm-extension@glitchworlds.xpi" 2>nul'
  Pop $0
  Pop $1

  ; ============================================================
  ; REMOVE PROTOCOL HANDLER & FILE ASSOCIATION
  ; ============================================================
  DeleteRegKey HKCU "Software\Classes\idmm"
  DeleteRegKey HKCU "Software\Classes\.idmm"
  DeleteRegKey HKCU "Software\Classes\IDMM.DownloadConfig"

  ; ============================================================
  ; REMOVE DESKTOP SHORTCUTS
  ; ============================================================
  Delete "$DESKTOP\IDMM - Chrome.lnk"
  Delete "$DESKTOP\IDMM - Edge.lnk"
  Delete "$DESKTOP\IDMM - Brave.lnk"
  Delete "$DESKTOP\IDMM - Opera.lnk"
  Delete "$DESKTOP\IDMM - Vivaldi.lnk"
  Delete "$DESKTOP\IDMM - Firefox.lnk"

  ; ============================================================
  ; REMOVE LAUNCH HELPER SCRIPTS
  ; ============================================================
  Delete "$INSTDIR\launch-chrome.bat"
  Delete "$INSTDIR\launch-edge.bat"
  Delete "$INSTDIR\launch-brave.bat"
  Delete "$INSTDIR\launch-opera.bat"
  Delete "$INSTDIR\launch-vivaldi.bat"

  ; ============================================================
  ; REMOVE .XPI FROM INSTALL DIR
  ; ============================================================
  Delete "$INSTDIR\IDMM-Extension-1.2.4.xpi"

  ; ============================================================
  ; REMOVE USER DATA
  ; ============================================================
  RMDir /r "$PROFILE\.idmm"

!macroend
