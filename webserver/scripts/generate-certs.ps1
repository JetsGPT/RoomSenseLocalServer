# PowerShell script to generate SSL certificates for the webserver
# This creates self-signed certificates for HTTPS

$ErrorActionPreference = "Stop"

# Get script directory and project root
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $ScriptDir)
Set-Location $ProjectRoot

$CertDir = "certs"
$KeyFile = Join-Path $CertDir "server.key"
$CertFile = Join-Path $CertDir "server.cert"

# Create certs directory if it doesn't exist
if (-not (Test-Path $CertDir)) {
    New-Item -ItemType Directory -Path $CertDir | Out-Null
}

# Check if certificates already exist
if ((Test-Path $KeyFile) -and (Test-Path $CertFile)) {
    Write-Host "Certificates already exist at:" -ForegroundColor Yellow
    Write-Host "  - $KeyFile"
    Write-Host "  - $CertFile"
    Write-Host ""
    $response = Read-Host "Do you want to regenerate them? (y/N)"
    if ($response -ne "y" -and $response -ne "Y") {
        Write-Host "Keeping existing certificates." -ForegroundColor Green
        exit 0
    }
    Write-Host "Regenerating certificates..." -ForegroundColor Yellow
}

# Check if OpenSSL is available
if (-not (Get-Command openssl -ErrorAction SilentlyContinue)) {
    Write-Host "Error: OpenSSL is not installed or not in PATH" -ForegroundColor Red
    Write-Host ""
    Write-Host "On Windows, you can:" -ForegroundColor Yellow
    Write-Host "  1. Install OpenSSL via Git Bash (comes with Git for Windows)"
    Write-Host "  2. Install OpenSSL via Chocolatey: choco install openssl"
    Write-Host "  3. Use WSL (Windows Subsystem for Linux)"
    Write-Host ""
    Write-Host "Alternatively, generate certificates manually:"
    Write-Host "  openssl req -x509 -newkey rsa:4096 -keyout certs/server.key -out certs/server.cert -days 365 -nodes" -ForegroundColor Cyan
    exit 1
}

# Generate self-signed certificate
Write-Host "Generating self-signed SSL certificate..." -ForegroundColor Cyan
openssl req -x509 -newkey rsa:4096 `
    -keyout $KeyFile `
    -out $CertFile `
    -days 365 `
    -nodes `
    -subj "/C=US/ST=State/L=City/O=RoomSense/CN=localhost"

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✅ SSL certificates generated successfully!" -ForegroundColor Green
    Write-Host "   Key:  $KeyFile"
    Write-Host "   Cert: $CertFile"
    Write-Host ""
    Write-Host "⚠️  Note: These are self-signed certificates for development." -ForegroundColor Yellow
    Write-Host "   For production, use certificates from a trusted CA."
} else {
    Write-Host "Error: Failed to generate certificates" -ForegroundColor Red
    exit 1
}

