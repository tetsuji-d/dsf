# Elevated, temporary rehearsal. Never registers .dsp/.dsf.
param([ValidateRange(0,120)][int]$InspectSeconds=0)
$ErrorActionPreference='Stop'
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$out=Join-Path $repo 'outputs/windows-preview'
$hash=(Get-FileHash -LiteralPath (Join-Path $out 'DsfThumbnail.dll') -Algorithm SHA256).Hash.ToLowerInvariant()
$package=Join-Path $out ('DSF-Windows-Preview-'+$hash.Substring(0,12))
$setup=Join-Path $package 'setup.ps1'
$testId=[Guid]::NewGuid().ToString('N').Substring(0,8)
$folder=Join-Path $out ('install-test-'+$testId)
$root=Join-Path ([Environment]::GetFolderPath('ProgramFiles')) ('DSF Windows Preview Test '+$testId)
$clsid='{7E47A067-4769-4CDC-A9A2-75CD67ECBCC1}'
$fixture=(Get-Content (Join-Path $out 'verification.json') -Raw | ConvertFrom-Json).run
$exe=Join-Path $out 'dsf-thumbnail-check.exe'
function Snapshot-Key($key) {
    if (!$key) { return $null }
    $data=[ordered]@{values=[ordered]@{};children=[ordered]@{}}
    foreach($name in ($key.GetValueNames() | Sort-Object)) { $data.values[$name]=@([int]$key.GetValueKind($name),$key.GetValue($name,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)) }
    foreach($name in ($key.GetSubKeyNames() | Sort-Object)) {
        $child=$key.OpenSubKey($name)
        try {$data.children[$name]=Snapshot-Key $child}finally{if($child){$child.Dispose()}}
    }
    return $data
}
function File-Associations {
    $data=@()
    foreach($id in @([Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryHive]::LocalMachine)) {
        $hive=[Microsoft.Win32.RegistryKey]::OpenBaseKey($id,[Microsoft.Win32.RegistryView]::Registry64)
        try {
            foreach($ext in @('.dsp','.dsf')) {
                $key=$hive.OpenSubKey('Software\Classes\'+$ext)
                try {$data+=@(Snapshot-Key $key)}finally{if($key){$key.Dispose()}}
            }
        } finally {$hive.Dispose()}
    }
    return ConvertTo-Json -InputObject $data -Depth 30 -Compress
}
$before=File-Associations
$result=[ordered]@{testId=$testId;install=$false;repeatInstall=$false;shell=$false;removed=$false;associationsUnchanged=$false;originalsUnchanged=$false}
New-Item -ItemType Directory -Path $folder | Out-Null
$sources=@((Join-Path $fixture 'v1-webp.dsf'),(Join-Path $out 'cover-roundtrip.dsp'),(Join-Path $fixture 'dsp-stale-source.dsf'))
$copies=@((Join-Path $folder ('01-DSF-cover.dsftest'+$testId+'1')),(Join-Path $folder ('02-DSP-cover.dsftest'+$testId+'2')),(Join-Path $folder ('03-stale-preview.dsftest'+$testId+'2')))
for($i=0;$i -lt $sources.Count;$i++){Copy-Item -LiteralPath $sources[$i] -Destination $copies[$i]}
try {
    & $setup -Action Install -TestId $testId
    $result.install=$true
    & $setup -Action Install -TestId $testId
    $result.repeatInstall=$true
    for($i=0;$i -lt 2;$i++) {
        & $exe $copies[$i] (Join-Path $folder ('shell-'+$i+'.png')) --shell
        if($LASTEXITCODE){throw 'Shell failed with the installed component.'}
    }
    & $exe $copies[2] (Join-Path $folder 'stale.png') --shell
    if(!$LASTEXITCODE){throw 'A stale DSP preview was incorrectly accepted.'}
    $result.shell=$true
    Write-Output "Explorer rehearsal folder: $folder"
    if($InspectSeconds){Start-Sleep -Seconds $InspectSeconds}
} catch {
    $result.error=$_.Exception.Message
    throw
} finally {
    & $setup -Action Uninstall -TestId $testId
    $hive=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine,[Microsoft.Win32.RegistryView]::Registry64)
    try {
        $remaining=@()
        foreach($path in @(('Software\Classes\CLSID\'+$clsid),('Software\Classes\.dsftest'+$testId+'1'),('Software\Classes\.dsftest'+$testId+'2'))) {
            $key=$hive.OpenSubKey($path)
            if($key){$remaining+=$path;$key.Dispose()}
        }
        $result.removed=($remaining.Count -eq 0 -and !(Test-Path -LiteralPath $root))
    } finally {$hive.Dispose()}
    $result.associationsUnchanged=((File-Associations) -ceq $before)
    $result.originalsUnchanged=$true
    for($i=0;$i -lt $sources.Count;$i++){if((Get-FileHash -LiteralPath $sources[$i]).Hash -ne (Get-FileHash -LiteralPath $copies[$i]).Hash){$result.originalsUnchanged=$false}}
    $result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $out 'install-verification.json') -Encoding UTF8
    if(!$result.removed -or !$result.associationsUnchanged -or !$result.originalsUnchanged){throw 'Rehearsal cleanup or preservation check failed. Inspect install-verification.json.'}
}
