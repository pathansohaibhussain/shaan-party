# Shaan Party launcher: starts the Spring Boot server and the ngrok tunnel.
# Run with:  powershell -ExecutionPolicy Bypass -File .\start-party.ps1   (or just double-click start-party.bat)
# Settings live in party.config.json next to this script (not committed to git).

$Root      = $PSScriptRoot
$ServerDir = Join-Path $Root 'server-spring'
$Config    = Join-Path $Root 'party.config.json'

# --- settings ---
$NgrokUrl   = ''
$Port       = 8080
$YoutubeKey = ''
if (Test-Path $Config) {
    try {
        $cfg = Get-Content $Config -Raw | ConvertFrom-Json
        if ($cfg.ngrokUrl) { $NgrokUrl = $cfg.ngrokUrl.TrimEnd('/') }
        if ($cfg.port)     { $Port = [int]$cfg.port }
        if ($cfg.youtubeApiKey) { $YoutubeKey = ([string]$cfg.youtubeApiKey).Trim() }
    } catch {
        Write-Host "Could not read $Config : $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "No party.config.json found. Copy party.config.example.json to party.config.json and set your ngrok URL." -ForegroundColor Yellow
    Write-Host "Continuing without a tunnel (friends outside your network will not be able to join)." -ForegroundColor Yellow
}

# --- sanity checks ---
if (-not (Test-Path $ServerDir)) {
    Write-Host "Server folder not found: $ServerDir" -ForegroundColor Red
    exit 1
}
$needed = @('mvn')
if ($NgrokUrl) { $needed += 'ngrok' }
foreach ($cmd in $needed) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Write-Host "'$cmd' was not found. Install it and make sure it is in your PATH." -ForegroundColor Red
        exit 1
    }
}

# --- is the port already taken? ---
$busy = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($busy) {
    Write-Host "Port $Port is already in use (server already running?). Close it first." -ForegroundColor Yellow
    exit 1
}

# --- YouTube search key (web room). The server window inherits it, so it never appears on a command line. ---
if ($YoutubeKey) {
    $env:YOUTUBE_API_KEY = $YoutubeKey
    Write-Host "YouTube search: on" -ForegroundColor Green
} else {
    Write-Host "YouTube search: off (add youtubeApiKey to party.config.json to turn it on; pasting links still works)" -ForegroundColor Yellow
}

# --- 1. Spring Boot server in its own window ---
Write-Host "Starting Spring Boot server..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "`$Host.UI.RawUI.WindowTitle = 'Shaan Party Server'; `$env:PORT = '$Port'; Set-Location '$ServerDir'; mvn spring-boot:run"
)

# --- 2. wait until the server accepts connections (up to 3 minutes) ---
$ready = $false
for ($i = 0; $i -lt 90; $i++) {
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $client.Connect("127.0.0.1", $Port)
        $client.Close()
        $ready = $true
        break
    } catch {
        Start-Sleep -Seconds 2
    }
}
if (-not $ready) {
    Write-Host "Server did not start in time. Check the 'Shaan Party Server' window for errors." -ForegroundColor Red
    exit 1
}
Write-Host "Server is up on port $Port." -ForegroundColor Green

# --- 3. ngrok tunnel in its own window ---
if ($NgrokUrl) {
    Write-Host "Starting ngrok tunnel..." -ForegroundColor Cyan
    Start-Process powershell -ArgumentList @(
        "-NoExit", "-Command",
        "`$Host.UI.RawUI.WindowTitle = 'Shaan Party ngrok'; ngrok http $Port --url $NgrokUrl"
    )
    $ws = $NgrokUrl -replace '^https://', 'wss://'
    Write-Host ""
    Write-Host "Party server is running." -ForegroundColor Green
    Write-Host "Server URL for the extension popup: $ws"
    Write-Host "Web room (phones, no extension):    $NgrokUrl/app"
} else {
    Write-Host ""
    Write-Host "Party server is running locally." -ForegroundColor Green
    Write-Host "Server URL for the extension popup: ws://localhost:$Port"
    Write-Host "Web room:                           http://localhost:$Port/app"
}
Write-Host "To stop: close the 'Shaan Party Server' and 'Shaan Party ngrok' windows (or press Ctrl+C in each)."
