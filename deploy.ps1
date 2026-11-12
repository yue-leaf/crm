[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Config,
    [switch]$Apply,
    [switch]$Publish,
    [switch]$InspectIdentity,
    [string]$ApproveAction,
    [string]$RetryAction,
    [string]$AdoptBaseToken,
    [string]$AdoptAppId,
    [string]$NodePath
)
$ErrorActionPreference = 'Stop'
if (-not $NodePath) {
    $NodePath = (Get-Command node -ErrorAction Stop).Source
    $nodeVersion = & $NodePath --version
    if ($LASTEXITCODE -ne 0) { throw 'Node.js version check failed' }
    $nodeMajor = [int]($nodeVersion.TrimStart('v').Split('.')[0])
    if ($nodeMajor -lt 22) {
        $bundledNode = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
        if (Test-Path -LiteralPath $bundledNode) { $NodePath = $bundledNode }
    }
}
$runner = Join-Path $PSScriptRoot 'deploy/run.mjs'
$taskArgs = @($runner, '--config', (Resolve-Path -LiteralPath $Config).Path)
if ($Apply) { $taskArgs += '--apply' }
if ($Publish) { $taskArgs += '--publish' }
if ($InspectIdentity) { $taskArgs += '--inspect-identity' }
if ($ApproveAction) { $taskArgs += @('--approve-action', $ApproveAction) }
if ($RetryAction) { $taskArgs += @('--retry-action', $RetryAction) }
if ($AdoptBaseToken) { $taskArgs += @('--adopt-base-token', $AdoptBaseToken) }
if ($AdoptAppId) { $taskArgs += @('--adopt-app-id', $AdoptAppId) }
& $NodePath @taskArgs
exit $LASTEXITCODE
