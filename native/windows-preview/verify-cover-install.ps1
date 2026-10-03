# Elevated rehearsal of only unique test extensions and the dedicated test CLSID.
$ErrorActionPreference='Stop'
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$out=Join-Path $repo 'outputs/windows-preview'
$hash=(Get-FileHash -LiteralPath (Join-Path $out 'DsfCoverPreview.dll') -Algorithm SHA256).Hash.ToLowerInvariant()
$package=Join-Path $out ('DSF-Cover-Pane-'+$hash.Substring(0,12))
$setup=Join-Path $package 'setup-cover-preview.ps1'
$id=[Guid]::NewGuid().ToString('N').Substring(0,8)
$class='{A502F180-21AF-4762-99B7-7B3D912A57FD}'
$fixture=(Get-Content -LiteralPath (Join-Path $out 'verification.json') -Raw | ConvertFrom-Json).run
$file=Join-Path $fixture 'v1-webp.dsf'
$before=(Get-FileHash -LiteralPath $file).Hash
$result=[ordered]@{testId=$id;install=$false;repeat=$false;surrogate=$false;removed=$false;originalUnchanged=$false}
try {
    & $setup -Action Install -TestId $id
    $result.install=$true
    & $setup -Action Install -TestId $id
    $result.repeat=$true
    & (Join-Path $out 'dsf-preview-check.exe') (Join-Path $package 'DsfCoverPreview.dll') $file ('--surrogate:'+$class)
    if($LASTEXITCODE){throw 'System preview host check failed.'}
    $result.surrogate=$true
} catch {$result.error=$_.Exception.Message;throw}
finally {
    & $setup -Action Uninstall -TestId $id
    $hive=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine,[Microsoft.Win32.RegistryView]::Registry64)
    try {
        $paths=@(('Software\Classes\CLSID\'+$class),('Software\Classes\.dsfpanetest'+$id+'1'),('Software\Classes\.dsfpanetest'+$id+'2'))
        $remaining=@()
        foreach($path in $paths){$key=$hive.OpenSubKey($path);if($key){$remaining+=$path;$key.Dispose()}}
        $list=$hive.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\PreviewHandlers')
        if($list){if($list.GetValue($class)){$remaining+='PreviewHandlers'};$list.Dispose()}
        $result.removed=($remaining.Count -eq 0)
    }finally{$hive.Dispose()}
    $result.originalUnchanged=((Get-FileHash -LiteralPath $file).Hash -eq $before)
    $result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $out 'cover-pane-install-verification.json') -Encoding UTF8
    if(!$result.removed -or !$result.originalUnchanged){throw 'Rehearsal cleanup or preservation failed.'}
}
