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
    },
    @{
        Name = 'SillyBunny'
        Port = 4444
        Root = 'D:\AI\Projects\SillyBunny'
        Runtime = 'bun'
    }
)

$successScope = 'scope.c0.5c2.success'
$conflictScope = 'scope.c0.5c2.conflict'
$malformedScope = 'scope.c0.5c2.malformed'
$naturalScope = 'scope.c0.st'

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

function Get-FileFingerprint([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) {
        return $null
    }
    $item = Get-Item -LiteralPath $Path
    return @{
        relativePath = $Path
        bytes = [int64]$item.Length
        sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    }
}

function Get-LiveFingerprints([hashtable]$HostSpec) {
    $userRoot = Join-Path $HostSpec.Root 'data\default-user'
    $storageRoot = Join-Path $userRoot 'summary-sharder'
    $dbPath = Join-Path $storageRoot 'architectural-memory.db'
    $snapshotPath = Join-Path $storageRoot 'architectural-memory.snapshot.db'
    $statePath = Join-Path $storageRoot 'architectural-memory.state.json'
    return @{
        db = Get-FileFingerprint $dbPath
        snapshot = Get-FileFingerprint $snapshotPath
        state = Get-FileFingerprint $statePath
        wal = Get-FileFingerprint "$dbPath-wal"
        shm = Get-FileFingerprint "$dbPath-shm"
    }
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

function Get-CorpusFingerprints([hashtable]$HostSpec, [object[]]$WrittenEntries) {
    $fingerprints = @{}
    $hostEntries = @($WrittenEntries | Where-Object { $_.hostRoot -eq $HostSpec.Root.Replace('\', '/') -or $_.hostRoot -eq $HostSpec.Root })
    foreach ($entry in $hostEntries) {
        $fingerprints[$entry.chatLocator] = Get-FileFingerprint $entry.chatFilePath
    }
    return $fingerprints
}

function Get-CsrfSession([int]$Port) {
    $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    $csrf = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/csrf-token" -WebSession $session -UseBasicParsing -TimeoutSec 15
    $token = ((($csrf.Content | ConvertFrom-Json).token))
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
    $invokeParams = @{
        Uri = $Uri
        Method = $Method
        UseBasicParsing = $true
        TimeoutSec = $TimeoutSec
    }
    if ($Session) {
        $invokeParams.WebSession = $Session
    }
    if ($headers.Count -gt 0) {
        $invokeParams.Headers = $headers
    }
    if ($null -ne $Body) {
        $invokeParams.ContentType = 'application/json'
        $invokeParams.Body = ($Body | ConvertTo-Json -Depth 20 -Compress)
    }
    $response = Invoke-WebRequest @invokeParams
    return $response.Content | ConvertFrom-Json
}

function Get-NoTokenStatus([hashtable]$HostSpec) {
    try {
        Invoke-WebRequest -Uri "http://127.0.0.1:$($HostSpec.Port)/api/plugins/summary-sharder-memory/rebuild/candidate/init" `
            -Method POST -UseBasicParsing -TimeoutSec 15 `
            -ContentType 'application/json' `
            -Body (@{ memoryScopeId = $successScope; requestKey = "no-token-$($HostSpec.Name)" } | ConvertTo-Json -Compress) | Out-Null
        return 200
    } catch {
        return [int]$_.Exception.Response.StatusCode.value__
    }
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

function Get-ComparisonFingerprint($Report) {
    return @{
        memoryScopeId = $Report.memoryScopeId
        status = $Report.status
        valid = $Report.candidateValidity.valid
        blockerCodes = @($Report.candidateValidity.structuralBlockers | ForEach-Object { $_.code })
        occurrenceGroups = @($Report.occurrenceGroups | ForEach-Object {
            @{
                collisionEvidenceGroupId = $_.collisionEvidenceGroupId
                occurrenceClassification = $_.occurrenceClassification
                occurrenceRuleId = $_.occurrenceRuleId
                canonicalRecordId = $_.canonicalRecordId
            }
        })
        versionLifecycleGroups = @($Report.versionLifecycleGroups | ForEach-Object {
            @{
                versionLifecycleGroupId = $_.versionLifecycleGroupId
                decisionId = $_.decisionId
                versionLifecycleClassification = $_.versionLifecycleClassification
            }
        })
        supersessionComponents = @($Report.supersessionComponents | ForEach-Object {
            @{
                supersessionComponentId = $_.supersessionComponentId
                supersessionLifecycleClassification = $_.supersessionLifecycleClassification
                decisionIds = $_.decisionIds
            }
        })
        tier2CanonicalTargets = @($Report.claimLinks | ForEach-Object { $_.relatedRecordId } | Sort-Object -Unique)
        issueCodes = @($Report.issues | ForEach-Object { $_.code } | Sort-Object)
        candidateHash = $Report.determinism.canonicalCandidateHash
    }
}

function Invoke-PromoteProbe([hashtable]$HostSpec) {
    $csrf = Get-CsrfSession -Port $HostSpec.Port
    try {
        Invoke-WebRequest -Uri "http://127.0.0.1:$($HostSpec.Port)/api/plugins/summary-sharder-memory/rebuild/candidate/promote" `
            -Method POST -UseBasicParsing -TimeoutSec 15 -WebSession $csrf.Session -Headers @{ 'x-csrf-token' = $csrf.Token } | Out-Null
        return 200
    } catch {
        return [int]$_.Exception.Response.StatusCode.value__
    }
}

if ($InstallPayload) {
    & powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'install-summary-sharder-memory.ps1') | Out-Null
}

if ($RestartHosts) {
    $beforeRestart = @{}
    foreach ($hostSpec in $hosts) {
        $beforeRestart[$hostSpec.Name] = Get-ListeningProcessInfo -Port $hostSpec.Port
    }
    foreach ($hostSpec in $hosts) {
        $processInfo = $beforeRestart[$hostSpec.Name]
        if ($processInfo) {
            Stop-Process -Id $processInfo.Id -Force -ErrorAction Stop
        }
    }
    Start-Process -FilePath 'C:\Program Files\nodejs\node.exe' -ArgumentList 'server.js' -WorkingDirectory 'D:\AI\Projects\SillyTavern' -WindowStyle Hidden
    Start-Process -FilePath 'C:\Users\chris\.bun\bin\bun.exe' -ArgumentList 'server.js' -WorkingDirectory 'D:\AI\Projects\SillyBunny' -WindowStyle Hidden
    foreach ($hostSpec in $hosts) {
        $healthReady = $false
        for ($i = 0; $i -lt 60; $i++) {
            Start-Sleep -Seconds 1
            try {
                Invoke-WebRequest -Uri "http://127.0.0.1:$($hostSpec.Port)/api/plugins/summary-sharder-memory/health" -UseBasicParsing -TimeoutSec 2 | Out-Null
                $healthReady = $true
                break
            } catch {}
        }
        if (-not $healthReady) {
            throw "Host restart did not restore health on port $($hostSpec.Port)."
        }
        $afterRestart = Get-ListeningProcessInfo -Port $hostSpec.Port
        if (-not $afterRestart) {
            throw "Host restart did not produce a listening process on port $($hostSpec.Port)."
        }
        $prior = $beforeRestart[$hostSpec.Name]
        if ($prior -and $afterRestart.Id -eq $prior.Id) {
            throw "Host restart on port $($hostSpec.Port) did not replace the prior process (pid $($prior.Id))."
        }
    }
}

$stageOutput = & node (Join-Path $PSScriptRoot 'stage-c0-5c2-proof-fixtures.mjs')
$stageResult = $stageOutput | ConvertFrom-Json

$results = @()

foreach ($hostSpec in $hosts) {
    $before = Get-LiveFingerprints -HostSpec $hostSpec
    $corpusBefore = Get-CorpusFingerprints -HostSpec $hostSpec -WrittenEntries $stageResult.written
    $health = Invoke-JsonRequest -Method 'GET' -Uri "http://127.0.0.1:$($hostSpec.Port)/api/plugins/summary-sharder-memory/health" -TimeoutSec 15
    $capabilities = Invoke-JsonRequest -Method 'GET' -Uri "http://127.0.0.1:$($hostSpec.Port)/api/plugins/summary-sharder-memory/capabilities" -TimeoutSec 15
    $noTokenStatus = Get-NoTokenStatus -HostSpec $hostSpec
    $success = Invoke-CandidateRun -HostSpec $hostSpec -ScopeId $successScope -RequestKey "c05c2-success-$($hostSpec.Name)"
    $conflict = Invoke-CandidateRun -HostSpec $hostSpec -ScopeId $conflictScope -RequestKey "c05c2-conflict-$($hostSpec.Name)"
    $malformed = Invoke-CandidateRun -HostSpec $hostSpec -ScopeId $malformedScope -RequestKey "c05c2-malformed-$($hostSpec.Name)"
    $natural = Invoke-CandidateRun -HostSpec $hostSpec -ScopeId $naturalScope -RequestKey "c05c2-natural-$($hostSpec.Name)"

    $pinResult = Invoke-JsonRequest -Method 'POST' -Uri "http://127.0.0.1:$($hostSpec.Port)/api/plugins/summary-sharder-memory/rebuild/candidate/pin" `
        -Body @{
            reconstructionRunId = $success.init.manifest.reconstructionRunId
            pinned = $true
            pinReason = 'c0.5c2 proof'
        } -Session $success.csrf.Session -CsrfToken $success.csrf.Token
    $runsResult = Invoke-JsonRequest -Method 'GET' -Uri "http://127.0.0.1:$($hostSpec.Port)/api/plugins/summary-sharder-memory/rebuild/candidate/runs/$successScope" `
        -Session $success.csrf.Session -TimeoutSec 30
    $cleanupResult = Invoke-JsonRequest -Method 'POST' -Uri "http://127.0.0.1:$($hostSpec.Port)/api/plugins/summary-sharder-memory/rebuild/candidate/cleanup" `
        -Body @{ memoryScopeId = $successScope } -Session $success.csrf.Session -CsrfToken $success.csrf.Token

    $mutationCsrf = Get-CsrfSession -Port $hostSpec.Port
    $mutationInit = Invoke-JsonRequest -Method 'POST' -Uri "http://127.0.0.1:$($hostSpec.Port)/api/plugins/summary-sharder-memory/rebuild/candidate/init" `
        -Body @{ memoryScopeId = $successScope; requestKey = "c05c2-mutation-$($hostSpec.Name)" } -Session $mutationCsrf.Session -CsrfToken $mutationCsrf.Token
    $mutationFile = Join-Path $hostSpec.Root 'data\default-user\chats\Summary Sharder Proof\C0.5C2 Success Parent.jsonl'
    Add-Content -LiteralPath $mutationFile -Value "`n"
    $mutationRun = Invoke-JsonRequest -Method 'POST' -Uri "http://127.0.0.1:$($hostSpec.Port)/api/plugins/summary-sharder-memory/rebuild/candidate/run" `
        -Body @{ reconstructionRunId = $mutationInit.manifest.reconstructionRunId } -Session $mutationCsrf.Session -CsrfToken $mutationCsrf.Token -TimeoutSec 90
    & node (Join-Path $PSScriptRoot 'stage-c0-5c2-proof-fixtures.mjs') | Out-Null

    $promoteStatus = Invoke-PromoteProbe -HostSpec $hostSpec
    $after = Get-LiveFingerprints -HostSpec $hostSpec
    $corpusAfter = Get-CorpusFingerprints -HostSpec $hostSpec -WrittenEntries $stageResult.written
    $successCandidateDbPath = Join-Path $hostSpec.Root ("data\default-user\" + $success.run.report.candidateRelativePath.Replace('/', '\'))
    $conflictCandidateDbPath = Join-Path $hostSpec.Root ("data\default-user\" + $conflict.run.report.candidateRelativePath.Replace('/', '\'))
    $malformedCandidateDbPath = Join-Path $hostSpec.Root ("data\default-user\" + $malformed.run.report.candidateRelativePath.Replace('/', '\'))
    $successVerifiedHash = Get-VerifiedCandidateHash $successCandidateDbPath
    $conflictVerifiedHash = Get-VerifiedCandidateHash $conflictCandidateDbPath
    $malformedVerifiedHash = Get-VerifiedCandidateHash $malformedCandidateDbPath

    $results += @{
        host = $hostSpec.Name
        runtime = $hostSpec.Runtime
        port = $hostSpec.Port
        noTokenStatus = $noTokenStatus
        promoteStatus = $promoteStatus
        health = $health
        capabilities = @{
            promotionAvailable = $capabilities.capabilities.c0_5a.promotionAvailable
            candidatePinning = $capabilities.capabilities.c0_5a.candidatePinning
            candidateCleanup = $capabilities.capabilities.c0_5a.candidateCleanup
        }
        success = @{
            runId = $success.init.manifest.reconstructionRunId
            fingerprint = Get-ComparisonFingerprint $success.run.report
            reportRetrievalStatus = $success.report.report.status
            pinPinned = $pinResult.report.retention.pinned
            runCount = @($runsResult.runs).Count
            cleanupRemovedRunIds = @($cleanupResult.removedRunIds)
            reportedCandidateHash = $success.run.report.determinism.canonicalCandidateHash
            verifiedCandidateHash = $successVerifiedHash
            candidateHashMatchesVerified = ($success.run.report.determinism.canonicalCandidateHash -eq $successVerifiedHash)
        }
        conflict = @{
            runId = $conflict.init.manifest.reconstructionRunId
            fingerprint = Get-ComparisonFingerprint $conflict.run.report
            reportedCandidateHash = $conflict.run.report.determinism.canonicalCandidateHash
            verifiedCandidateHash = $conflictVerifiedHash
            candidateHashMatchesVerified = ($conflict.run.report.determinism.canonicalCandidateHash -eq $conflictVerifiedHash)
        }
        malformed = @{
            runId = $malformed.init.manifest.reconstructionRunId
            fingerprint = Get-ComparisonFingerprint $malformed.run.report
            reportedCandidateHash = $malformed.run.report.determinism.canonicalCandidateHash
            verifiedCandidateHash = $malformedVerifiedHash
            candidateHashMatchesVerified = ($malformed.run.report.determinism.canonicalCandidateHash -eq $malformedVerifiedHash)
        }
        naturalScope = @{
            runId = $natural.init.manifest.reconstructionRunId
            status = $natural.run.report.status
            blockerCodes = @($natural.run.report.candidateValidity.structuralBlockers | ForEach-Object { $_.code } | Sort-Object)
            genericCollisionPresent = @($natural.run.report.candidateValidity.structuralBlockers | ForEach-Object { $_.code }) -contains 'REBUILD_DECISION_COLLISION'
        }
        mutationInvalidation = @{
            runId = $mutationInit.manifest.reconstructionRunId
            status = $mutationRun.report.status
            liveAuthorityChanged = $mutationRun.report.liveAuthorityChanged
        }
        liveAuthorityUnchanged = ((ConvertTo-Json $before -Depth 10) -eq (ConvertTo-Json $after -Depth 10))
        corpusUnchanged = ((ConvertTo-Json $corpusBefore -Depth 10) -eq (ConvertTo-Json $corpusAfter -Depth 10))
    }
}

$successCompare = $results | ForEach-Object { $_.success.fingerprint }
$conflictCompare = $results | ForEach-Object { $_.conflict.fingerprint }
$malformedCompare = $results | ForEach-Object { $_.malformed.fingerprint }

$summary = @{
    ok = $true
    stagedFixtures = $stageResult
    naturalScope = $naturalScope
    naturalScopeExpectation = 'generic blockers must be replaced by precise c0.5c blockers'
    results = $results
    comparisons = @{
        successEquivalent = ((ConvertTo-Json $successCompare[0] -Depth 20) -eq (ConvertTo-Json $successCompare[1] -Depth 20))
        conflictEquivalent = ((ConvertTo-Json $conflictCompare[0] -Depth 20) -eq (ConvertTo-Json $conflictCompare[1] -Depth 20))
        malformedEquivalent = ((ConvertTo-Json $malformedCompare[0] -Depth 20) -eq (ConvertTo-Json $malformedCompare[1] -Depth 20))
        successVerifiedHashEquivalent = ($results[0].success.verifiedCandidateHash -eq $results[1].success.verifiedCandidateHash)
        conflictVerifiedHashEquivalent = ($results[0].conflict.verifiedCandidateHash -eq $results[1].conflict.verifiedCandidateHash)
        malformedVerifiedHashEquivalent = ($results[0].malformed.verifiedCandidateHash -eq $results[1].malformed.verifiedCandidateHash)
        successReportedHashEquivalent = ($results[0].success.reportedCandidateHash -eq $results[1].success.reportedCandidateHash)
        conflictReportedHashEquivalent = ($results[0].conflict.reportedCandidateHash -eq $results[1].conflict.reportedCandidateHash)
        malformedReportedHashEquivalent = ($results[0].malformed.reportedCandidateHash -eq $results[1].malformed.reportedCandidateHash)
    }
}

$summary | ConvertTo-Json -Depth 30
