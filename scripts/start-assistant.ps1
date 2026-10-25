# Starts the local assistant service (RAG API on port 9101).
# Ollama is not started here: open the Ollama app yourself.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root '.venv-ml\Scripts\python.exe'
$model = if ($env:LLM_MODEL) { $env:LLM_MODEL } else { 'qwen2.5:3b-instruct' }

if (-not (Test-Path $python)) {
    Write-Host 'Missing .venv-ml. Create it first (see README, "Optional local services").' -ForegroundColor Red
    exit 1
}

if (Get-NetTCPConnection -LocalPort 9101 -State Listen -ErrorAction SilentlyContinue) {
    Write-Host 'Port 9101 is already in use; the assistant service is probably running.' -ForegroundColor Yellow
    exit 0
}

try {
    $tags = Invoke-RestMethod -Uri 'http://localhost:11434/api/tags' -TimeoutSec 3
    if ($tags.models.name -notcontains $model) {
        Write-Host "Ollama is running but $model is not installed. Run: ollama pull $model" -ForegroundColor Yellow
    } else {
        Write-Host "Ollama is running with $model." -ForegroundColor Green
    }
} catch {
    Write-Host 'Ollama is not running. Open the Ollama app; the assistant panel will say so until you do.' -ForegroundColor Yellow
}

Write-Host 'Starting the assistant service on http://127.0.0.1:9101 (Ctrl+C to stop)...'
Set-Location $root
& $python -m uvicorn main:app --app-dir local-llm/rag-api --host 127.0.0.1 --port 9101
