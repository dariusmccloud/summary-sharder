param(
    [switch]$InstallPayload,
    [switch]$RestartHosts
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$summarySharderRoot = Split-Path -Parent $repoRoot

$hosts = @(
    @{
        Name = 'SillyTavern'
        Port = 8000
        Root = 'D:\AI\Projects\SillyTavern'
        Runtime = 'node'
        ProcessPath = 'C:\Program Files\nodejs\node.exe'
        ProcessArgs = @('server.js')
    },
    @{
        Name = 'SillyBunny'
        Port = 4444
        Root = 'D:\AI\Projects\SillyBunny'
        Runtime = 'bun'
        ProcessPath = 'C:\Users\chris\.bun\bin\bun.exe'
        ProcessArgs = @('server.js')
    }
)

$scopes = @{
    seed = 'scope.c0.75.seed'
    target = 'scope.c0.75.target'
    stale = 'scope.c0.75.stale'
    recoveryPrepared = 'scope.c0.75.recovery.prepared'
    recoveryValid = 'scope.c0.75.recovery.valid'
    recoveryInvalid = 'scope.c0.75.recovery.invalid'
}

function Get-ListeningProcessInfo([int]$Port) {
    try {
        $connection = Get-NetTCPConnection -LocalPort $Port -State Listen | Select-Object -First 1
        if (-not $connection) {
            return $null
        }
        $process = Get-Process -Id $connection.OwningProcess -ErrorAction Stop
        return @{
            Id = [int]$process.Id
            ProcessName = $process.ProcessName
            StartTime = $process.StartTime
        }
    } catch {
        return $null
    }
}

function Wait-ForHealth([hashtable]$HostSpec, [int]$Attempts = 60) {
    for ($i = 0; $i -lt $Attempts; $i++) {
        Start-Sleep -Seconds 1
        try {
            Invoke-WebRequest -Uri "http://127.0.0.1:$($HostSpec.Port)/api/plugins/summary-sharder-memory/health" -UseBasicParsing -TimeoutSec 2 | Out-Null
            return
        } catch {}
    }
    throw "Host $($HostSpec.Name) did not become healthy on port $($HostSpec.Port)."
}

function Restart-Host([hashtable]$HostSpec) {
    $before = Get-ListeningProcessInfo -Port $HostSpec.Port
    if ($before) {
        Stop-Process -Id $before.Id -Force -ErrorAction Stop
    }
    Start-Process -FilePath $HostSpec.ProcessPath -ArgumentList $HostSpec.ProcessArgs -WorkingDirectory $HostSpec.Root -WindowStyle Hidden
    Wait-ForHealth -HostSpec $HostSpec
    $after = Get-ListeningProcessInfo -Port $HostSpec.Port
    if (-not $after) {
        throw "Restart of $($HostSpec.Name) did not produce a listening process."
    }
    return @{
        before = $before
        after = $after
        replacedProcess = ($before -and $after.Id -ne $before.Id)
    }
}

function Get-FileFingerprint([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) {
        return $null
    }
    $item = Get-Item -LiteralPath $Path
    return @{
        path = $Path
        bytes = [int64]$item.Length
        sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    }
}

function Get-StoragePaths([hashtable]$HostSpec) {
    $userRoot = Join-Path $HostSpec.Root 'data\default-user'
    $storageRoot = Join-Path $userRoot 'summary-sharder'
    return @{
        userRoot = $userRoot
        storageRoot = $storageRoot
        dbPath = Join-Path $storageRoot 'architectural-memory.db'
        snapshotPath = Join-Path $storageRoot 'architectural-memory.snapshot.db'
        statePath = Join-Path $storageRoot 'architectural-memory.state.json'
        promotionsRoot = Join-Path $storageRoot 'promotions'
        promotionJournalPath = Join-Path $storageRoot 'promotions\promotion-journal.jsonl'
        generationsRoot = Join-Path $storageRoot 'generations'
    }
}

function Reset-AuthorityStorage([hashtable]$HostSpec) {
    $paths = Get-StoragePaths -HostSpec $HostSpec
    if (Test-Path -LiteralPath $paths.storageRoot) {
        Remove-Item -LiteralPath $paths.storageRoot -Recurse -Force
    }
}

function Get-StorageFingerprints([hashtable]$HostSpec) {
    $paths = Get-StoragePaths -HostSpec $HostSpec
    return @{
        db = Get-FileFingerprint $paths.dbPath
        snapshot = Get-FileFingerprint $paths.snapshotPath
        state = Get-FileFingerprint $paths.statePath
        promotionJournal = Get-FileFingerprint $paths.promotionJournalPath
        wal = Get-FileFingerprint "$($paths.dbPath)-wal"
        shm = Get-FileFingerprint "$($paths.dbPath)-shm"
    }
}

function Get-CorpusFingerprints([hashtable]$HostSpec, [object[]]$WrittenEntries) {
    $fingerprints = @{}
    foreach ($entry in @($WrittenEntries | Where-Object { $_.hostRoot -eq $HostSpec.Root -or $_.hostRoot -eq $HostSpec.Root.Replace('\', '/') })) {
        $fingerprints[$entry.chatLocator] = Get-FileFingerprint $entry.chatFilePath
    }
    return $fingerprints
}

function Get-CsrfSession([int]$Port) {
    $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    $csrf = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/csrf-token" -WebSession $session -UseBasicParsing -TimeoutSec 15
    $token = (($csrf.Content | ConvertFrom-Json).token)
    return @{
        Session = $session
        Token = $token
    }
}

function Invoke-JsonRequest {
    param(
        [string]$Method,
        [string]$Uri,
        [object]$Body = $null,
        [Microsoft.PowerShell.Commands.WebRequestSession]$Session = $null,
        [string]$CsrfToken = $null,
        [int]$TimeoutSec = 60
    )

    $headers = @{}
    if ($CsrfToken) {
        $headers['x-csrf-token'] = $CsrfToken
    }
    $params = @{
        Uri = $Uri
        Method = $Method
        UseBasicParsing = $true
        TimeoutSec = $TimeoutSec
    }
    if ($Session) {
        $params.WebSession = $Session
    }
    if ($headers.Count -gt 0) {
        $params.Headers = $headers
    }
    if ($null -ne $Body) {
        $params.ContentType = 'application/json'
        $params.Body = ($Body | ConvertTo-Json -Depth 30 -Compress)
    }
    $response = Invoke-WebRequest @params
    return $response.Content | ConvertFrom-Json
}

function Invoke-JsonRequestAllowError {
    param(
        [string]$Method,
        [string]$Uri,
        [object]$Body = $null,
        [Microsoft.PowerShell.Commands.WebRequestSession]$Session = $null,
        [string]$CsrfToken = $null,
        [int]$TimeoutSec = 60
    )

    try {
        $bodyResult = Invoke-JsonRequest -Method $Method -Uri $Uri -Body $Body -Session $Session -CsrfToken $CsrfToken -TimeoutSec $TimeoutSec
        return @{
            status = 200
            body = $bodyResult
        }
    } catch {
        $status = 500
        try {
            $status = [int]$_.Exception.Response.StatusCode.value__
        } catch {}
        $raw = $_.ErrorDetails.Message
        $parsed = $null
        if ($raw) {
            try {
                $parsed = $raw | ConvertFrom-Json
            } catch {}
        }
        return @{
            status = $status
            body = $parsed
            raw = $raw
        }
    }
}

function Get-NoTokenPromotionStatus([hashtable]$HostSpec) {
    return Invoke-JsonRequestAllowError -Method 'POST' -Uri "http://127.0.0.1:$($HostSpec.Port)/api/plugins/summary-sharder-memory/rebuild/promotion/authorize" -Body @{
        reconstructionRunId = 'missing'
        authorizedBy = 'proof'
    } -TimeoutSec 15
}

function Invoke-CandidateRun {
    param(
        [hashtable]$HostSpec,
        [string]$ScopeId,
        [string]$RequestKey
    )

    $csrf = Get-CsrfSession -Port $HostSpec.Port
    $base = "http://127.0.0.1:$($HostSpec.Port)/api/plugins/summary-sharder-memory"
    $init = Invoke-JsonRequest -Method 'POST' -Uri "$base/rebuild/candidate/init" -Body @{
        memoryScopeId = $ScopeId
        requestKey = $RequestKey
    } -Session $csrf.Session -CsrfToken $csrf.Token
    $run = Invoke-JsonRequest -Method 'POST' -Uri "$base/rebuild/candidate/run" -Body @{
        reconstructionRunId = $init.manifest.reconstructionRunId
    } -Session $csrf.Session -CsrfToken $csrf.Token -TimeoutSec 90
    $report = Invoke-JsonRequest -Method 'GET' -Uri "$base/rebuild/candidate/report/$($init.manifest.reconstructionRunId)" -Session $csrf.Session -TimeoutSec 30
    return @{
        csrf = $csrf
        init = $init
        run = $run
        report = $report
    }
}

function Invoke-PromotionAuthorization {
    param(
        [hashtable]$HostSpec,
        [hashtable]$Csrf,
        [string]$ReconstructionRunId,
        [string]$AuthorizedBy
    )

    return Invoke-JsonRequest -Method 'POST' -Uri "http://127.0.0.1:$($HostSpec.Port)/api/plugins/summary-sharder-memory/rebuild/promotion/authorize" -Body @{
        reconstructionRunId = $ReconstructionRunId
        authorizedBy = $AuthorizedBy
        expiresAt = [int64]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + 3600000)
    } -Session $Csrf.Session -CsrfToken $Csrf.Token -TimeoutSec 30
}

function Invoke-PromotionExecution {
    param(
        [hashtable]$HostSpec,
        [hashtable]$Csrf,
        [string]$AuthorizationId
    )

    return Invoke-JsonRequest -Method 'POST' -Uri "http://127.0.0.1:$($HostSpec.Port)/api/plugins/summary-sharder-memory/rebuild/promotion/execute" -Body @{
        authorizationId = $AuthorizationId
    } -Session $Csrf.Session -CsrfToken $Csrf.Token -TimeoutSec 90
}

function Invoke-PromotionExecutionAllowError {
    param(
        [hashtable]$HostSpec,
        [hashtable]$Csrf,
        [string]$AuthorizationId
    )

    return Invoke-JsonRequestAllowError -Method 'POST' -Uri "http://127.0.0.1:$($HostSpec.Port)/api/plugins/summary-sharder-memory/rebuild/promotion/execute" -Body @{
        authorizationId = $AuthorizationId
    } -Session $Csrf.Session -CsrfToken $Csrf.Token -TimeoutSec 90
}

function Get-VerifiedCandidateHash([string]$CandidateDbPath) {
    $script = @'
import { computePersistedCanonicalCandidateState } from "__ROOT_URL__/tools/server-plugin/summary-sharder-memory/rebuild.js";

const state = computePersistedCanonicalCandidateState("__DB__");
process.stdout.write(state.canonicalCandidateHash);
'@
    $rootUrl = 'file:///' + ($summarySharderRoot.Replace('\', '/') -replace ' ', '%20')
    $script = $script.Replace('__ROOT_URL__', $rootUrl).Replace('__DB__', $CandidateDbPath.Replace('\', '/'))
    return (@($script | node --input-type=module -) -join '').Trim()
}

function Get-LiveScopeState {
    param(
        [hashtable]$HostSpec,
        [string[]]$ScopeIds
    )

    $rootUrl = 'file:///' + ($summarySharderRoot.Replace('\', '/') -replace ' ', '%20')
    $script = @'
import fs from "node:fs";
import { getStoragePaths, readOperationalStateMarker, resolveOperationalDbPath } from "__ROOT_URL__/tools/server-plugin/summary-sharder-memory/core.js";
import { computeScopedAuthorityState } from "__ROOT_URL__/tools/server-plugin/summary-sharder-memory/rebuild.js";

const userRoot = process.env.SUMMARY_SHARDER_USER_ROOT;
const scopeIds = JSON.parse(process.env.SUMMARY_SHARDER_SCOPE_IDS || "[]");
const paths = getStoragePaths(userRoot);
const marker = readOperationalStateMarker(paths);
const dbPath = resolveOperationalDbPath(paths, marker);
const scopes = {};
for (const scopeId of scopeIds) {
    scopes[scopeId] = computeScopedAuthorityState(dbPath, scopeId);
}
process.stdout.write(JSON.stringify({
    dbPath,
    marker,
    scopes,
}));
'@
    $script = $script.Replace('__ROOT_URL__', $rootUrl)
    $userRoot = (Get-StoragePaths -HostSpec $HostSpec).userRoot
    $previousUserRoot = $env:SUMMARY_SHARDER_USER_ROOT
    $previousScopeIds = $env:SUMMARY_SHARDER_SCOPE_IDS
    try {
        $env:SUMMARY_SHARDER_USER_ROOT = $userRoot.Replace('\', '/')
        $env:SUMMARY_SHARDER_SCOPE_IDS = ($ScopeIds | ConvertTo-Json -Compress)
        $output = @($script | node --input-type=module -)
        return ($output -join '') | ConvertFrom-Json
    } finally {
        $env:SUMMARY_SHARDER_USER_ROOT = $previousUserRoot
        $env:SUMMARY_SHARDER_SCOPE_IDS = $previousScopeIds
    }
}

function Get-LiveTableNames([hashtable]$HostSpec) {
    $rootUrl = 'file:///' + ($summarySharderRoot.Replace('\', '/') -replace ' ', '%20')
    $script = @'
import { createAdapter, getStoragePaths, readOperationalStateMarker, resolveOperationalDbPath } from "__ROOT_URL__/tools/server-plugin/summary-sharder-memory/core.js";

const userRoot = process.env.SUMMARY_SHARDER_USER_ROOT;
const paths = getStoragePaths(userRoot);
const marker = readOperationalStateMarker(paths);
const dbPath = resolveOperationalDbPath(paths, marker);
const adapter = createAdapter(dbPath);
try {
    const names = adapter.all(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name ASC`).map((row) => row.name);
    process.stdout.write(JSON.stringify(names));
} finally {
    adapter.close();
}
'@
    $script = $script.Replace('__ROOT_URL__', $rootUrl)
    $userRoot = (Get-StoragePaths -HostSpec $HostSpec).userRoot
    $previousUserRoot = $env:SUMMARY_SHARDER_USER_ROOT
    try {
        $env:SUMMARY_SHARDER_USER_ROOT = $userRoot.Replace('\', '/')
        $output = @($script | node --input-type=module -)
        return ($output -join '') | ConvertFrom-Json
    } finally {
        $env:SUMMARY_SHARDER_USER_ROOT = $previousUserRoot
    }
}

function Get-ScopeCanonicalHash($ScopeStateResult, [string]$ScopeId) {
    $entry = $ScopeStateResult.scopes.PSObject.Properties[$ScopeId]
    if (-not $entry) {
        return $null
    }
    return $entry.Value.canonicalAuthorityHash
}

function Set-RecoveryMarkerState {
    param(
        [hashtable]$HostSpec,
        [string]$State,
        [switch]$UseParentPointer,
        [switch]$CorruptStagedLive
    )

    $paths = Get-StoragePaths -HostSpec $HostSpec
    $marker = Get-Content -LiteralPath $paths.statePath -Raw | ConvertFrom-Json
    if ($UseParentPointer) {
        $marker.liveAuthority = [pscustomobject]@{
            generationId = $marker.promotionJournal.parentLiveAuthority.generationId
            dbRelativePath = $marker.promotionJournal.parentLiveAuthority.dbRelativePath
            authorityHash = $marker.promotionJournal.parentLiveAuthority.authorityHash
        }
    }
    $marker.promotionJournal.lastState = $State
    $marker.promotionJournal.updatedAt = [int64]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
    if ($CorruptStagedLive) {
        $stagedPath = Join-Path $paths.storageRoot $marker.promotionJournal.liveDbRelativePath
        [System.IO.File]::WriteAllBytes($stagedPath, [System.Text.Encoding]::UTF8.GetBytes('corrupt-staged-live'))
    }
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($paths.statePath, ($marker | ConvertTo-Json -Depth 40), $utf8NoBom)
    return $marker
}

function Get-ReportFingerprint($Report) {
    return @{
        status = $Report.status
        candidateHash = $Report.determinism.canonicalCandidateHash
        candidateHashFinal = $Report.determinism.canonicalHashFinal
        valid = $Report.candidateValidity.valid
        blockerCodes = @($Report.candidateValidity.structuralBlockers | ForEach-Object { $_.code } | Sort-Object)
        scopeHash = $Report.promotionQualification.candidate.authoritySurfaceHash
        livePresence = $Report.promotionQualification.live.presence
        liveHash = $Report.promotionQualification.live.canonicalAuthorityHash
        eligibility = $Report.promotionQualification.eligibility.eligible
        eligibilityCodes = @($Report.promotionQualification.eligibility.reasons | ForEach-Object { $_.code } | Sort-Object)
    }
}

if ($InstallPayload) {
    & powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'install-summary-sharder-memory.ps1') | Out-Null
}

if ($RestartHosts) {
    foreach ($hostSpec in $hosts) {
        Restart-Host -HostSpec $hostSpec | Out-Null
    }
}

$stageOutput = & node (Join-Path $PSScriptRoot 'stage-c0-75-proof-fixtures.mjs')
$stageResult = $stageOutput | ConvertFrom-Json

$results = @()

foreach ($hostSpec in $hosts) {
    Reset-AuthorityStorage -HostSpec $hostSpec
    $corpusBefore = Get-CorpusFingerprints -HostSpec $hostSpec -WrittenEntries $stageResult.written
    $health = Invoke-JsonRequest -Method 'GET' -Uri "http://127.0.0.1:$($hostSpec.Port)/api/plugins/summary-sharder-memory/health" -TimeoutSec 15
    $capabilities = Invoke-JsonRequest -Method 'GET' -Uri "http://127.0.0.1:$($hostSpec.Port)/api/plugins/summary-sharder-memory/capabilities" -TimeoutSec 15
    $noTokenAuthorize = Get-NoTokenPromotionStatus -HostSpec $hostSpec

    $seedRun = Invoke-CandidateRun -HostSpec $hostSpec -ScopeId $scopes.seed -RequestKey "c075-seed-$($hostSpec.Name)"
    $seedCandidateDbPath = Join-Path $hostSpec.Root ("data\default-user\" + $seedRun.run.report.candidateRelativePath.Replace('/', '\'))
    $seedVerifiedHash = Get-VerifiedCandidateHash $seedCandidateDbPath
    $seedAuthorization = Invoke-PromotionAuthorization -HostSpec $hostSpec -Csrf $seedRun.csrf -ReconstructionRunId $seedRun.init.manifest.reconstructionRunId -AuthorizedBy 'c0.75 proof'
    $seedExecute = Invoke-PromotionExecution -HostSpec $hostSpec -Csrf $seedRun.csrf -AuthorizationId $seedAuthorization.authorization.authorizationId
    $seedSecondExecute = Invoke-PromotionExecutionAllowError -HostSpec $hostSpec -Csrf $seedRun.csrf -AuthorizationId $seedAuthorization.authorization.authorizationId

    $targetRun = Invoke-CandidateRun -HostSpec $hostSpec -ScopeId $scopes.target -RequestKey "c075-target-$($hostSpec.Name)"
    $targetCandidateDbPath = Join-Path $hostSpec.Root ("data\default-user\" + $targetRun.run.report.candidateRelativePath.Replace('/', '\'))
    $targetVerifiedHash = Get-VerifiedCandidateHash $targetCandidateDbPath
    $targetAuthorization = Invoke-PromotionAuthorization -HostSpec $hostSpec -Csrf $targetRun.csrf -ReconstructionRunId $targetRun.init.manifest.reconstructionRunId -AuthorizedBy 'c0.75 proof'
    $seedBeforeTarget = Get-LiveScopeState -HostSpec $hostSpec -ScopeIds @($scopes.seed)
    $targetExecute = Invoke-PromotionExecution -HostSpec $hostSpec -Csrf $targetRun.csrf -AuthorizationId $targetAuthorization.authorization.authorizationId
    $seedAfterTarget = Get-LiveScopeState -HostSpec $hostSpec -ScopeIds @($scopes.seed, $scopes.target)

    $restartProof = Restart-Host -HostSpec $hostSpec
    $afterRestartState = Get-LiveScopeState -HostSpec $hostSpec -ScopeIds @($scopes.seed, $scopes.target)

    $staleRun = Invoke-CandidateRun -HostSpec $hostSpec -ScopeId $scopes.stale -RequestKey "c075-stale-$($hostSpec.Name)"
    $staleAuthorization = Invoke-PromotionAuthorization -HostSpec $hostSpec -Csrf $staleRun.csrf -ReconstructionRunId $staleRun.init.manifest.reconstructionRunId -AuthorizedBy 'c0.75 proof'

    $preparedRun = Invoke-CandidateRun -HostSpec $hostSpec -ScopeId $scopes.recoveryPrepared -RequestKey "c075-prepared-$($hostSpec.Name)"
    $preparedAuthorization = Invoke-PromotionAuthorization -HostSpec $hostSpec -Csrf $preparedRun.csrf -ReconstructionRunId $preparedRun.init.manifest.reconstructionRunId -AuthorizedBy 'c0.75 proof'
    $preparedExecute = Invoke-PromotionExecution -HostSpec $hostSpec -Csrf $preparedRun.csrf -AuthorizationId $preparedAuthorization.authorization.authorizationId

    $storageBeforeStaleExecute = Get-StorageFingerprints -HostSpec $hostSpec
    $staleExecute = Invoke-PromotionExecutionAllowError -HostSpec $hostSpec -Csrf $staleRun.csrf -AuthorizationId $staleAuthorization.authorization.authorizationId
    $storageAfterStaleExecute = Get-StorageFingerprints -HostSpec $hostSpec

    $preparedMarkerBeforeRecovery = Set-RecoveryMarkerState -HostSpec $hostSpec -State 'PREPARED' -UseParentPointer
    $preparedRecoveryHealth = Invoke-JsonRequest -Method 'GET' -Uri "http://127.0.0.1:$($hostSpec.Port)/api/plugins/summary-sharder-memory/health" -TimeoutSec 15
    $preparedStateAfterRecovery = Get-LiveScopeState -HostSpec $hostSpec -ScopeIds @($scopes.seed, $scopes.target, $scopes.recoveryPrepared)

    $validRun = Invoke-CandidateRun -HostSpec $hostSpec -ScopeId $scopes.recoveryValid -RequestKey "c075-valid-$($hostSpec.Name)"
    $validAuthorization = Invoke-PromotionAuthorization -HostSpec $hostSpec -Csrf $validRun.csrf -ReconstructionRunId $validRun.init.manifest.reconstructionRunId -AuthorizedBy 'c0.75 proof'
    $validExecute = Invoke-PromotionExecution -HostSpec $hostSpec -Csrf $validRun.csrf -AuthorizationId $validAuthorization.authorization.authorizationId
    $validMarkerBeforeRecovery = Set-RecoveryMarkerState -HostSpec $hostSpec -State 'VERIFYING'
    $validRecoveryHealth = Invoke-JsonRequest -Method 'GET' -Uri "http://127.0.0.1:$($hostSpec.Port)/api/plugins/summary-sharder-memory/health" -TimeoutSec 15
    $validStateAfterRecovery = Get-LiveScopeState -HostSpec $hostSpec -ScopeIds @($scopes.seed, $scopes.target, $scopes.recoveryValid)

    $invalidRun = Invoke-CandidateRun -HostSpec $hostSpec -ScopeId $scopes.recoveryInvalid -RequestKey "c075-invalid-$($hostSpec.Name)"
    $invalidAuthorization = Invoke-PromotionAuthorization -HostSpec $hostSpec -Csrf $invalidRun.csrf -ReconstructionRunId $invalidRun.init.manifest.reconstructionRunId -AuthorizedBy 'c0.75 proof'
    $invalidExecute = Invoke-PromotionExecution -HostSpec $hostSpec -Csrf $invalidRun.csrf -AuthorizationId $invalidAuthorization.authorization.authorizationId
    $invalidMarkerBeforeRecovery = Set-RecoveryMarkerState -HostSpec $hostSpec -State 'VERIFYING' -CorruptStagedLive
    $invalidRecoveryHealth = Invoke-JsonRequest -Method 'GET' -Uri "http://127.0.0.1:$($hostSpec.Port)/api/plugins/summary-sharder-memory/health" -TimeoutSec 15
    $invalidStateAfterRecovery = Get-LiveScopeState -HostSpec $hostSpec -ScopeIds @($scopes.seed, $scopes.target, $scopes.recoveryValid, $scopes.recoveryInvalid)

    $liveTableNames = Get-LiveTableNames -HostSpec $hostSpec
    $corpusAfter = Get-CorpusFingerprints -HostSpec $hostSpec -WrittenEntries $stageResult.written

    $results += @{
        host = $hostSpec.Name
        runtime = $hostSpec.Runtime
        port = $hostSpec.Port
        health = $health
        capabilities = @{
            c0_75_1 = $capabilities.capabilities.c0_75_1
            c0_75_2 = $capabilities.capabilities.c0_75_2
        }
        noTokenAuthorize = $noTokenAuthorize
        seed = @{
            report = Get-ReportFingerprint $seedRun.run.report
            verifiedCandidateHash = $seedVerifiedHash
            candidateHashMatchesVerified = ($seedRun.run.report.determinism.canonicalCandidateHash -eq $seedVerifiedHash)
            authorizationId = $seedAuthorization.authorization.authorizationId
            promotionId = $seedExecute.promotionId
            execute = $seedExecute
            secondExecute = $seedSecondExecute
        }
        target = @{
            report = Get-ReportFingerprint $targetRun.run.report
            verifiedCandidateHash = $targetVerifiedHash
            candidateHashMatchesVerified = ($targetRun.run.report.determinism.canonicalCandidateHash -eq $targetVerifiedHash)
            authorizationId = $targetAuthorization.authorization.authorizationId
            promotionId = $targetExecute.promotionId
            execute = $targetExecute
            seedScopePreserved = ($targetExecute.generation.parentNonTargetAggregateHash -eq $targetExecute.generation.stagedNonTargetAggregateHash)
            targetScopeMatchesCandidate = ($targetExecute.verification.targetScopeHash -eq $targetRun.run.report.promotionQualification.candidate.authoritySurfaceHash)
            restart = @{
                replacedProcess = $restartProof.replacedProcess
                liveGenerationStable = ($seedAfterTarget.marker.liveAuthority.generationId -eq $afterRestartState.marker.liveAuthority.generationId)
                liveHashStable = ($seedAfterTarget.marker.liveAuthority.authorityHash -eq $afterRestartState.marker.liveAuthority.authorityHash)
                seedScopeStable = ((Get-ScopeCanonicalHash $seedAfterTarget $scopes.seed) -eq (Get-ScopeCanonicalHash $afterRestartState $scopes.seed))
                targetScopeStable = ((Get-ScopeCanonicalHash $seedAfterTarget $scopes.target) -eq (Get-ScopeCanonicalHash $afterRestartState $scopes.target))
            }
        }
        staleAuthorization = @{
            authorizationId = $staleAuthorization.authorization.authorizationId
            failedExecute = $staleExecute
            storageUnchanged = ((ConvertTo-Json $storageBeforeStaleExecute -Depth 20) -eq (ConvertTo-Json $storageAfterStaleExecute -Depth 20))
        }
        recoveryPrepared = @{
            promotionId = $preparedExecute.promotionId
            execute = $preparedExecute
            markerBefore = @{
                liveGeneration = $preparedMarkerBeforeRecovery.liveAuthority.generationId
                parentGeneration = $preparedMarkerBeforeRecovery.promotionJournal.parentLiveAuthority.generationId
                liveDbRelativePath = $preparedMarkerBeforeRecovery.promotionJournal.liveDbRelativePath
            }
            recoveredState = $preparedStateAfterRecovery.marker.promotionJournal.lastState
            liveGenerationAfter = $preparedStateAfterRecovery.marker.liveAuthority.generationId
            parentGenerationAfter = $preparedStateAfterRecovery.marker.promotionJournal.parentLiveAuthority.generationId
            healthOk = $preparedRecoveryHealth.ok
        }
        recoveryValid = @{
            promotionId = $validExecute.promotionId
            execute = $validExecute
            markerBefore = @{
                liveGeneration = $validMarkerBeforeRecovery.liveAuthority.generationId
                stagedGeneration = $validMarkerBeforeRecovery.promotionJournal.nextGenerationId
            }
            recoveredState = $validStateAfterRecovery.marker.promotionJournal.lastState
            liveGenerationAfter = $validStateAfterRecovery.marker.liveAuthority.generationId
            healthOk = $validRecoveryHealth.ok
        }
        recoveryInvalid = @{
            promotionId = $invalidExecute.promotionId
            execute = $invalidExecute
            markerBefore = @{
                liveGeneration = $invalidMarkerBeforeRecovery.liveAuthority.generationId
                parentGeneration = $invalidMarkerBeforeRecovery.promotionJournal.parentLiveAuthority.generationId
                stagedRelativePath = $invalidMarkerBeforeRecovery.promotionJournal.liveDbRelativePath
            }
            recoveredState = $invalidStateAfterRecovery.marker.promotionJournal.lastState
            liveGenerationAfter = $invalidStateAfterRecovery.marker.liveAuthority.generationId
            parentGenerationAfter = $invalidStateAfterRecovery.marker.promotionJournal.parentLiveAuthority.generationId
            healthOk = $invalidRecoveryHealth.ok
        }
        liveTables = @($liveTableNames)
        corpusUnchanged = ((ConvertTo-Json $corpusBefore -Depth 20) -eq (ConvertTo-Json $corpusAfter -Depth 20))
    }
}

$summary = @{
    ok = $true
    stagedFixtures = $stageResult
    results = $results
    comparisons = @{
        seedCandidateHashesEqual = ($results[0].seed.report.candidateHash -eq $results[1].seed.report.candidateHash)
        targetCandidateHashesEqual = ($results[0].target.report.candidateHash -eq $results[1].target.report.candidateHash)
        seedFullAuthorityHashesEqual = ($results[0].seed.execute.verification.fullAuthorityHash -eq $results[1].seed.execute.verification.fullAuthorityHash)
        targetFullAuthorityHashesEqual = ($results[0].target.execute.verification.fullAuthorityHash -eq $results[1].target.execute.verification.fullAuthorityHash)
        preparedFullAuthorityHashesEqual = ($results[0].recoveryPrepared.execute.verification.fullAuthorityHash -eq $results[1].recoveryPrepared.execute.verification.fullAuthorityHash)
        validFullAuthorityHashesEqual = ($results[0].recoveryValid.execute.verification.fullAuthorityHash -eq $results[1].recoveryValid.execute.verification.fullAuthorityHash)
        invalidFullAuthorityHashesEqual = ($results[0].recoveryInvalid.execute.verification.fullAuthorityHash -eq $results[1].recoveryInvalid.execute.verification.fullAuthorityHash)
        staleFailureCodesEqual = ($results[0].staleAuthorization.failedExecute.body.code -eq $results[1].staleAuthorization.failedExecute.body.code)
        preparedRecoveryStatesEqual = ($results[0].recoveryPrepared.recoveredState -eq $results[1].recoveryPrepared.recoveredState)
        validRecoveryStatesEqual = ($results[0].recoveryValid.recoveredState -eq $results[1].recoveryValid.recoveredState)
        invalidRecoveryStatesEqual = ($results[0].recoveryInvalid.recoveredState -eq $results[1].recoveryInvalid.recoveredState)
    }
}

$summary | ConvertTo-Json -Depth 50
