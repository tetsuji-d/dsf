# Development package only. No auto-elevation or execution-policy override.
param([ValidateSet('Status','Install','Uninstall')][string]$Action='Status',
    [ValidatePattern('^[a-f0-9]{8}$')][string]$TestId)
$ErrorActionPreference='Stop'
if (![Environment]::Is64BitProcess -or $env:PROCESSOR_ARCHITECTURE -ne 'AMD64') { throw 'Windows x64 is required.' }
$clsid='{7E47A067-4769-4CDC-A9A2-75CD67ECBCC1}'
$handler='{E357FCCD-A995-4576-B01F-234630154E96}'
$owner='DSF.WindowsThumbnail.1'
$base='Software\Classes\'
$classPath=$base+'CLSID\'+$clsid
$root=Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'DSF Windows Preview'
$recordPath=Join-Path $root 'installed.json'
$extensions=@('.dsp','.dsf')
if ($TestId) {
    # A development rehearsal can only use unique test extensions/directories.
    $owner+='.'+$TestId
    $root=Join-Path ([Environment]::GetFolderPath('ProgramFiles')) ('DSF Windows Preview Test '+$TestId)
    $recordPath=Join-Path $root 'installed.json'
    $extensions=@(('.dsftest'+$TestId+'1'),('.dsftest'+$TestId+'2'))
}
$machine=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine,[Microsoft.Win32.RegistryView]::Registry64)
function Read-Value($hive,[string]$path,[string]$name='') {
    $key=$hive.OpenSubKey($path)
    if (!$key) { return $null }
    try { return $key.GetValue($name,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) }
    finally { $key.Dispose() }
}
function Set-Value([string]$path,[string]$name,[string]$value) {
    # Open only the exact subkey, not Software\Classes with write access.
    $key=$machine.CreateSubKey($path)
    try { $key.SetValue($name,$value,[Microsoft.Win32.RegistryValueKind]::String) }
    finally { $key.Dispose() }
}
function Notify-Shell {
    if (!('DsfSetupShell' -as [type])) {
        Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class DsfSetupShell { [DllImport("shell32.dll")] public static extern void SHChangeNotify(uint e,uint f,IntPtr a,IntPtr b); }'
    }
    [DsfSetupShell]::SHChangeNotify(0x08000000,0,[IntPtr]::Zero,[IntPtr]::Zero)
}
function Check-Directory([string]$directory) {
    if ((Test-Path -LiteralPath $directory) -and ((Get-Item -LiteralPath $directory).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw "Refusing a redirected installation directory: $directory"
    }
}
try {
    $current=Read-Value $machine ($classPath+'\InprocServer32')
    if ($Action -eq 'Status') {
        [ordered]@{installedDll=$current;installationFolder=$root;fileTypes=$extensions;scope='This PC';
            changes='Cover thumbnails only; keeps default apps, file icons and original files.'} | ConvertTo-Json
        return
    }
    $principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this reviewed script as a Windows administrator. Nothing was changed.' }
    Check-Directory $root
    $registrationOwner=Read-Value $machine $classPath 'DSFPreviewOwner'
    $existingClass=$machine.OpenSubKey($classPath)
    $classExists=($null -ne $existingClass)
    if ($existingClass) { $existingClass.Dispose() }
    if ($classExists -and $registrationOwner -ne $owner) { throw 'Another registration uses this CLSID. Refusing to replace it.' }
    $record=$null
    if (Test-Path -LiteralPath $recordPath) {
        $record=Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
        if ($record.owner -ne $owner -or $record.schemaVersion -ne 1) { throw 'Unknown installation record.' }
        foreach ($version in $record.versions) { if ($version -cnotmatch '^[0-9a-f]{64}$') { throw 'Invalid installed version.' } }
    } elseif ($classExists) { throw 'Installation record is missing. Refusing to alter an existing installation.' }

    if ($Action -eq 'Uninstall') {
        if (!$record) { Write-Output 'No DSF thumbnail installation was found.'; return }
        foreach ($entry in $record.extensionKeys) {
            if ($entry.extension -notin $extensions) { throw 'Unknown extension in installation record.' }
            $path=$base+$entry.extension+'\shellex\'+$handler
            if ((Read-Value $machine $path) -eq $clsid) {
                $key=$machine.OpenSubKey($path,$true)
                try { $key.DeleteValue('',$false); $empty=($key.ValueCount -eq 0 -and $key.SubKeyCount -eq 0) }
                finally { $key.Dispose() }
                if ($empty -and !$entry.existed) { $machine.DeleteSubKey($path,$false) }
            }
            foreach ($parent in @('shellex','extension')) {
                $wasPresent=if($parent -eq 'shellex'){$entry.shellExisted}else{$entry.extensionExisted}
                $parentPath=if($parent -eq 'shellex'){$base+$entry.extension+'\shellex'}else{$base+$entry.extension}
                $key=$machine.OpenSubKey($parentPath)
                $empty=$key -and $key.ValueCount -eq 0 -and $key.SubKeyCount -eq 0
                if($key){$key.Dispose()}
                if($empty -and !$wasPresent){$machine.DeleteSubKey($parentPath,$false)}
            }
        }
        if ((Read-Value $machine $classPath 'DSFPreviewOwner') -eq $owner) { $machine.DeleteSubKeyTree($classPath,$false) }
        Notify-Shell
        # Only known package files in validated version directories. Never recurse.
        $pending=@()
        foreach ($version in $record.versions) {
            $directory=Join-Path $root $version
            Check-Directory $directory
            foreach ($name in @('DsfThumbnail.dll','miniz-LICENSE.txt','json-LICENSE.txt','webp-COPYING.txt','webp-PATENTS.txt','webp-AUTHORS.txt')) {
                $target=Join-Path $directory $name
                if (Test-Path -LiteralPath $target) {
                    try { Remove-Item -LiteralPath $target -ErrorAction Stop }
                    catch { $pending+=$target }
                }
            }
            if ((Test-Path -LiteralPath $directory) -and !(Get-ChildItem -LiteralPath $directory -Force | Select-Object -First 1)) { Remove-Item -LiteralPath $directory }
        }
        if ($pending.Count) { Write-Output ('Registration removed. Files still in use; run Uninstall again after they are released: '+($pending -join ', ')); return }
        Remove-Item -LiteralPath $recordPath
        if (!(Get-ChildItem -LiteralPath $root -Force | Select-Object -First 1)) { Remove-Item -LiteralPath $root }
        Write-Output 'DSF cover thumbnails removed. Default apps, file icons and original files were preserved.'
        return
    }

    $manifest=Get-Content (Join-Path $PSScriptRoot 'package.json') -Raw | ConvertFrom-Json
    $allowed=@('DsfThumbnail.dll','miniz-LICENSE.txt','json-LICENSE.txt','webp-COPYING.txt','webp-PATENTS.txt','webp-AUTHORS.txt')
    if ($manifest.schemaVersion -ne 1 -or @($manifest.files).Count -ne $allowed.Count) { throw 'Invalid package manifest.' }
    $seen=@{}
    foreach ($file in $manifest.files) {
        if ($file.name -notin $allowed -or $seen.ContainsKey($file.name) -or $file.sha256 -cnotmatch '^[0-9a-f]{64}$') { throw 'Invalid package file.' }
        $seen[$file.name]=$true
        if ((Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $file.name) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256) { throw ('Package checksum mismatch: '+$file.name) }
    }
    $version=($manifest.files | Where-Object name -eq 'DsfThumbnail.dll').sha256
    $destination=Join-Path $root $version
    Check-Directory $destination
    $baseline=@()
    foreach ($extension in $extensions) {
        $path=$base+$extension+'\shellex\'+$handler
        $key=$machine.OpenSubKey($path)
        $entry=@{extension=$extension;existed=($null -ne $key);shellExisted=$false;extensionExisted=$false}
        if ($key) { $key.Dispose() }
        $key=$machine.OpenSubKey($base+$extension+'\shellex'); $entry.shellExisted=($null -ne $key); if($key){$key.Dispose()}
        $key=$machine.OpenSubKey($base+$extension); $entry.extensionExisted=($null -ne $key); if($key){$key.Dispose()}
        $baseline+=$entry
        foreach ($hiveId in @([Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryHive]::LocalMachine)) {
            $hive=[Microsoft.Win32.RegistryKey]::OpenBaseKey($hiveId,[Microsoft.Win32.RegistryView]::Registry64)
            try {
                $paths=@($path)
                $progid=Read-Value $hive ($base+$extension)
                if ($progid) { $paths+=($base+$progid+'\shellex\'+$handler) }
                foreach ($candidate in $paths) {
                    $old=Read-Value $hive $candidate
                    if ($null -ne $old -and $old -ne $clsid) { throw "A thumbnail handler already exists for $extension. It will not be replaced." }
                }
            } finally { $hive.Dispose() }
        }
    }
    if (!$record) { $record=[pscustomobject]@{schemaVersion=1;owner=$owner;versions=@();extensionKeys=$baseline} }
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    foreach ($file in $manifest.files) {
        $target=Join-Path $destination $file.name
        if (Test-Path -LiteralPath $target) {
            if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256) { throw 'Installed file differs. Refusing to overwrite.' }
        } else { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file.name) -Destination $target }
    }
    if ($version -notin $record.versions) { $record.versions=@($record.versions)+@($version) }
    # Write recovery information before registration; Uninstall works after interruption.
    $tempRecord=$recordPath+'.new'
    $record | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $tempRecord -Encoding UTF8
    Move-Item -LiteralPath $tempRecord -Destination $recordPath -Force
    Set-Value $classPath 'DSFPreviewOwner' $owner
    Set-Value $classPath '' 'DSF cover thumbnail provider'
    Set-Value ($classPath+'\InprocServer32') '' (Join-Path $destination 'DsfThumbnail.dll')
    Set-Value ($classPath+'\InprocServer32') 'ThreadingModel' 'Apartment'
    foreach ($extension in $extensions) { Set-Value ($base+$extension+'\shellex\'+$handler) '' $clsid }
    Notify-Shell
    Write-Output 'DSF cover thumbnails installed for this PC. Default apps and file icons were preserved.'
} finally { $machine.Dispose() }
