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
# Always restore the hash-verified source archive, not a modified extracted copy.
& tar -xf (Join-Path $deps 'libwebp-1.6.0.tar.gz') -C $deps
if ($LASTEXITCODE) { throw 'WebP source extraction failed' }
$webp = Join-Path $deps 'libwebp-1.6.0'
$common = @('-target','x86_64-windows-gnu','-O2','-DNOMINMAX','-DMINIZ_NO_STDIO','-DMINIZ_NO_ARCHIVE_WRITING_APIS','-DMINIZ_NO_ZLIB_APIS','-I',$deps)
$objects = @()
foreach ($file in @('miniz.c','miniz_tinfl.c','miniz_zip.c')) {
    $obj = Join-Path $out ($file + '.obj')
    & $Zig cc @common -c (Join-Path $deps $file) -o $obj
    if ($LASTEXITCODE) { throw "C compilation failed: $file" }
    $objects += $obj
}
$src = Join-Path $PSScriptRoot 'src'
& node (Join-Path $PSScriptRoot 'build-badges.cjs')
if ($LASTEXITCODE) { throw 'File type badge generation failed' }
$badges = Join-Path $out 'badges.res'
& $Zig rc /i $out /fo $badges (Join-Path $src 'badges.rc')
if ($LASTEXITCODE) { throw 'File type badge resource compilation failed' }
$webpFiles = @(Get-ChildItem (Join-Path $webp 'src/dec') -Filter '*.c' | ForEach-Object { $_.FullName })
foreach ($name in @('alpha_processing','cpu','dec','dec_clip_tables','filters','lossless','rescaler','upsampling','yuv')) {
    $webpFiles += Join-Path $webp ('src/dsp/'+$name+'.c')
}
foreach ($name in @('alpha_processing','dec','filters','lossless','rescaler','upsampling','yuv')) {
    $webpFiles += Join-Path $webp ('src/dsp/'+$name+'_sse2.c')
}
foreach ($name in @('bit_reader_utils','color_cache_utils','filters_utils','huffman_utils','palette',
    'quant_levels_dec_utils','rescaler_utils','random_utils','thread_utils','utils')) {
    $webpFiles += Join-Path $webp ('src/utils/'+$name+'.c')
}
foreach ($file in $webpFiles) {
    $obj = Join-Path $out ('webp-'+[IO.Path]::GetFileName($file)+'.obj')
    & $Zig cc @common -I $webp -c $file -o $obj
    if ($LASTEXITCODE) { throw "WebP compilation failed: $file" }
    $objects += $obj
}
$common += @('-I',(Join-Path $webp 'src'))
$base = @((Join-Path $src 'archive.cpp'),(Join-Path $src 'image.cpp'))
$libs = @('-lole32','-luuid','-lgdi32','-lshlwapi','-lshell32','-lwindowscodecs','-lbcrypt','-ladvapi32')
& $Zig c++ @common -std=c++17 @base (Join-Path $src 'thumbnail.cpp') (Join-Path $src 'thumbnail.def') $badges @objects @libs -shared -o (Join-Path $out 'DsfThumbnail.dll')
if ($LASTEXITCODE) { throw 'Thumbnail provider build failed' }
& $Zig c++ @common -std=c++17 @base (Join-Path $src 'check.cpp') @objects @libs -municode -static -o (Join-Path $out 'dsf-thumbnail-check.exe')
if ($LASTEXITCODE) { throw 'Thumbnail checker build failed' }
Copy-Item -LiteralPath (Join-Path $deps 'LICENSE') -Destination (Join-Path $out 'miniz-LICENSE.txt')
Copy-Item -LiteralPath (Join-Path $deps 'json-LICENSE.MIT') -Destination (Join-Path $out 'json-LICENSE.txt')
foreach ($name in @('COPYING','PATENTS','AUTHORS')) {
    Copy-Item -LiteralPath (Join-Path $webp $name) -Destination (Join-Path $out ('webp-'+$name+'.txt'))
}
Write-Output 'Built Windows x64 thumbnail prototype. Nothing was registered with Windows.'
