@echo off
set PATH=C:\Users\DELL\.cargo\bin;%PATH%
set PATH=C:\Program Files\nodejs;%PATH%

echo [1/3] Copying web assets to dist...
if not exist dist mkdir dist
copy /Y index.html dist\ >nul
copy /Y style.css dist\ >nul
copy /Y app.js dist\ >nul
xcopy /E /I /Y lib dist\lib >nul

echo [2/3] Building Tauri app...
cd src-tauri
cd ..
npx tauri build

echo [3/3] Build complete!
echo Output: src-tauri\target\release\bundle\
pause
