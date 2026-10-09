@echo off
cd /d "%~dp0"
if not exist ".next\BUILD_ID" (
  echo Preparando o sistema pela primeira vez...
  call npm run build || goto erro
)
echo Sistema de orcamentos: http://localhost:3000  (feche esta janela para parar)
start "" http://localhost:3000
call npm start
goto fim
:erro
echo Falha ao preparar o sistema. Veja a mensagem acima.
pause
:fim
