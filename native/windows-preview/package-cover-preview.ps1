$ErrorActionPreference='Stop'
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$out=Join-Path $repo 'outputs/windows-preview'
$hash=(Get-FileHash -LiteralPath (Join-Path $out 'DsfCoverPreview.dll') -Algorithm SHA256).Hash.ToLowerInvariant()
$folder=Join-Path $out ('DSF-Cover-Pane-'+$hash.Substring(0,12))
New-Item -ItemType Directory -Path $folder -Force | Out-Null
$files=@()
foreach($name in @('DsfCoverPreview.dll','miniz-LICENSE.txt','json-LICENSE.txt','webp-COPYING.txt','webp-PATENTS.txt','webp-AUTHORS.txt')){
    Copy-Item -LiteralPath (Join-Path $out $name) -Destination (Join-Path $folder $name)
    $files+=@{name=$name;sha256=(Get-FileHash -LiteralPath (Join-Path $folder $name) -Algorithm SHA256).Hash.ToLowerInvariant()}
}
@{schemaVersion=1;files=$files} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $folder 'package.json') -Encoding UTF8
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'setup-cover-preview.ps1') -Destination $folder
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'COVER-PANE-README.txt') -Destination (Join-Path $folder 'README.txt')
$names=@($files | ForEach-Object {$_.name})+@('package.json','setup-cover-preview.ps1','README.txt')
Compress-Archive -LiteralPath @($names | ForEach-Object {Join-Path $folder $_}) -DestinationPath ($folder+'.zip') -Force
Write-Output $folder
