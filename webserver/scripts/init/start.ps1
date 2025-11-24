# PowerShell startup script for RoomSense Local Server
# This script initializes Docker Swarm, creates secrets, and starts containers
# Security: Uses Docker Swarm secrets for sensitive data

$ErrorActionPreference = "Stop"

# Get the project root directory (two levels up from this script)
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $ScriptDir)
Set-Location $ProjectRoot

# Colors for output (PowerShell)
function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Green
}

function Write-Warn {
    param([string]$Message)
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Write-Error {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

function Write-Step {
    param([string]$Message)
    Write-Host "[STEP] $Message" -ForegroundColor Blue
}

# Check if Docker is available
function Test-Docker {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Write-Error "Docker is not installed or not in PATH"
        exit 1
    }
    
    try {
        docker info | Out-Null
    } catch {
        Write-Error "Cannot connect to Docker daemon. Is Docker Desktop running?"
        exit 1
    }
}

# Initialize Docker Swarm if not already initialized
function Initialize-Swarm {
    Write-Step "Checking Docker Swarm status..."
    
    $swarmState = docker info --format '{{.Swarm.LocalNodeState}}' 2>$null
    if ($swarmState -eq "active") {
        Write-Info "Docker Swarm is already initialized"
        return
    }
    
    Write-Step "Initializing Docker Swarm..."
    try {
        docker swarm init --advertise-addr 127.0.0.1 2>&1 | Out-Null
        Write-Info "Docker Swarm initialized successfully"
    } catch {
        Write-Error "Failed to initialize Docker Swarm"
        exit 1
    }
}

# Generate cryptographically secure random secret
function New-SecureSecret {
    param([int]$Length = 64)
    
    # Use .NET RandomNumberGenerator for secure random bytes
    Add-Type -AssemblyName System.Security
    $rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
    $bytes = New-Object byte[] $Length
    $rng.GetBytes($bytes)
    
    # Convert to hex string
    $hex = ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
    return $hex
}

# Check if a secret exists in Docker Swarm
function Test-SecretExists {
    param([string]$SecretName)
    
    $secrets = docker secret ls --format "{{.Name}}" 2>$null
    return $secrets -contains $SecretName
}

# Create a Docker Swarm secret
function New-DockerSecret {
    param(
        [string]$SecretName,
        [string]$SecretValue
    )
    
    if (Test-SecretExists -SecretName $SecretName) {
        Write-Info "Secret '$SecretName' already exists, skipping creation"
        return
    }
    
    Write-Info "Creating secret '$SecretName'..."
    try {
        # Write the secret to a temp file using UTF8 without BOM
        # Set-Content -NoNewline prevents any CRLF or newline from being added
        # Always generate secrets programmatically - never copy/paste
        $tempFile = [System.IO.Path]::GetTempFileName()
        # Use UTF8NoBOM encoding to prevent BOM from being added
        $utf8NoBom = New-Object System.Text.UTF8Encoding $false
        [System.IO.File]::WriteAllText($tempFile, $SecretValue, $utf8NoBom)
        
        # Create the secret from the file (Docker reads it exactly as-is)
        docker secret create $SecretName $tempFile 2>&1 | Out-Null
        Remove-Item $tempFile -ErrorAction SilentlyContinue
        
        if ($LASTEXITCODE -eq 0) {
            Write-Info "Secret '$SecretName' created successfully"
        } else {
            Write-Error "Failed to create secret '$SecretName'"
            exit 1
        }
    } catch {
        Write-Error "Failed to create secret '$SecretName'"
        exit 1
    }
}

# Initialize all required secrets
function Initialize-Secrets {
    Write-Step "Initializing Docker Swarm secrets..."
    
    # SESSION_SECRET - Generate cryptographically secure random value
    # Recommended: 32+ bytes (64+ hex characters) for session secrets
    if (-not (Test-SecretExists -SecretName "session_secret")) {
        $sessionSecret = New-SecureSecret -Length 64
        New-DockerSecret -SecretName "session_secret" -SecretValue $sessionSecret
        Write-Info "Generated new SESSION_SECRET (128 hex characters)"
    } else {
        Write-Info "SESSION_SECRET already exists"
    }
    
    # PostgreSQL password - Generate secure password
    # Recommended: 32+ bytes for database passwords
    if (-not (Test-SecretExists -SecretName "pgpassword")) {
        $pgPassword = New-SecureSecret -Length 32
        New-DockerSecret -SecretName "pgpassword" -SecretValue $pgPassword
        Write-Info "Generated new PostgreSQL password (64 hex characters)"
    } else {
        Write-Info "PostgreSQL password already exists"
    }
    
    # InfluxDB password - Generate secure password
    # Recommended: 32+ bytes for database passwords
    if (-not (Test-SecretExists -SecretName "influx_password")) {
        $influxPassword = New-SecureSecret -Length 32
        New-DockerSecret -SecretName "influx_password" -SecretValue $influxPassword
        Write-Info "Generated new InfluxDB password (64 hex characters)"
    } else {
        Write-Info "InfluxDB password already exists"
    }
    
    # InfluxDB token - Generate cryptographically secure token
    # Recommended: 32+ bytes (64+ hex characters) for API tokens
    if (-not (Test-SecretExists -SecretName "influx_token")) {
        $influxToken = New-SecureSecret -Length 32
        New-DockerSecret -SecretName "influx_token" -SecretValue $influxToken
        Write-Info "Generated new InfluxDB token (64 hex characters)"
    } else {
        Write-Info "InfluxDB token already exists"
    }
    
    Write-Info "All secrets initialized successfully!"
}

# Main execution
function Main {
    Write-Host "===========================================" -ForegroundColor Cyan
    Write-Host "RoomSense Local Server - Secure Startup" -ForegroundColor Cyan
    Write-Host "===========================================" -ForegroundColor Cyan
    Write-Host ""
    
    # Check prerequisites
    Test-Docker
    
    # Initialize Docker Swarm
    Initialize-Swarm
    
    # Initialize secrets
    Initialize-Secrets
    
    Write-Host ""
    Write-Step "Building images (if needed)..."
    Write-Host ""
    
    # Build images first (docker stack deploy doesn't support build)
    # Build webserver image
    Write-Info "Building webserver image..."
    docker build -t roomsense-webserver:latest .
    
    # Build blegateway image
    Write-Info "Building blegateway image..."
    docker build -t roomsense-blegateway:latest ./bletomqtt
    
    Write-Host ""
    Write-Step "Deploying stack with Docker Swarm..."
    Write-Host ""
    
    # Deploy stack using docker stack deploy (required for Swarm secrets)
    # Stack name: roomsense
    docker stack deploy -c compose.yaml roomsense
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Info "Startup complete!"
        Write-Info "Stack deployed. Check status with: docker stack services roomsense"
        Write-Info "View logs with: docker service logs -f roomsense_<service-name>"
        Write-Info ""
        Write-Info "To view all services: docker stack ps roomsense"
    } else {
        Write-Error "Failed to deploy stack"
        exit 1
    }
}

Main

