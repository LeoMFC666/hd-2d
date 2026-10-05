Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Ensure emsdk environment
& 'C:\emsdk\emsdk_env.bat' | Out-Null

$Project = Split-Path -Parent $MyInvocation.MyCommand.Definition
Write-Host "Project root: $Project"

$buildDir = Join-Path $Project '.tmp\mgba-build'
$cmakeDir = Join-Path $Project '.tmp\mgba-cmake'
$outDir = Join-Path $Project 'dist\mgba'

New-Item -ItemType Directory -Force -Path $buildDir, $cmakeDir, $outDir | Out-Null

# Clone mgba if needed
if (-not (Test-Path (Join-Path $buildDir '.git'))) {
    Write-Host 'Cloning mGBA...'
    git clone https://github.com/mgba-emu/mgba.git $buildDir
}

# Checkout pinned ref
$ref = 'c034660f007c543233f1cadeb0ca13c71afd8f41'
git -C $buildDir fetch --quiet origin $ref
git -C $buildDir checkout --quiet $ref

# Configure with emcmake
Write-Host 'Running emcmake cmake...'
$emcmake = 'C:\emsdk\upstream\emscripten\emcmake.exe'
if (-not (Test-Path $emcmake)) { Write-Error "emcmake not found at $emcmake"; exit 1 }
Write-Host "Running emcmake cmake using: $emcmake"
& $emcmake cmake -S $buildDir -B $cmakeDir -DCMAKE_BUILD_TYPE=Release -DCMAKE_C_FLAGS='-O3 -D_GNU_SOURCE -DDISABLE_THREADING' -DBUILD_STATIC=ON -DBUILD_SHARED=OFF -DDISABLE_FRONTENDS=ON -DDISABLE_DEPS=ON -DBUILD_QT=OFF -DBUILD_SDL=OFF -DBUILD_LIBRETRO=OFF -DBUILD_TEST=OFF -DBUILD_SUITE=OFF -DBUILD_GL=OFF -DBUILD_GLES2=OFF -DBUILD_GLES3=OFF -DUSE_PTHREADS=OFF -DUSE_ZLIB=OFF -DUSE_MINIZIP=OFF -DUSE_LIBZIP=OFF -DUSE_PNG=OFF -DUSE_SQLITE3=OFF -DUSE_FFMPEG=OFF -DUSE_ELF=OFF -DUSE_LZMA=OFF -DUSE_LUA=OFF -DUSE_JSON_C=OFF -DUSE_FREETYPE=OFF -DUSE_EDITLINE=OFF -DUSE_DISCORD_RPC=OFF -DUSE_EPOXY=OFF -DENABLE_SCRIPTING=OFF -DENABLE_DEBUGGERS=OFF

# Build libmgba
Write-Host 'Building libmgba...'
& cmake --build $cmakeDir --target mgba -j 4

# Find libmgba.a
$lib = Get-ChildItem -Path $cmakeDir -Filter libmgba.a -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $lib) { Write-Error 'libmgba.a not found'; exit 1 }
Write-Host 'Found lib:' $lib.FullName

# Link shim with emcc
Write-Host 'Linking shim with emcc...'
$args = @(
    '-O3',
    '-std=gnu11',
    "-I$($buildDir)\include",
    "-I$($cmakeDir)\include",
    '-D_GNU_SOURCE',
    '-DDISABLE_THREADING',
    '-DNDEBUG',
    '-Wno-deprecated-declarations',
    "$Project\scripts\shim\mgba_shim.c",
    $lib.FullName,
    '--no-entry',
    '-sMODULARIZE=1',
    '-sEXPORT_NAME=createMgbaModule',
    '-sENVIRONMENT=web,node',
    '-sALLOW_MEMORY_GROWTH=1',
    '-sINITIAL_MEMORY=67108864',
    '-sMAXIMUM_MEMORY=536870912',
    '-sSTACK_SIZE=1048576',
    '-sEXPORTED_FUNCTIONS=_malloc,_free',
    '-sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAP16,HEAPU32,UTF8ToString,stringToUTF8,lengthBytesUTF8',
    '-o',
    "$outDir\mgba.js"
)

$emcc = 'C:\emsdk\upstream\emscripten\emcc'
if (-not (Test-Path $emcc)) { Write-Error "emcc not found at $emcc"; exit 1 }
Write-Host "Invoking emcc: $emcc"
& $emcc @args

Write-Host 'Link complete. Output files:'
Get-ChildItem $outDir | Format-List Name,Length,FullName

# Verify exports in mgba.js
Write-Host 'Verifying exports in mgba.js...'
Select-String -Path (Join-Path $outDir 'mgba.js') -Pattern 'mgbawasm_bus_read8|mgbawasm_bus_read16|mgbawasm_bus_read32' -AllMatches | ForEach-Object { $_.Line }

Write-Host 'Done.'
