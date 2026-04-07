@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo 1) Закройте вкладки с этим проектом или остановите "npm install" (Ctrl+C).
echo 2) Если удаление снова падает — закройте Cursor/VS Code и запустите этот файл двойным щелчком.
echo.

npx --yes rimraf@6 node_modules package-lock.json
if errorlevel 1 (
  echo.
  echo Не удалось удалить node_modules. Часто мешает антивирус или блокировка файлов.
  echo Попробуйте: перезагрузка ПК, исключение папки проекта из проверки Defender, более короткий путь (например C:\dev\ab).
  pause
  exit /b 1
)

call npm cache clean --force
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo Установка завершилась с ошибкой.
  pause
  exit /b 1
)

echo.
echo Готово. Запуск: npm run dev
echo.
pause
