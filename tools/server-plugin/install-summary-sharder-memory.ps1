param(
    [string[]]$HostRoots = @(
        'D:\AI\Projects\SillyTavern',
        'D:\AI\Projects\SillyBunny'
    )
)

$ErrorActionPreference = 'Stop'

$source = Join-Path $PSScriptRoot 'summary-sharder-memory'
$packager = Join-Path $PSScriptRoot 'package-summary-sharder-memory.mjs'
$payloadManifestPath = Join-Path $source 'payload-manifest.json'

node $packager | Out-Host

if (-not (Test-Path -LiteralPath $payloadManifestPath)) {
    throw "Payload manifest was not generated at $payloadManifestPath"
}

$payloadManifest = Get-Content -LiteralPath $payloadManifestPath -Raw | ConvertFrom-Json

foreach ($hostRoot in $HostRoots) {
    $pluginsRoot = Join-Path $hostRoot 'plugins'
    if (-not (Test-Path $pluginsRoot)) {
        New-Item -ItemType Directory -Path $pluginsRoot | Out-Null
    }

    $target = Join-Path $pluginsRoot 'summary-sharder-memory'
    if (Test-Path $target) {
        Remove-Item -LiteralPath $target -Recurse -Force
    }

    New-Item -ItemType Directory -Path $target | Out-Null
    foreach ($payloadFile in $payloadManifest.payloadFiles) {
        $relativePath = [string]$payloadFile.relativePath
        $sourcePath = Join-Path $source $relativePath
        $targetPath = Join-Path $target $relativePath
        $targetDir = Split-Path -Parent $targetPath
        if (-not (Test-Path -LiteralPath $targetDir)) {
            New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
        }
        Copy-Item -LiteralPath $sourcePath -Destination $targetPath -Force
        $targetHash = (Get-FileHash -LiteralPath $targetPath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($targetHash -ne ([string]$payloadFile.sha256).ToLowerInvariant()) {
            throw "Payload hash mismatch for $relativePath in $target"
        }
    }
    Copy-Item -LiteralPath $payloadManifestPath -Destination (Join-Path $target 'payload-manifest.json') -Force
    Write-Host "Installed summary-sharder-memory to $target"
}
