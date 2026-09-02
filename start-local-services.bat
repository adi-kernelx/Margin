@echo off
REM === Local Development Startup Script ===
REM Run this to start local-llm services without Docker issues

echo Starting local services...

REM Check if running containers exist (after Docker restart)
echo.
echo === Starting Docker containers ===
docker start qdrant typesense llm-runtime rag-api 2>nul

REM Wait for services
echo.
echo Waiting for services to start...
timeout /t 10 /nobreak

REM Check health
echo.
echo === Checking service health ===

curl -s http://localhost:9101/health && echo  [RAG-API OK] || echo  [RAG-API FAILED]
curl -s http://localhost:6333/health && echo  [Qdrant OK] || echo  [Qdrant FAILED]
curl -s http://localhost:8108/health && echo  [Typesense OK] || echo  [Typesense FAILED]
curl -s http://localhost:8081/health && echo  [LLM-Runtime OK] || echo  [LLM-Runtime FAILED]

echo.
echo === Done ===
pause
