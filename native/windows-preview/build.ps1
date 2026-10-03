param(
    [Parameter(Mandatory=$true)][string]$Zig,
    [switch]$FetchDependencies
)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$out = Join-Path $repo 'outputs/windows-preview'
$deps = Join-Path $out 'deps'
New-Item -ItemType Directory -Force -Path $out,$deps | Out-Null
foreach ($entry in (Get-Content (Join-Path $PSScriptRoot 'dependencies.json') -Raw | ConvertFrom-Json)) {
    $target = Join-Path $deps $entry.name
    if (!(Test-Path -LiteralPath $target)) {
        if (!$FetchDependencies) { throw "Dependency missing: $($entry.name). Use -FetchDependencies." }
        Invoke-WebRequest -Uri $entry.url -OutFile $target
    }
    if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) { throw "Dependency checksum mismatch: $($entry.name)" }
}
Set-Content -LiteralPath (Join-Path $deps 'miniz_export.h') -Value '#define MINIZ_EXPORT' -Encoding ascii
$common = @('-target','x86_64-windows-gnu','-O2','-DNOMINMAX','-DMINIZ_NO_STDIO','-DMINIZ_NO_ARCHIVE_WRITING_APIS','-DMINIZ_NO_ZLIB_APIS','-I',$deps)
$objects = @()
foreach ($file in @('miniz.c','miniz_tinfl.c','miniz_zip.c')) {
    $obj = Join-Path $out ($file + '.obj')
    & $Zig cc @common -c (Join-Path $deps $file) -o $obj
    if ($LASTEXITCODE) { throw "C compilation failed: $file" }
    $objects += $obj
}
$src = Join-Path $PSScriptRoot 'src'
$base = @((Join-Path $src 'archive.cpp'),(Join-Path $src 'image.cpp'))
$libs = @('-lole32','-luuid','-lgdi32','-lshlwapi','-lwindowscodecs','-lbcrypt')
& $Zig c++ @common -std=c++17 @base (Join-Path $src 'thumbnail.cpp') (Join-Path $src 'thumbnail.def') @objects @libs -shared -o (Join-Path $out 'DsfThumbnail.dll')
if ($LASTEXITCODE) { throw 'Thumbnail provider build failed' }
& $Zig c++ @common -std=c++17 @base (Join-Path $src 'check.cpp') @objects @libs -municode -static -o (Join-Path $out 'dsf-thumbnail-check.exe')
if ($LASTEXITCODE) { throw 'Thumbnail checker build failed' }
Copy-Item -LiteralPath (Join-Path $deps 'LICENSE') -Destination (Join-Path $out 'miniz-LICENSE.txt')
Copy-Item -LiteralPath (Join-Path $deps 'json-LICENSE.MIT') -Destination (Join-Path $out 'json-LICENSE.txt')
Write-Output 'Built Windows x64 thumbnail prototype. Nothing was registered with Windows.'
