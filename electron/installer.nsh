; IDMAM NSIS Custom Installer Script
; Provides: auto-start on boot, Chrome extension helper, uninstall cleanup,
;           upgrade/reinstall detection, and user data management

!macro customInstall
  ; === Close any running IDMAM instance ===
  nsExec::ExecToStack 'taskkill /F /IM IDMAM.exe'
  Pop $0 ; exit code (ignore — process may not be running)
  Pop $1 ; stdout
  Sleep 1000

  ; === Always upgrade: install over existing, preserve user data ===
  ; No dialog — just install. User data (%USERPROFILE%\.idmam) is always preserved.

  ; === Auto-start IDMAM on Windows boot ===
  ; Write to HKCU so it works without admin elevation
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "IDMAM" '"$INSTDIR\IDMAM.exe" --hidden'

  ; === Create Chrome extension batch helper ===
  ; This batch file launches Chrome with the IDMAM extension loaded
  FileOpen $0 "$INSTDIR\launch-chrome.bat" w
  FileWrite $0 '@echo off$\r$\n'
  FileWrite $0 'REM Launch Chrome with IDMAM extension$\r$\n'
  FileWrite $0 'set EXT_PATH=%~dp0resources\extension$\r$\n'
  FileWrite $0 'set CHROME_PATH=$\r$\n'
  FileWrite $0 'REM Try common Chrome install locations$\r$\n'
  FileWrite $0 'if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set CHROME_PATH=%ProgramFiles%\Google\Chrome\Application\chrome.exe$\r$\n'
  FileWrite $0 'if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set CHROME_PATH=%LocalAppData%\Google\Chrome\Application\chrome.exe$\r$\n'
  FileWrite $0 'if "%CHROME_PATH%"=="" ($\r$\n'
  FileWrite $0 '  echo Chrome not found. Please install Google Chrome first.$\r$\n'
  FileWrite $0 '  pause$\r$\n'
  FileWrite $0 '  exit /b 1$\r$\n'
  FileWrite $0 ')$\r$\n'
  FileWrite $0 'echo Launching Chrome with IDMAM extension...$\r$\n'
  FileWrite $0 '"%CHROME_PATH%" --load-extension="%EXT_PATH%" --no-first-run$\r$\n'
  FileClose $0

  ; === Install Chrome extension via registry (enterprise policy) ===
  ; This registers the extension for auto-install in Chrome
  WriteRegStr HKCU "Software\Google\Chrome\Extensions\idmam-extension" "path" "$INSTDIR\resources\extension"
  WriteRegStr HKCU "Software\Google\Chrome\Extensions\idmam-extension" "version" "1.1.0"

  ; === Write IDMAM protocol handler ===
  WriteRegStr HKCU "Software\Classes\idmam" "" "URL:IDMAM Download Protocol"
  WriteRegStr HKCU "Software\Classes\idmam" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\idmam\shell\open\command" "" '"$INSTDIR\IDMAM.exe" "%1"'

  ; === File association for .idmam files ===
  WriteRegStr HKCU "Software\Classes\.idmam" "" "IDMAM.DownloadConfig"
  WriteRegStr HKCU "Software\Classes\IDMAM.DownloadConfig" "" "IDMAM Download Configuration"
  WriteRegStr HKCU "Software\Classes\IDMAM.DownloadConfig\DefaultIcon" "" '"$INSTDIR\IDMAM.exe",0'
  WriteRegStr HKCU "Software\Classes\IDMAM.DownloadConfig\shell\open\command" "" '"$INSTDIR\IDMAM.exe" "%1"'

!macroend

!macro customUnInstall
  ; === Close any running IDMAM instance ===
  nsExec::ExecToStack 'taskkill /F /IM IDMAM.exe'
  Pop $0
  Pop $1
  Sleep 1000

  ; === Remove auto-start registry entry ===
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "IDMAM"

  ; === Remove Chrome extension registry ===
  DeleteRegKey HKCU "Software\Google\Chrome\Extensions\idmam-extension"

  ; === Remove protocol handler ===
  DeleteRegKey HKCU "Software\Classes\idmam"

  ; === Remove file association ===
  DeleteRegKey HKCU "Software\Classes\.idmam"
  DeleteRegKey HKCU "Software\Classes\IDMAM.DownloadConfig"

  ; === Remove launch helper ===
  Delete "$INSTDIR\launch-chrome.bat"

  ; === Always remove user data (full uninstall) ===
  RMDir /r "$PROFILE\.idmam"

!macroend
