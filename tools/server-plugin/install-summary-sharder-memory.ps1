param(
    [string[]]$HostRoots = @(
        'D:\AI\Projects\SillyTavern',
        'D:\AI\Projects\SillyBunny'
    )
)

$ErrorActionPreference = 'Stop'

$source = Join-Path $PSScriptRoot 'summary-sharder-memory'

foreach ($hostRoot in $HostRoots) {
    $pluginsRoot = Join-Path $hostRoot 'plugins'
    if (-not (Test-Path $pluginsRoot)) {
        New-Item -ItemType Directory -Path $pluginsRoot | Out-Null
    }

    $target = Join-Path $pluginsRoot 'summary-sharder-memory'
    if (Test-Path $target) {
        Remove-Item -LiteralPath $target -Recurse -Force
    }

    Copy-Item -LiteralPath $source -Destination $target -Recurse
    Write-Host "Installed summary-sharder-memory to $target"
}
