$ErrorActionPreference='Stop'
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$out=Join-Path $repo 'outputs/windows-preview'
$hash=(Get-FileHash -LiteralPath (Join-Path $out 'DsfThumbnail.dll') -Algorithm SHA256).Hash.ToLowerInvariant()
$folder=Join-Path $out ('DSF-Windows-Preview-'+$hash.Substring(0,12))
New-Item -ItemType Directory -Path $folder -Force | Out-Null
$files=@()
foreach ($name in @('DsfThumbnail.dll','miniz-LICENSE.txt','json-LICENSE.txt','webp-COPYING.txt','webp-PATENTS.txt','webp-AUTHORS.txt')) {
    Copy-Item -LiteralPath (Join-Path $out $name) -Destination (Join-Path $folder $name)
    $files+=@{name=$name;sha256=(Get-FileHash -LiteralPath (Join-Path $folder $name) -Algorithm SHA256).Hash.ToLowerInvariant()}
}
@{schemaVersion=1;files=$files} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $folder 'package.json') -Encoding UTF8
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'setup.ps1') -Destination $folder
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'user-badges.ps1') -Destination $folder
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'apply-user-badges.ps1') -Destination $folder
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'APPLY-LABELS.cmd') -Destination $folder
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'PACKAGE-README.txt') -Destination (Join-Path $folder 'README.txt')
$zip=$folder+'.zip'
# User-run registration can leave a diagnostic log here; never include it in a package.
$packageNames=@($files | ForEach-Object { $_.name })+@('package.json','setup.ps1','user-badges.ps1','apply-user-badges.ps1','APPLY-LABELS.cmd','README.txt')
$packagePaths=@($packageNames | ForEach-Object { Join-Path $folder $_ })
Compress-Archive -LiteralPath $packagePaths -DestinationPath $zip -Force
Write-Output $folder
Write-Output $zip
