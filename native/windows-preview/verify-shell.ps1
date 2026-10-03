# Temporary extension only; never modifies .dsp/.dsf or any default application.
param([ValidateRange(0,120)][int]$InspectSeconds=0,[switch]$TestSurrogate)
$ErrorActionPreference='Stop'
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$out=Join-Path $repo 'outputs/windows-preview'
$report=Get-Content (Join-Path $out 'verification.json') -Raw | ConvertFrom-Json
$dll=Join-Path $out 'DsfThumbnail.dll'
$clsid='{7E47A067-4769-4CDC-A9A2-75CD67ECBCC1}'
$ext='.dsftest'+[Guid]::NewGuid().ToString('N').Substring(0,8)
$progid='DSF.PreviewTest'+$ext
$handler='{E357FCCD-A995-4576-B01F-234630154E96}'
$registry=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryView]::Registry64)
$classes=$registry.OpenSubKey('Software\Classes',$true)
$existing=$classes.OpenSubKey('CLSID\'+$clsid)
if ($existing) { $existing.Dispose(); $classes.Dispose(); $registry.Dispose(); throw 'Provider already registered; refusing to alter existing registration.' }
$existing=$classes.OpenSubKey($ext)
if ($existing) { $existing.Dispose(); $classes.Dispose(); $registry.Dispose(); throw 'Test extension exists; refusing to alter existing registration.' }
$existing=$classes.OpenSubKey($progid)
if ($existing) { $existing.Dispose(); $classes.Dispose(); $registry.Dispose(); throw 'Test ProgID exists; refusing to alter existing registration.' }
$existing=$classes.OpenSubKey('AppID\'+$clsid)
if ($existing) { $existing.Dispose(); $classes.Dispose(); $registry.Dispose(); throw 'Test AppID exists; refusing to alter existing registration.' }
$inputPath=Join-Path $out ('shell-test'+$ext)
$outputPath=Join-Path $out 'shell-thumbnail.png'
Copy-Item -LiteralPath (Join-Path $report.run 'v1-png.dsf') -Destination $inputPath
$registered=$false
$result=[ordered]@{registeredCom=$false;shell=$false;registrationRemoved=$false;extension=$ext}
try {
    $key=$classes.CreateSubKey('CLSID\'+$clsid)
    $registered=$true
    $key.SetValue('','DSF read-only thumbnail test')
    if ($TestSurrogate) { $key.SetValue('AppID',$clsid) }
    $key.Dispose()
    if ($TestSurrogate) {
        $key=$classes.CreateSubKey('AppID\'+$clsid)
        $key.SetValue('','DSF read-only thumbnail test')
        $key.SetValue('DllSurrogate','')
        $key.Dispose()
    }
    $key=$classes.CreateSubKey('CLSID\'+$clsid+'\InprocServer32')
    $key.SetValue('',$dll)
    $key.SetValue('ThreadingModel','Apartment')
    $key.Dispose()
    $key=$classes.CreateSubKey($ext)
    $key.SetValue('',$progid)
    $key.Dispose()
    $key=$classes.CreateSubKey($progid)
    $key.SetValue('','DSF preview test document')
    $key.Dispose()
    $key=$classes.CreateSubKey($progid+'\shellex\'+$handler)
    $key.SetValue('',$clsid)
    $key.Dispose()
    $key=$classes.CreateSubKey($ext+'\shellex\'+$handler)
    $key.SetValue('',$clsid)
    $key.Dispose()
    & (Join-Path $out 'dsf-thumbnail-check.exe') --notify
    & (Join-Path $out 'dsf-thumbnail-check.exe') $inputPath (Join-Path $out 'registered-thumbnail.png') --registered
    if ($LASTEXITCODE) { throw 'Registered COM activation failed; do not install for user extensions.' }
    $result.registeredCom=$true
    if ($TestSurrogate) {
        & (Join-Path $out 'dsf-thumbnail-check.exe') $inputPath (Join-Path $out 'surrogate-thumbnail.png') --surrogate
        $result.surrogate=($LASTEXITCODE -eq 0)
    }
    & (Join-Path $out 'dsf-thumbnail-check.exe') $inputPath $outputPath --shell
    $result.shell=($LASTEXITCODE -eq 0)
    if ($InspectSeconds) {
        Write-Output "Temporary Explorer test file: $inputPath (registration removed after $InspectSeconds seconds)"
        Start-Sleep -Seconds $InspectSeconds
    }
    if (!$result.shell) { throw 'Shell extraction failed; do not install for user extensions.' }
    Write-Output 'Temporary extension: Shell API produced a thumbnail. Explorer UI remains a separate check.'
} finally {
    # These uniquely owned keys were absent before the test; do not touch other entries.
    if ($registered) {
        $key=$classes.OpenSubKey('CLSID\'+$clsid+'\InprocServer32')
        $ours=$key -and $key.GetValue('') -eq $dll
        if ($key) { $key.Dispose() }
        if ($ours) { $classes.DeleteSubKeyTree('CLSID\'+$clsid,$false) }
        $key=$classes.OpenSubKey($ext+'\shellex\'+$handler)
        $ours=$key -and $key.GetValue('') -eq $clsid
        if ($key) { $key.Dispose() }
        if ($ours) { $classes.DeleteSubKeyTree($ext,$false) }
        $key=$classes.OpenSubKey($progid+'\shellex\'+$handler)
        $ours=$key -and $key.GetValue('') -eq $clsid
        if ($key) { $key.Dispose() }
        if ($ours) { $classes.DeleteSubKeyTree($progid,$false) }
        if ($TestSurrogate) {
            $key=$classes.OpenSubKey('AppID\'+$clsid)
            $ours=$key -and $key.GetValue('') -eq 'DSF read-only thumbnail test'
            if ($key) { $key.Dispose() }
            if ($ours) { $classes.DeleteSubKeyTree('AppID\'+$clsid,$false) }
        }
        & (Join-Path $out 'dsf-thumbnail-check.exe') --notify
    }
    $remainingClass=$classes.OpenSubKey('CLSID\'+$clsid)
    $remainingExtension=$classes.OpenSubKey($ext)
    $remainingProgId=$classes.OpenSubKey($progid)
    $remainingAppId=$classes.OpenSubKey('AppID\'+$clsid)
    $result.registrationRemoved=(!$remainingClass -and !$remainingExtension -and !$remainingProgId -and !$remainingAppId)
    if ($remainingClass) { $remainingClass.Dispose() }
    if ($remainingExtension) { $remainingExtension.Dispose() }
    if ($remainingProgId) { $remainingProgId.Dispose() }
    if ($remainingAppId) { $remainingAppId.Dispose() }
    $classes.Dispose(); $registry.Dispose()
    $result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $out 'shell-verification.json') -Encoding utf8
}
