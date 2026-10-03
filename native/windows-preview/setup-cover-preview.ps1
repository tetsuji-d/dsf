# Separate, reviewed Windows cover-pane package. No auto-elevation or policy changes.
param([ValidateSet('Status','Install','Uninstall')][string]$Action='Status',
    [ValidatePattern('^[a-f0-9]{8}$')][string]$TestId)
$ErrorActionPreference='Stop'
if (![Environment]::Is64BitProcess -or $env:PROCESSOR_ARCHITECTURE -ne 'AMD64') { throw 'Windows x64 is required.' }
$clsid='{DAE45CE1-7334-4911-AE3A-7961A4E7389D}'
$handler='{8895B1C6-B41F-4C1C-A562-0D564250836F}'
$owner='DSF.WindowsCoverPane.1'
$extensions=@('.dsf','.dsp')
$folderName='DSF Cover Preview'
if($TestId) {
    $clsid='{A502F180-21AF-4762-99B7-7B3D912A57FD}'
    $owner+='.'+$TestId; $folderName+=' Test '+$TestId
    $extensions=@(('.dsfpanetest'+$TestId+'1'),('.dsfpanetest'+$TestId+'2'))
}
$base='Software\Classes\'
$classPath=$base+'CLSID\'+$clsid
$listPath='Software\Microsoft\Windows\CurrentVersion\PreviewHandlers'
$root=Join-Path ([Environment]::GetFolderPath('ProgramFiles')) $folderName
$recordPath=Join-Path $root 'installed.json'
$files=@('DsfCoverPreview.dll','miniz-LICENSE.txt','json-LICENSE.txt','webp-COPYING.txt','webp-PATENTS.txt','webp-AUTHORS.txt')
$machine=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine,[Microsoft.Win32.RegistryView]::Registry64)
function Read-Value([string]$path,[string]$name='') {
    $key=$machine.OpenSubKey($path)
    if(!$key){return $null}
    try {return $key.GetValue($name,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)}finally{$key.Dispose()}
}
function Check-Path([string]$path) {
    if((Test-Path -LiteralPath $path) -and ((Get-Item -LiteralPath $path).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw "Refusing a redirected path: $path"}
}
function Notify-Shell {
    if(!('DsfCoverPaneNotify' -as [type])){Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class DsfCoverPaneNotify { [DllImport("shell32.dll")] public static extern void SHChangeNotify(uint e,uint f,IntPtr a,IntPtr b); }'}
    [DsfCoverPaneNotify]::SHChangeNotify(0x08000000,0,[IntPtr]::Zero,[IntPtr]::Zero)
}
function Registration([string]$dll) {
    @(
        @{path=$classPath;name='';value='DSF / DSP cover preview'},
        @{path=$classPath;name='DSFPreviewOwner';value=$owner},
        @{path=$classPath;name='AppID';value='{6D2B5079-2F0B-48DD-AB7F-97CEC514D30B}'},
        @{path=$classPath+'\InprocServer32';name='';value=$dll},
        @{path=$classPath+'\InprocServer32';name='ThreadingModel';value='Apartment'},
        @{path=$listPath;name=$clsid;value='DSF / DSP cover preview'}
    )
    foreach($ext in $extensions){@{path=$base+$ext+'\shellex\'+$handler;name='';value=$clsid}}
}
try {
    if($Action -eq 'Status') {
        [ordered]@{dll=(Read-Value ($classPath+'\InprocServer32'));classId=$clsid;fileTypes=$extensions;scope='This PC';
            registered=@($extensions | ForEach-Object {@{extension=$_;handler=(Read-Value ($base+$_+'\shellex\'+$handler))}})} | ConvertTo-Json -Depth 4
        return
    }
    $principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if(!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Windows administrator approval is required. Nothing was changed.'}
    Check-Path $root;Check-Path $recordPath
    $record=$null
    if(Test-Path -LiteralPath $recordPath){
        $record=Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
        if($record.owner -ne $owner -or $record.schemaVersion -ne 1 -or $record.current -cnotmatch '^[a-f0-9]{64}$'){throw 'Unknown installation record.'}
        foreach($version in $record.versions){if($version -cnotmatch '^[a-f0-9]{64}$'){throw 'Invalid installed version.'}}
    }
    $class=$machine.OpenSubKey($classPath)
    if($class){
        try {if(!$record -or $class.GetValue('DSFPreviewOwner') -ne $owner){throw 'An existing preview class is not owned by this package.'}}finally{$class.Dispose()}
    }
    if($Action -eq 'Uninstall') {
        if(!$record){Write-Output 'No cover-pane installation was found.';return}
        $plan=@(Registration (Join-Path (Join-Path $root $record.current) 'DsfCoverPreview.dll'))
        foreach($entry in $plan){
            if((Read-Value $entry.path $entry.name) -ceq $entry.value){
                $key=$machine.OpenSubKey($entry.path,$true)
                try {$key.DeleteValue($entry.name,$false)}finally{$key.Dispose()}
            }
        }
        # Remove only empty keys from our fixed paths. Never delete a registry tree.
        $paths=@(($classPath+'\InprocServer32'),$classPath)
        foreach($ext in $extensions){$paths+=@(($base+$ext+'\shellex\'+$handler),($base+$ext+'\shellex'),($base+$ext))}
        foreach($path in $paths){
            $key=$machine.OpenSubKey($path);$empty=$key -and $key.ValueCount -eq 0 -and $key.SubKeyCount -eq 0
            if($key){$key.Dispose()}
            if($empty -and $path -in $record.createdKeys){$machine.DeleteSubKey($path,$false)}
        }
        Notify-Shell
        $pending=@()
        foreach($version in $record.versions){
            $directory=Join-Path $root $version;Check-Path $directory
            foreach($name in $files){
                $target=Join-Path $directory $name;Check-Path $target
                if(Test-Path -LiteralPath $target){try{Remove-Item -LiteralPath $target -ErrorAction Stop}catch{$pending+=$target}}
            }
            if((Test-Path -LiteralPath $directory) -and !(Get-ChildItem -LiteralPath $directory -Force | Select-Object -First 1)){Remove-Item -LiteralPath $directory}
        }
        if($pending.Count){Write-Output 'Registration removed. Files are still in use; run Uninstall again after the preview host releases them.';return}
        Remove-Item -LiteralPath $recordPath
        if(!(Get-ChildItem -LiteralPath $root -Force | Select-Object -First 1)){Remove-Item -LiteralPath $root}
        Write-Output 'Cover pane removed. Thumbnail labels, default apps and originals were preserved.';return
    }
    $manifest=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'package.json') -Raw | ConvertFrom-Json
    if($manifest.schemaVersion -ne 1 -or @($manifest.files).Count -ne $files.Count){throw 'Invalid package manifest.'}
    $seen=@{}
    foreach($file in $manifest.files){
        if($file.name -notin $files -or $seen.ContainsKey($file.name) -or $file.sha256 -cnotmatch '^[a-f0-9]{64}$'){throw 'Invalid package entry.'}
        $seen[$file.name]=$true
        $source=Join-Path $PSScriptRoot $file.name;Check-Path $source
        if((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -cne $file.sha256){throw 'Package checksum mismatch.'}
    }
    $version=($manifest.files | Where-Object name -eq 'DsfCoverPreview.dll').sha256
    $destination=Join-Path $root $version;Check-Path $destination
    $plan=@(Registration (Join-Path $destination 'DsfCoverPreview.dll'))
    $previous=if($record){@(Registration (Join-Path (Join-Path $root $record.current) 'DsfCoverPreview.dll'))}else{@()}
    # Reject other handlers/values. We do not take over an existing association.
    foreach($entry in $plan){
        $old=Read-Value $entry.path $entry.name
        $prior=@($previous | Where-Object {$_.path -eq $entry.path -and $_.name -eq $entry.name})
        if($null -ne $old -and !($prior.Count -eq 1 -and $old -ceq $prior[0].value)){throw ('Existing registration will not be replaced: '+$entry.path+' '+$entry.name)}
    }
    if(!$record){$record=[pscustomobject]@{schemaVersion=1;owner=$owner;current=$version;versions=@();createdKeys=@()}}
    $paths=@($plan.path)+@($classPath)
    foreach($ext in $extensions){$paths+=@(($base+$ext+'\shellex'),($base+$ext))}
    foreach($path in ($paths | Select-Object -Unique)){
        $key=$machine.OpenSubKey($path)
        if($key){$key.Dispose()}elseif($path -notin $record.createdKeys){$record.createdKeys+=@($path)}
    }
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    foreach($file in $manifest.files){
        $target=Join-Path $destination $file.name;Check-Path $target
        if(Test-Path -LiteralPath $target){
            if((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -cne $file.sha256){throw 'Installed file differs. Refusing to overwrite.'}
        }else{Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file.name) -Destination $target}
    }
    $record.current=$version
    if($version -notin $record.versions){$record.versions+=@($version)}
    $record | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath ($recordPath+'.new') -Encoding UTF8
    Move-Item -LiteralPath ($recordPath+'.new') -Destination $recordPath -Force
    foreach($entry in $plan){
        $key=$machine.CreateSubKey($entry.path)
        try{$key.SetValue($entry.name,$entry.value,[Microsoft.Win32.RegistryValueKind]::String)}finally{$key.Dispose()}
    }
    Notify-Shell
    Write-Output 'Cover pane installed. Thumbnail labels, default apps and originals were preserved.'
} finally {$machine.Dispose()}
