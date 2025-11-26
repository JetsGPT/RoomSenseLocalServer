<#
.SYNOPSIS
    Generates self-signed certificates for RoomSense using OpenSSL.
    (Copy-Paste Safe Version)
#>

$ErrorActionPreference = "Stop"

# 1. Reliable Path Resolution
$ScriptDir = $PSScriptRoot
$ParentDir = Split-Path -Parent $ScriptDir
$CertDir = Join-Path -Path $ParentDir -ChildPath "certs"

$KeyFile = Join-Path -Path $CertDir -ChildPath "roomsense.local.key"
$CertFile = Join-Path -Path $CertDir -ChildPath "roomsense.local.crt"
$OpenSslCnf = Join-Path -Path $CertDir -ChildPath "openssl_roomsense.cnf"

Write-Host "📍 Script location: $ScriptDir"
Write-Host "📂 Cert output dir: $CertDir"

# 2. Create directory if missing
if (-not (Test-Path -Path $CertDir)) {
    New-Item -ItemType Directory -Path $CertDir -Force | Out-Null
}

# 3. Check for existing certs
if ((Test-Path -Path $KeyFile) -and (Test-Path -Path $CertFile)) {
    Write-Host "✅ Certificates already exist in $CertDir" -ForegroundColor Green
    Write-Host "   Skipping generation to prevent overwrite."
    exit 0
}

# Check for OpenSSL
if (-not (Get-Command openssl -ErrorAction SilentlyContinue)) {
    Write-Error "OpenSSL is not found in your PATH."
    exit 1
}

# 4. Generate Configuration (Using a List to prevent indentation errors)
$ConfigLines = @(
    "[ req ]",
    "default_bits       = 4096",
    "distinguished_name = dn",
    "req_extensions     = req_ext",
    "x509_extensions    = req_ext",
    "prompt             = no",
    "",
    "[ dn ]",
    "C  = US",
    "O  = RoomSense",
    "CN = roomsense.local",
    "",
    "[ req_ext ]",
    "subjectAltName = @alt_names",
    "",
    "[ alt_names ]",
    "DNS.1 = roomsense.local",
    "DNS.2 = localhost"
)

# Write config using ASCII to ensure OpenSSL compatibility
$ConfigLines | Set-Content -Path $OpenSslCnf -Encoding Ascii

# 5. Generate Certificates
Write-Host "🔑 Generating self-signed certificate..."

# We execute this as a single command line to avoid backtick/whitespace issues
& openssl req -x509 -newkey rsa:4096 -sha256 -days 3650 -nodes -keyout "$KeyFile" -out "$CertFile" -config "$OpenSslCnf"

if ($LASTEXITCODE -ne 0) {
    Write-Error "OpenSSL command failed."
    exit $LASTEXITCODE
}

# Cleanup config
Remove-Item -Path $OpenSslCnf -Force

# 6. Set permissions (Windows ACL)
try {
    $Acl = Get-Acl -Path $KeyFile
    $Acl.SetAccessRuleProtection($true, $false)
    $Rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
        [System.Security.Principal.WindowsIdentity]::GetCurrent().Name,
        "FullControl",
        "Allow"
    )
    $Acl.AddAccessRule($Rule)
    Set-Acl -Path $KeyFile -AclObject $Acl
    Write-Host "🔒 Key file permissions restricted to current user." -ForegroundColor Gray
}
catch {
    Write-Warning "Could not restrict file permissions automatically."
}

Write-Host ""
Write-Host "✅ Success! Certificates generated:" -ForegroundColor Green
Write-Host "   $CertFile"
Write-Host "   $KeyFile"