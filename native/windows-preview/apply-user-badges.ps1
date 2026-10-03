# User-launched companion. No elevation, execution-policy override, or sandbox escape.
$ErrorActionPreference='Stop'
$code=0
$transcriptStarted=$false
try {
    Start-Transcript -Path (Join-Path $PSScriptRoot 'label-registration.log') -Append | Out-Null
    $transcriptStarted=$true
    & (Join-Path $PSScriptRoot 'user-badges.ps1') -Action Install
    & (Join-Path $PSScriptRoot 'user-badges.ps1') -Action Status
    Write-Host 'Registration checked. Return to File Explorer and press F5 to verify the labels.'
    Write-Host 'Original files and the default open application were not changed.'
} catch {
    $code=1
    Write-Host ('Registration stopped: '+$_.Exception.Message)
} finally {
    if($transcriptStarted){Stop-Transcript | Out-Null}
}
exit $code
