# Temporary extension only; never modifies .dsp/.dsf or any default application.
param([ValidateRange(0,120)][int]$InspectSeconds=0,[switch]$TestSurrogate,
    [ValidateSet('User','Machine')][string]$Scope='User')
$ErrorActionPreference='Stop'
if ($Scope -eq 'Machine') {
    $principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Machine-scope diagnostic requires Windows administrator approval. No registration was changed.'
    }
}
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$out=Join-Path $repo 'outputs/windows-preview'
$report=Get-Content (Join-Path $out 'verification.json') -Raw | ConvertFrom-Json
$dll=Join-Path $out 'DsfThumbnail.dll'
$clsid='{7E47A067-4769-4CDC-A9A2-75CD67ECBCC1}'
$ext='.dsftest'+[Guid]::NewGuid().ToString('N').Substring(0,8)
$progid='DSF.PreviewTest'+$ext
$handler='{E357FCCD-A995-4576-B01F-234630154E96}'
$hive=if($Scope -eq 'Machine'){[Microsoft.Win32.RegistryHive]::LocalMachine}else{[Microsoft.Win32.RegistryHive]::CurrentUser}
foreach ($checkHive in @([Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryHive]::LocalMachine)) {
    $checkRoot=[Microsoft.Win32.RegistryKey]::OpenBaseKey($checkHive,[Microsoft.Win32.RegistryView]::Registry64)
    try {
        foreach ($checkPath in @(('CLSID\'+$clsid),('AppID\'+$clsid),$ext,$progid)) {
            $key=$checkRoot.OpenSubKey('Software\Classes\'+$checkPath)
            if ($key) { $key.Dispose(); throw "Existing registration in ${checkHive}: $checkPath. Refusing to overwrite." }
        }
    } finally { $checkRoot.Dispose() }
}
$registry=[Microsoft.Win32.RegistryKey]::OpenBaseKey($hive,[Microsoft.Win32.RegistryView]::Registry64)
Write-Output "Diagnostic registry: $($registry.Name), scope: $Scope"
$classes=$registry
$classesPrefix='Software\Classes\'
$existing=$classes.OpenSubKey($classesPrefix+'CLSID\'+$clsid)
if ($existing) { $existing.Dispose(); $classes.Dispose(); $registry.Dispose(); throw 'Provider already registered; refusing to alter existing registration.' }
$existing=$classes.OpenSubKey($classesPrefix+$ext)
if ($existing) { $existing.Dispose(); $classes.Dispose(); $registry.Dispose(); throw 'Test extension exists; refusing to alter existing registration.' }
$existing=$classes.OpenSubKey($classesPrefix+$progid)
if ($existing) { $existing.Dispose(); $classes.Dispose(); $registry.Dispose(); throw 'Test ProgID exists; refusing to alter existing registration.' }
$existing=$classes.OpenSubKey($classesPrefix+'AppID\'+$clsid)
if ($existing) { $existing.Dispose(); $classes.Dispose(); $registry.Dispose(); throw 'Test AppID exists; refusing to alter existing registration.' }
$inputPath=Join-Path $out ('shell-test'+$ext)
$outputPath=Join-Path $out 'shell-thumbnail.png'
Copy-Item -LiteralPath (Join-Path $report.run 'v1-png.dsf') -Destination $inputPath
$registered=$false
$ownedRoots=New-Object 'System.Collections.Generic.List[string]'
$ownership=[Guid]::NewGuid().ToString('N')
function New-OwnedRoot([string]$path) {
    $created=$false
    $key=$classes.CreateSubKey($classesPrefix+$path)
    try { $key.SetValue('DSFDiagnosticOwner',$ownership); $ownedRoots.Add($path); $created=$true }
    finally { if (!$created) { $key.Dispose(); $classes.DeleteSubKey($classesPrefix+$path,$false) } }
    return $key
}
$result=[ordered]@{scope=$Scope;registeredCom=$false;shell=$false;registrationRemoved=$false;extension=$ext}
try {
    $key=New-OwnedRoot ('CLSID\'+$clsid)
    $registered=$true
    $key.SetValue('','DSF read-only thumbnail test')
    if ($TestSurrogate) { $key.SetValue('AppID',$clsid) }
    $key.Dispose()
    if ($TestSurrogate) {
        $key=New-OwnedRoot ('AppID\'+$clsid)
        $key.SetValue('','DSF read-only thumbnail test')
        $key.SetValue('DllSurrogate','')
        $key.Dispose()
    }
    $key=$classes.CreateSubKey($classesPrefix+'CLSID\'+$clsid+'\InprocServer32')
    $key.SetValue('',$dll)
    $key.SetValue('ThreadingModel','Apartment')
    $key.Dispose()
    $key=New-OwnedRoot $ext
    $key.SetValue('',$progid)
    $key.Dispose()
    $key=New-OwnedRoot $progid
    $key.SetValue('','DSF preview test document')
    $key.Dispose()
    $key=$classes.CreateSubKey($classesPrefix+$progid+'\shellex\'+$handler)
    $key.SetValue('',$clsid)
    $key.Dispose()
    $key=$classes.CreateSubKey($classesPrefix+$ext+'\shellex\'+$handler)
    $key.SetValue('',$clsid)
    $key.Dispose()
    & (Join-Path $out 'dsf-thumbnail-check.exe') --notify
    & (Join-Path $out 'dsf-thumbnail-check.exe') $inputPath (Join-Path $out 'registered-thumbnail.png') --registered
    if ($LASTEXITCODE) { throw 'Registered COM activation failed; do not install for user extensions.' }
    $result.registeredCom=$true
    & (Join-Path $out 'dsf-thumbnail-check.exe') $inputPath (Join-Path $out 'bound-thumbnail.png') --bind
    $result.boundHandler=($LASTEXITCODE -eq 0)
    if ($Scope -eq 'User') {
        & (Join-Path $out 'dsf-thumbnail-check.exe') $inputPath '-' --registered-low
        $result.lowIntegrityCom=($LASTEXITCODE -eq 0)
    }
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
} catch {
    $result.error=$_.Exception.Message
    throw
} finally {
    # These uniquely owned keys were absent before the test; do not touch other entries.
    if ($registered) {
        foreach ($ownedPath in $ownedRoots) {
            $key=$classes.OpenSubKey($classesPrefix+$ownedPath)
            $ours=$key -and $key.GetValue('DSFDiagnosticOwner') -eq $ownership
            if ($key) { $key.Dispose() }
            if ($ours) { $classes.DeleteSubKeyTree($classesPrefix+$ownedPath,$false) }
        }
        & (Join-Path $out 'dsf-thumbnail-check.exe') --notify
    }
    $remainingClass=$classes.OpenSubKey($classesPrefix+'CLSID\'+$clsid)
    $remainingExtension=$classes.OpenSubKey($classesPrefix+$ext)
    $remainingProgId=$classes.OpenSubKey($classesPrefix+$progid)
    $remainingAppId=$classes.OpenSubKey($classesPrefix+'AppID\'+$clsid)
    $result.registrationRemoved=(!$remainingClass -and !$remainingExtension -and !$remainingProgId -and !$remainingAppId)
    if ($remainingClass) { $remainingClass.Dispose() }
    if ($remainingExtension) { $remainingExtension.Dispose() }
    if ($remainingProgId) { $remainingProgId.Dispose() }
    if ($remainingAppId) { $remainingAppId.Dispose() }
    $classes.Dispose(); $registry.Dispose()
    $result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $out 'shell-verification.json') -Encoding utf8
    $result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $out ('shell-verification-'+$Scope.ToLowerInvariant()+'.json')) -Encoding utf8
}
