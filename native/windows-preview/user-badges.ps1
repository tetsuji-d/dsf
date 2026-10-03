# Current-user companion for DSF Studio PWA associations. Never changes the open command.
param([ValidateSet('Status','Install','Uninstall')][string]$Action='Status')
$ErrorActionPreference='Stop'
$owner='DSF.WindowsThumbnail.TypeOverlay.1'
$root=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'DSF Windows Preview'
$recordPath=Join-Path $root 'type-overlays.json'
$user=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryView]::Registry64)
function Read-Overlay($key) {
    if (!$key) { return $null }
    return $key.GetValue('TypeOverlay',$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
}
function Association-Extension($key,[string]$name) {
    if ($name -ceq 'DSFStudio.Project.1') { return '.dsp' }
    if ($name -ceq 'DSFStudio.Publication.1') { return '.dsf' }
    return $key.GetValue('FileExtensions')
}
function Is-DsfAssociation($key,[string]$name,[string]$extension) {
    if (!$key -or $extension -notin @('.dsp','.dsf') -or (Association-Extension $key $name) -cne $extension) { return $false }
    $command=$key.OpenSubKey('shell\open\command')
    try { return $command -and $command.GetValue('') -match '^"[^"\r\n]+\\DSF Studio\.exe"\s+.*--app-id=[a-z]{32}(?:\s|$)' }
    finally { if($command){$command.Dispose()} }
}
try {
    $record=[pscustomobject]@{schemaVersion=1;owner=$owner;entries=@()}
    if (Test-Path -LiteralPath $recordPath) {
        $record=Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
        if ($record.schemaVersion -ne 1 -or $record.owner -ne $owner) { throw 'Unknown user badge record.' }
        $seen=@{}
        foreach ($entry in $record.entries) {
            if ($entry.programId -cnotmatch '^((Chrome|MSEdge)\.[0-9]+|DSFStudio\.(Project|Publication)\.1)$' -or $entry.extension -notin @('.dsp','.dsf') -or $seen[$entry.programId]) { throw 'Invalid user badge record.' }
            $seen[$entry.programId]=$true
        }
    }
    if ($Action -eq 'Status') { $record | ConvertTo-Json -Depth 5; return }
    if ($Action -eq 'Uninstall') {
        foreach ($entry in $record.entries) {
            $key=$user.OpenSubKey(('Software\Classes\'+$entry.programId),$true)
            try {
                if ($key -and (Read-Overlay $key) -ceq $entry.written) {
                    if ($entry.existed) { $key.SetValue('TypeOverlay',[string]$entry.previous,[Microsoft.Win32.RegistryValueKind]::String) }
                    else { $key.DeleteValue('TypeOverlay',$false) }
                }
            } finally { if($key){$key.Dispose()} }
        }
        if (Test-Path -LiteralPath $recordPath) { Remove-Item -LiteralPath $recordPath }
    } else {
        $machine=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine,[Microsoft.Win32.RegistryView]::Registry64)
        try {
            $provider=$machine.OpenSubKey('Software\Classes\CLSID\{7E47A067-4769-4CDC-A9A2-75CD67ECBCC1}')
            if (!$provider -or $provider.GetValue('DSFPreviewOwner') -ne 'DSF.WindowsThumbnail.1') { throw 'Install the DSF Windows thumbnail component first.' }
            $server=$provider.OpenSubKey('InprocServer32')
            try { $dll=$server.GetValue('') } finally { if($server){$server.Dispose()}; $provider.Dispose() }
        } finally { $machine.Dispose() }
        $installRoot=Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'DSF Windows Preview'
        if ($dll -cnotmatch ('^'+[regex]::Escape($installRoot)+'\\([a-f0-9]{64})\\DsfThumbnail\.dll$')) { throw 'Unexpected installed component path.' }
        $expectedHash=$Matches[1]
        if (!(Test-Path -LiteralPath $dll) -or (Get-FileHash -LiteralPath $dll).Hash.ToLowerInvariant() -ne $expectedHash) { throw 'Installed component checksum mismatch.' }
        $classes=$user.OpenSubKey('Software\Classes')
        try { $names=@($classes.GetSubKeyNames() | Where-Object { $_ -cmatch '^((Chrome|MSEdge)\.[0-9]+|DSFStudio\.(Project|Publication)\.1)$' }) }
        finally { $classes.Dispose() }
        $pending=@()
        foreach ($name in $names) {
            $key=$user.OpenSubKey('Software\Classes\'+$name)
            try {
                $extension=Association-Extension $key $name
                if (!(Is-DsfAssociation $key $name $extension)) { continue }
                $entry=@($record.entries | Where-Object programId -eq $name)
                $existing=Read-Overlay $key
                if ($entry.Count) {
                    $entry=$entry[0]
                    if ($entry.extension -cne $extension) { throw 'DSF association changed type. Restore the previous badge first.' }
                    if ($null -ne $existing -and $existing -cne $entry.written -and $existing -cne $entry.previous) { throw 'Another application changed the type overlay. It will not be replaced.' }
                } else {
                    $existed=$key.GetValueNames() -contains 'TypeOverlay'
                    if ($existed -and $key.GetValueKind('TypeOverlay') -ne [Microsoft.Win32.RegistryValueKind]::String) { throw 'Unknown type overlay value kind.' }
                    $entry=[pscustomobject]@{programId=$name;extension=$extension;existed=$existed;previous=$existing;written=''}
                    $record.entries=@($record.entries)+@($entry)
                }
                $resource=if($extension -eq '.dsp'){102}else{101}
                $entry.written=$dll+',-'+$resource
                $pending+=@($entry)
            } finally { $key.Dispose() }
        }
        if ($pending.Count) {
            New-Item -ItemType Directory -Path $root -Force | Out-Null
            $record | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath ($recordPath+'.new') -Encoding UTF8
            Move-Item -LiteralPath ($recordPath+'.new') -Destination $recordPath -Force
            foreach ($entry in $pending) {
                $key=$user.OpenSubKey(('Software\Classes\'+$entry.programId),$true)
                try {
                    if (!(Is-DsfAssociation $key $entry.programId $entry.extension)) { throw 'DSF association changed during registration.' }
                    $key.SetValue('TypeOverlay',$entry.written,[Microsoft.Win32.RegistryValueKind]::String)
                } finally { if($key){$key.Dispose()} }
            }
        }
    }
    if (!('DsfBadgeShell' -as [type])) {
        Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class DsfBadgeShell { [DllImport("shell32.dll")] public static extern void SHChangeNotify(uint e,uint f,IntPtr a,IntPtr b); }'
    }
    [DsfBadgeShell]::SHChangeNotify(0x08000000,0,[IntPtr]::Zero,[IntPtr]::Zero)
    Write-Output "DSF thumbnail labels: $Action completed for this user. Default apps were preserved."
} finally { $user.Dispose() }
