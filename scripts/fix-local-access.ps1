$ErrorActionPreference = "Continue"
$log = "$env:TEMP\dokan-fix-local-access.log"
"Dokan local-access fix ran at $(Get-Date)" | Out-File $log

# 1. Pin *.localhost names to IPv4 loopback (a Windows service is squatting on [::1]:443)
$hostsPath = "C:\Windows\System32\drivers\etc\hosts"
$current = Get-Content $hostsPath -Raw
if ($current -notmatch "demo\.localhost") {
    Add-Content -Path $hostsPath -Value "`r`n# Dokan local dev (pin to IPv4)`r`n127.0.0.1 demo.localhost admin.localhost app.localhost www.localhost"
    "hosts entries added" | Out-File $log -Append
} else {
    "hosts entries already present" | Out-File $log -Append
}
ipconfig /flushdns | Out-Null
"dns flushed" | Out-File $log -Append

# 2. Trust Caddy's local dev CA so Brave/Chrome stop warning
$cert = "$env:TEMP\dokan-root.crt"
docker cp shop_system-caddy-1:/data/caddy/pki/authorities/local/root.crt $cert 2>&1 | Out-File $log -Append
if (Test-Path $cert) {
    Import-Certificate -FilePath $cert -CertStoreLocation Cert:\LocalMachine\Root 2>&1 | Out-File $log -Append
    "cert imported" | Out-File $log -Append
} else {
    "cert extract FAILED" | Out-File $log -Append
}
"DONE" | Out-File $log -Append
