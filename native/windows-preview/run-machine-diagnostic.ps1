# Developer-only comparison. This requests UAC; it does not bypass it or install DSF file handlers.
param([switch]$Elevated,[switch]$Lifecycle)
$ErrorActionPreference='Stop'
$out=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../outputs/windows-preview'))
if (!$Elevated) {
    $arguments=@('-NoProfile','-File',('"'+$PSCommandPath+'"'),'-Elevated')
    if($Lifecycle){$arguments+='-Lifecycle'}
    $process=Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
        -Verb RunAs -WindowStyle Hidden -PassThru -ArgumentList $arguments
    $process.WaitForExit()
    exit $process.ExitCode
}
$principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Windows administrator approval is required.' }
$exitCode=0
Start-Transcript -Path (Join-Path $out 'machine-diagnostic.log') -Force | Out-Null
whoami /groups /fo csv | Select-String 'S-1-16-|S-1-5-32-544'
try {
    if($Lifecycle){& (Join-Path $PSScriptRoot 'verify-install.ps1') -InspectSeconds 120}
    else{& (Join-Path $PSScriptRoot 'verify-shell.ps1') -Scope Machine -InspectSeconds 120}
}
catch { Write-Output $_.Exception.Message; Write-Output $_.ScriptStackTrace; $exitCode=1 }
finally { Stop-Transcript | Out-Null }
exit $exitCode
