# Human approves the normal Windows administrator prompt; no policy override.
param([switch]$Elevated)
$ErrorActionPreference='Stop'
$out=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../outputs/windows-preview'))
if(!$Elevated){
    $process=Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Verb RunAs -WindowStyle Hidden -PassThru `
        -ArgumentList @('-NoProfile','-File',('"'+$PSCommandPath+'"'),'-Elevated')
    $process.WaitForExit();exit $process.ExitCode
}
$code=0
Start-Transcript -Path (Join-Path $out 'cover-pane-install.log') -Append | Out-Null
try {
    & (Join-Path $PSScriptRoot 'verify-cover-install.ps1')
    $hash=(Get-FileHash -LiteralPath (Join-Path $out 'DsfCoverPreview.dll') -Algorithm SHA256).Hash.ToLowerInvariant()
    $package=Join-Path $out ('DSF-Cover-Pane-'+$hash.Substring(0,12))
    & (Join-Path $package 'setup-cover-preview.ps1') -Action Install
    & (Join-Path $package 'setup-cover-preview.ps1') -Action Status
}catch{Write-Output $_.Exception.Message;Write-Output $_.ScriptStackTrace;$code=1}
finally{Stop-Transcript | Out-Null}
exit $code
