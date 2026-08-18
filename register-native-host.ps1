$manifestPath = "C:\Users\bobby\.idmm\com.idmm.native_host.json"
$dir = [System.IO.Path]::GetDirectoryName($manifestPath)
if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force }

$json = @'
{
  "name": "com.idmm.native_host",
  "description": "IDMM Download Manager Native Messaging Host",
  "path": "D:\\IDMM\\core-engine-rust\\target\\release\\idmm-core.exe",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://*",
    "chrome-extension://idmm-extension@glitchworlds/"
  ]
}
'@

Set-Content -Path $manifestPath -Value $json -Force

New-Item -Path "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.idmm.native_host" -Force | Out-Null
Set-ItemProperty -Path "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.idmm.native_host" -Name "(Default)" -Value $manifestPath

New-Item -Path "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.idmm.native_host" -Force | Out-Null
Set-ItemProperty -Path "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.idmm.native_host" -Name "(Default)" -Value $manifestPath

Write-Host "Native Messaging Host registered successfully in Chrome and Edge registry!"
