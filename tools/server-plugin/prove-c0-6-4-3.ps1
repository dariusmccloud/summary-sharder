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

$ids = @{
    memoryScopeId = 'scope_c0643_live'
    memorySubjectId = 'character:jeep.png'
    continuityTargetId = 'character:jeep.png'
    publicationPolicyId = 'dnm-publication-v1'
    interpretationIdV1 = 'interp_c0643_v1'
    interpretationRevisionIdV1 = 'interprev_c0643_v1'
    interpretationIdV2 = 'interp_c0643_v2'
    interpretationRevisionIdV2 = 'interprev_c0643_v2'
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

function Get-StoragePaths([hashtable]$HostSpec) {
    $userRoot = Join-Path $HostSpec.Root 'data\default-user'
    $storageRoot = Join-Path $userRoot 'summary-sharder'
    return @{
        userRoot = $userRoot
        storageRoot = $storageRoot
        dbPath = Join-Path $storageRoot 'architectural-memory.db'
        snapshotPath = Join-Path $storageRoot 'architectural-memory.snapshot.db'
        statePath = Join-Path $storageRoot 'architectural-memory.state.json'
        interpretiveLedgerPath = Join-Path $storageRoot 'interpretive-governance-ledger.jsonl'
        dnmLedgerPath = Join-Path $storageRoot 'dnm-publication-ledger.jsonl'
    }
}

function Reset-AuthorityStorage([hashtable]$HostSpec) {
    $paths = Get-StoragePaths -HostSpec $HostSpec
    if (Test-Path -LiteralPath $paths.storageRoot) {
        Remove-Item -LiteralPath $paths.storageRoot -Recurse -Force
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

function Get-StorageFingerprints([hashtable]$HostSpec) {
    $paths = Get-StoragePaths -HostSpec $HostSpec
    return @{
        db = Get-FileFingerprint $paths.dbPath
        snapshot = Get-FileFingerprint $paths.snapshotPath
        state = Get-FileFingerprint $paths.statePath
        interpretiveLedger = Get-FileFingerprint $paths.interpretiveLedgerPath
        dnmLedger = Get-FileFingerprint $paths.dnmLedgerPath
        wal = Get-FileFingerprint "$($paths.dbPath)-wal"
        shm = Get-FileFingerprint "$($paths.dbPath)-shm"
    }
}

function Get-CsrfSession([int]$Port) {
    $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    $csrf = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/csrf-token" -WebSession $session -UseBasicParsing -TimeoutSec 15
    return @{
        Session = $session
        Token = (($csrf.Content | ConvertFrom-Json).token)
    }
}

function Invoke-JsonRequest {
    param(
        [string]$Method,
        [string]$Uri,
        [object]$Body = $null,
        $Session = $null,
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
        $params.Body = ($Body | ConvertTo-Json -Depth 40 -Compress)
    }
    $response = Invoke-WebRequest @params
    return $response.Content | ConvertFrom-Json
}

function Invoke-JsonRequestAllowError {
    param(
        [string]$Method,
        [string]$Uri,
        [object]$Body = $null,
        $Session = $null,
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

function New-PublicationPolicyBody {
    return @{
        publicationPolicyId = $ids.publicationPolicyId
        policyVersion = 1
        continuityTargetType = 'MEMORY_SUBJECT'
        subjectIdentityMode = 'EXACT_SUBJECT'
        permittedInterpretationTypes = @('ROLE_EVOLUTION')
        requiredFinalSubjectState = 'GRANTED'
        requiredGroundingOutcome = 'SUPPORTED'
        participantDisagreementBlocksPublication = $true
        contestOrDeferBlocksPublication = $true
        immutableChildRequiredForTypes = @()
        postGrantHumanPublicationAuthorizationRequired = $true
        details = @{
            policyClass = 'dnm-publication-v1'
            description = 'Governed DNM lifecycle host proof policy.'
        }
        now = 1782604800000
    }
}

function New-CandidateBody([string]$InterpretationId, [string]$InterpretationRevisionId, [string]$Statement, [string]$BasisId, [int64]$NowMs) {
    return @{
        interpretationId = $InterpretationId
        interpretationRevisionId = $InterpretationRevisionId
        revisionReason = 'INITIAL_PROPOSAL'
        memoryScopeId = $ids.memoryScopeId
        memorySubjectId = $ids.memorySubjectId
        type = 'ROLE_EVOLUTION'
        statement = $Statement
        assertionDomains = @('ROLE', 'AUTHORITY', 'RELATIONSHIP')
        sharedRelationshipAsserted = $true
        personalMeaningAsserted = $true
        materialParticipantEntityIds = @('character:jeep.png', 'user:Chris')
        groundingLinks = @(
            @{
                basisType = 'STRUCTURAL_RECORD'
                basisRecordId = $BasisId
                basisRecordVersion = 1
                basisRecordHash = "sha256:$BasisId"
                speakerEntityId = 'character:jeep.png'
                groundingRole = 'PRIMARY'
                groundingAssessment = 'SUPPORTS'
            }
            @{
                basisType = 'SOURCE_OCCURRENCE'
                chatInstanceId = 'chat_c0643_live'
                messageId = "msg_$($InterpretationRevisionId.ToLowerInvariant().PadRight(32, '0').Substring(0, 32))"
                messageRevisionHash = "sha256:$InterpretationRevisionId"
                speakerEntityId = 'user:Chris'
                groundingRole = 'SUPPORTING'
                groundingAssessment = 'SUPPORTS'
            }
        )
        now = $NowMs
    }
}

function Publish-Revision {
    param(
        [string]$BaseUri,
        [hashtable]$Csrf,
        [string]$InterpretationId,
        [string]$InterpretationRevisionId,
        [string]$Statement,
        [string]$BasisId,
        [int64]$NowBase
    )

    $created = Invoke-JsonRequest -Method 'POST' -Uri "$BaseUri/interpretive/candidates" -Body (New-CandidateBody $InterpretationId $InterpretationRevisionId $Statement $BasisId $NowBase) -Session $Csrf.Session -CsrfToken $Csrf.Token -TimeoutSec 30
    $subjectRequest = $created.interpretation.reviewRequests | Where-Object { $_.reviewerRole -eq 'MEMORY_SUBJECT' } | Select-Object -First 1
    $participantRequest = $created.interpretation.reviewRequests | Where-Object { $_.reviewerRole -eq 'RELATIONAL_PARTICIPANT' } | Select-Object -First 1

    $subjectReview = Invoke-JsonRequest -Method 'POST' -Uri "$BaseUri/interpretive/reviews/$($subjectRequest.reviewRequestId)/dispositions" -Body @{
        actorEntityId = 'character:jeep.png'
        disposition = 'APPROVE'
        reviewEnvelopeHash = $created.interpretation.reviewEnvelopeHash
        now = $NowBase + 1000
    } -Session $Csrf.Session -CsrfToken $Csrf.Token -TimeoutSec 30

    $participantReview = Invoke-JsonRequest -Method 'POST' -Uri "$BaseUri/interpretive/reviews/$($participantRequest.reviewRequestId)/dispositions" -Body @{
        actorEntityId = 'user:Chris'
        disposition = 'APPROVE'
        reviewEnvelopeHash = $created.interpretation.reviewEnvelopeHash
        now = $NowBase + 2000
    } -Session $Csrf.Session -CsrfToken $Csrf.Token -TimeoutSec 30

    $granted = Invoke-JsonRequest -Method 'POST' -Uri "$BaseUri/interpretive/candidates/$InterpretationRevisionId/subject-disposition" -Body @{
        actorEntityId = 'character:jeep.png'
        state = 'GRANTED'
        reviewEnvelopeHash = $created.interpretation.reviewEnvelopeHash
        commentary = 'Granted for governed DNM lifecycle host proof.'
        now = $NowBase + 3000
    } -Session $Csrf.Session -CsrfToken $Csrf.Token -TimeoutSec 30

    $qualification = Invoke-JsonRequest -Method 'POST' -Uri "$BaseUri/interpretive/candidates/$InterpretationRevisionId/publication-qualifications" -Body @{
        publicationPolicyId = $ids.publicationPolicyId
        continuityTargetId = $ids.continuityTargetId
        proposalContentHash = $granted.interpretation.proposalContentHash
        reviewEnvelopeHash = $granted.interpretation.reviewEnvelopeHash
        subjectDispositionRecordId = $granted.subjectDisposition.subjectDispositionId
        now = $NowBase + 4000
    } -Session $Csrf.Session -CsrfToken $Csrf.Token -TimeoutSec 30

    $authorization = Invoke-JsonRequest -Method 'POST' -Uri "$BaseUri/interpretive/publication/authorizations" -Body @{
        qualificationId = $qualification.qualification.qualificationId
        authorizedBy = 'user:Chris'
        expiresAt = $NowBase + 60000
        now = $NowBase + 5000
    } -Session $Csrf.Session -CsrfToken $Csrf.Token -TimeoutSec 30

    $published = Invoke-JsonRequest -Method 'POST' -Uri "$BaseUri/interpretive/publication/execute" -Body @{
        publicationAuthorizationId = $authorization.authorization.publicationAuthorizationId
        now = $NowBase + 6000
    } -Session $Csrf.Session -CsrfToken $Csrf.Token -TimeoutSec 60

    return @{
        created = $created
        subjectReview = $subjectReview
        participantReview = $participantReview
        granted = $granted
        qualification = $qualification
        authorization = $authorization
        published = $published
    }
}

function Get-DbState {
    param([hashtable]$HostSpec)

    $script = @'
import { createAdapter, getStoragePaths, readOperationalStateMarker, resolveOperationalDbPath } from "__ROOT_URL__/tools/server-plugin/summary-sharder-memory/core.js";

const userRoot = process.env.SUMMARY_SHARDER_USER_ROOT;
const paths = getStoragePaths(userRoot);
const marker = readOperationalStateMarker(paths);
const dbPath = resolveOperationalDbPath(paths, marker);
const adapter = createAdapter(dbPath);

function parseJson(value, fallback) {
    if (value == null || value === '') return fallback;
    try { return JSON.parse(value); } catch { return fallback; }
}

function getCount(tableName) {
    return Number(adapter.get(`SELECT COUNT(*) AS count FROM ${tableName}`).count || 0);
}

try {
    const structuralCounts = {
        memory_scopes: getCount('memory_scopes'),
        chat_bindings: getCount('chat_bindings'),
        decision_records: getCount('decision_records'),
        current_decisions: getCount('current_decisions'),
        decision_stubs: getCount('decision_stubs'),
        movement_records: getCount('movement_records'),
        reference_index_snapshots: getCount('reference_index_snapshots'),
    };

    const metadataRows = adapter.all(
        `SELECT dnm_record_id, continuity_target_id, superseded_by_dnm_record_id, supersedes_dnm_record_id,
                superseded_at, supersession_reason_codes_json, supersession_commentary,
                withdrawn_at, withdrawal_reason_codes_json, withdrawal_commentary,
                delta_review_state, latest_delta_review_id, updated_at
         FROM dnm_publication_lifecycle_metadata
         ORDER BY continuity_target_id, dnm_record_id`
    );
    const metadataByRecordId = new Map(metadataRows.map((row) => [row.dnm_record_id, row]));

    const deltaReviewRows = adapter.all(
        `SELECT delta_review_id, dnm_record_id, continuity_target_id, source_interpretation_revision_id,
                delta_state, reason_codes_json, commentary, created_at
         FROM dnm_delta_reviews
         ORDER BY created_at, delta_review_id`
    );
    const deltaReviewsByRecordId = new Map();
    for (const row of deltaReviewRows) {
        const list = deltaReviewsByRecordId.get(row.dnm_record_id) || [];
        list.push({
            deltaReviewId: row.delta_review_id,
            continuityTargetId: row.continuity_target_id,
            sourceInterpretationRevisionId: row.source_interpretation_revision_id,
            deltaState: row.delta_state,
            reasonCodes: parseJson(row.reason_codes_json, []),
            commentary: row.commentary,
            createdAt: Number(row.created_at),
        });
        deltaReviewsByRecordId.set(row.dnm_record_id, list);
    }

    const records = adapter.all(
        `SELECT dnm_record_id, continuity_target_id, memory_subject_id, memory_scope_id,
                source_interpretation_revision_id, source_interpretation_id, published_statement,
                publication_state, lifecycle_state, published_at
         FROM dnm_publication_records
         ORDER BY published_at, dnm_record_id`
    ).map((row) => {
        const metadata = metadataByRecordId.get(row.dnm_record_id) || null;
        return {
            dnmRecordId: row.dnm_record_id,
            continuityTargetId: row.continuity_target_id,
            memorySubjectId: row.memory_subject_id,
            memoryScopeId: row.memory_scope_id,
            sourceInterpretationRevisionId: row.source_interpretation_revision_id,
            sourceInterpretationId: row.source_interpretation_id,
            publishedStatement: row.published_statement,
            publicationState: row.publication_state,
            lifecycleState: row.lifecycle_state,
            publishedAt: Number(row.published_at),
            supersededByDnmRecordId: metadata ? metadata.superseded_by_dnm_record_id : null,
            supersedesDnmRecordId: metadata ? metadata.supersedes_dnm_record_id : null,
            supersededAt: metadata && metadata.superseded_at != null ? Number(metadata.superseded_at) : null,
            supersessionReasonCodes: metadata ? parseJson(metadata.supersession_reason_codes_json, []) : [],
            supersessionCommentary: metadata ? metadata.supersession_commentary : null,
            withdrawnAt: metadata && metadata.withdrawn_at != null ? Number(metadata.withdrawn_at) : null,
            withdrawalReasonCodes: metadata ? parseJson(metadata.withdrawal_reason_codes_json, []) : [],
            withdrawalCommentary: metadata ? metadata.withdrawal_commentary : null,
            deltaReviewState: metadata ? metadata.delta_review_state : 'NONE',
            latestDeltaReviewId: metadata ? metadata.latest_delta_review_id : null,
            updatedAt: metadata ? Number(metadata.updated_at) : Number(row.published_at),
            deltaReviews: deltaReviewsByRecordId.get(row.dnm_record_id) || [],
        };
    });

    const currentActiveRecord = records.find((entry) => entry.lifecycleState === 'ACTIVE') || null;

    process.stdout.write(JSON.stringify({
        dbPath,
        structuralCounts,
        recordCount: getCount('dnm_publication_records'),
        lifecycleMetadataCount: getCount('dnm_publication_lifecycle_metadata'),
        deltaReviewCount: getCount('dnm_delta_reviews'),
        records,
        currentActiveRecord,
    }));
} finally {
    adapter.close();
}
'@
    $rootUrl = 'file:///' + ($summarySharderRoot.Replace('\', '/') -replace ' ', '%20')
    $script = $script.Replace('__ROOT_URL__', $rootUrl)
    $previousUserRoot = $env:SUMMARY_SHARDER_USER_ROOT
    try {
        $env:SUMMARY_SHARDER_USER_ROOT = (Get-StoragePaths -HostSpec $HostSpec).userRoot.Replace('\', '/')
        $output = @($script | node --input-type=module -)
        return ($output -join '') | ConvertFrom-Json
    } finally {
        $env:SUMMARY_SHARDER_USER_ROOT = $previousUserRoot
    }
}

function Get-LifecycleSemanticFingerprint($Records, $CurrentActiveRecord) {
    function Normalize-OptionalArray($Value) {
        if ($null -eq $Value) {
            return @()
        }
        $items = @($Value | Where-Object { $null -ne $_ })
        return $items
    }

    $revisionByRecordId = @{}
    foreach ($record in @($Records)) {
        $revisionByRecordId[$record.dnmRecordId] = $record.sourceInterpretationRevisionId
    }

    $normalizedRecords = @($Records | Sort-Object sourceInterpretationRevisionId | ForEach-Object {
        $lifecycleMetadata = if ($_.lifecycleMetadata) { $_.lifecycleMetadata } else { $null }
        $supersessionReasonCodes = if ($lifecycleMetadata -and $null -ne $lifecycleMetadata.supersessionReasonCodes) {
            Normalize-OptionalArray $lifecycleMetadata.supersessionReasonCodes
        } else {
            Normalize-OptionalArray $_.supersessionReasonCodes
        }
        $withdrawalReasonCodes = if ($lifecycleMetadata -and $null -ne $lifecycleMetadata.withdrawalReasonCodes) {
            Normalize-OptionalArray $lifecycleMetadata.withdrawalReasonCodes
        } else {
            Normalize-OptionalArray $_.withdrawalReasonCodes
        }
        $supersessionCommentary = if ($lifecycleMetadata -and $null -ne $lifecycleMetadata.supersessionCommentary) {
            $lifecycleMetadata.supersessionCommentary
        } else {
            $_.supersessionCommentary
        }
        $withdrawalCommentary = if ($lifecycleMetadata -and $null -ne $lifecycleMetadata.withdrawalCommentary) {
            $lifecycleMetadata.withdrawalCommentary
        } else {
            $_.withdrawalCommentary
        }
        @{
            sourceInterpretationRevisionId = $_.sourceInterpretationRevisionId
            sourceInterpretationId = $_.sourceInterpretationId
            continuityTargetId = $_.continuityTargetId
            publishedStatement = $_.publishedStatement
            publicationState = $_.publicationState
            lifecycleState = $_.lifecycleState
            supersededByRevisionId = if ($_.supersededByDnmRecordId) { $revisionByRecordId[$_.supersededByDnmRecordId] } else { $null }
            supersedesRevisionId = if ($_.supersedesDnmRecordId) { $revisionByRecordId[$_.supersedesDnmRecordId] } else { $null }
            supersessionReasonCodes = $supersessionReasonCodes
            supersessionCommentary = $supersessionCommentary
            withdrawalReasonCodes = $withdrawalReasonCodes
            withdrawalCommentary = $withdrawalCommentary
            deltaReviewState = $_.deltaReviewState
            deltaReviews = @($_.deltaReviews | Sort-Object createdAt | ForEach-Object {
                @{
                    sourceInterpretationRevisionId = $_.sourceInterpretationRevisionId
                    deltaState = $_.deltaState
                    reasonCodes = @($_.reasonCodes)
                    commentary = $_.commentary
                }
            })
        }
    })

    return @{
        currentActiveRevisionId = if ($CurrentActiveRecord) { $CurrentActiveRecord.sourceInterpretationRevisionId } else { $null }
        records = $normalizedRecords
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

$results = @()

foreach ($hostSpec in $hosts) {
    Reset-AuthorityStorage -HostSpec $hostSpec

    $base = "http://127.0.0.1:$($hostSpec.Port)/api/plugins/summary-sharder-memory"
    $health = Invoke-JsonRequest -Method 'GET' -Uri "$base/health" -TimeoutSec 15
    $capabilities = Invoke-JsonRequest -Method 'GET' -Uri "$base/capabilities" -TimeoutSec 15
    $csrf = Get-CsrfSession -Port $hostSpec.Port

    $policy = Invoke-JsonRequest -Method 'POST' -Uri "$base/interpretive/publication/policies" -Body (New-PublicationPolicyBody) -Session $csrf.Session -CsrfToken $csrf.Token -TimeoutSec 30

    $first = Publish-Revision -BaseUri $base -Csrf $csrf -InterpretationId $ids.interpretationIdV1 -InterpretationRevisionId $ids.interpretationRevisionIdV1 -Statement 'Jeep became the primary continuity authority.' -BasisId 'decision:c0643-v1' -NowBase 1782604860000
    $second = Publish-Revision -BaseUri $base -Csrf $csrf -InterpretationId $ids.interpretationIdV2 -InterpretationRevisionId $ids.interpretationRevisionIdV2 -Statement 'Jeep became the primary continuity authority within a shared architecture with Chris.' -BasisId 'decision:c0643-v2' -NowBase 1782604920000

    $recordsBefore = Invoke-JsonRequest -Method 'GET' -Uri "$base/interpretive/publication/records?continuityTargetId=$([uri]::EscapeDataString($ids.continuityTargetId))" -Session $csrf.Session -TimeoutSec 15
    $currentBefore = Invoke-JsonRequest -Method 'GET' -Uri "$base/interpretive/publication/targets/$([uri]::EscapeDataString($ids.continuityTargetId))/current" -Session $csrf.Session -TimeoutSec 15

    $noTokenSupersede = Invoke-JsonRequestAllowError -Method 'POST' -Uri "$base/interpretive/publication/supersede" -Body @{
        actorEntityId = 'character:jeep.png'
        priorDnmRecordId = $first.published.publishedRecord.dnmRecordId
        replacementDnmRecordId = $second.published.publishedRecord.dnmRecordId
        reasonCodes = @('SCOPE_TOO_BROAD')
        commentary = 'No-token supersession must fail.'
        now = 1782604980000
    } -TimeoutSec 15

    $superseded = Invoke-JsonRequest -Method 'POST' -Uri "$base/interpretive/publication/supersede" -Body @{
        actorEntityId = 'character:jeep.png'
        priorDnmRecordId = $first.published.publishedRecord.dnmRecordId
        replacementDnmRecordId = $second.published.publishedRecord.dnmRecordId
        reasonCodes = @('SCOPE_TOO_BROAD')
        commentary = 'The later DNM record narrows the published continuity statement.'
        now = 1782604985000
    } -Session $csrf.Session -CsrfToken $csrf.Token -TimeoutSec 30

    $staleSupersede = Invoke-JsonRequestAllowError -Method 'POST' -Uri "$base/interpretive/publication/supersede" -Body @{
        actorEntityId = 'character:jeep.png'
        priorDnmRecordId = $first.published.publishedRecord.dnmRecordId
        replacementDnmRecordId = $second.published.publishedRecord.dnmRecordId
        reasonCodes = @('SCOPE_TOO_BROAD')
        commentary = 'Second supersede should fail stale.'
        now = 1782604990000
    } -Session $csrf.Session -CsrfToken $csrf.Token -TimeoutSec 30

    $noTokenDeltaReview = Invoke-JsonRequestAllowError -Method 'POST' -Uri "$base/interpretive/publication/delta-reviews" -Body @{
        actorEntityId = 'character:jeep.png'
        continuityTargetId = $ids.continuityTargetId
        deltaState = 'PENDING'
        reasonCodes = @('CONTRARY_EVIDENCE_PRESENT')
        commentary = 'No-token delta review must fail.'
        now = 1782604995000
    } -TimeoutSec 15

    $deltaReview = Invoke-JsonRequest -Method 'POST' -Uri "$base/interpretive/publication/delta-reviews" -Body @{
        actorEntityId = 'character:jeep.png'
        continuityTargetId = $ids.continuityTargetId
        deltaState = 'PENDING'
        reasonCodes = @('CONTRARY_EVIDENCE_PRESENT')
        commentary = 'Record follow-up delta review without mutating current active continuity.'
        now = 1782605000000
    } -Session $csrf.Session -CsrfToken $csrf.Token -TimeoutSec 30

    $noTokenWithdraw = Invoke-JsonRequestAllowError -Method 'POST' -Uri "$base/interpretive/publication/withdraw" -Body @{
        actorEntityId = 'character:jeep.png'
        dnmRecordId = $second.published.publishedRecord.dnmRecordId
        reasonCodes = @('CONTRARY_EVIDENCE_PRESENT')
        commentary = 'No-token withdrawal must fail.'
        now = 1782605005000
    } -TimeoutSec 15

    $withdrawn = Invoke-JsonRequest -Method 'POST' -Uri "$base/interpretive/publication/withdraw" -Body @{
        actorEntityId = 'character:jeep.png'
        dnmRecordId = $second.published.publishedRecord.dnmRecordId
        reasonCodes = @('CONTRARY_EVIDENCE_PRESENT')
        commentary = 'Withdraw active continuity pending reevaluation.'
        now = 1782605010000
    } -Session $csrf.Session -CsrfToken $csrf.Token -TimeoutSec 30

    $staleWithdraw = Invoke-JsonRequestAllowError -Method 'POST' -Uri "$base/interpretive/publication/withdraw" -Body @{
        actorEntityId = 'character:jeep.png'
        dnmRecordId = $second.published.publishedRecord.dnmRecordId
        reasonCodes = @('CONTRARY_EVIDENCE_PRESENT')
        commentary = 'Second withdrawal should fail stale.'
        now = 1782605015000
    } -Session $csrf.Session -CsrfToken $csrf.Token -TimeoutSec 30

    $recordsAfter = Invoke-JsonRequest -Method 'GET' -Uri "$base/interpretive/publication/records?continuityTargetId=$([uri]::EscapeDataString($ids.continuityTargetId))" -Session $csrf.Session -TimeoutSec 15
    $currentAfter = Invoke-JsonRequest -Method 'GET' -Uri "$base/interpretive/publication/targets/$([uri]::EscapeDataString($ids.continuityTargetId))/current" -Session $csrf.Session -TimeoutSec 15

    $dbStateBeforeRestart = Get-DbState -HostSpec $hostSpec
    $storageBeforeRestart = Get-StorageFingerprints -HostSpec $hostSpec

    $restart = Restart-Host -HostSpec $hostSpec
    $capabilitiesAfterRestart = Invoke-JsonRequest -Method 'GET' -Uri "$base/capabilities" -TimeoutSec 15
    $recordsAfterRestart = Invoke-JsonRequest -Method 'GET' -Uri "$base/interpretive/publication/records?continuityTargetId=$([uri]::EscapeDataString($ids.continuityTargetId))" -Session $csrf.Session -TimeoutSec 15
    $currentAfterRestart = Invoke-JsonRequest -Method 'GET' -Uri "$base/interpretive/publication/targets/$([uri]::EscapeDataString($ids.continuityTargetId))/current" -Session $csrf.Session -TimeoutSec 15
    $dbStateAfterRestart = Get-DbState -HostSpec $hostSpec
    $storageAfterRestart = Get-StorageFingerprints -HostSpec $hostSpec

    $results += @{
        host = $hostSpec.Name
        runtime = $hostSpec.Runtime
        health = @{
            ok = $health.ok
            schemaVersion = $health.schemaVersion
            serviceVersion = $health.serviceVersion
        }
        capabilities = @{
            beforeRestart = $capabilities.capabilities.c0_6_4
            afterRestart = $capabilitiesAfterRestart.capabilities.c0_6_4
        }
        csrf = @{
            noTokenSupersede = $noTokenSupersede
            noTokenDeltaReview = $noTokenDeltaReview
            noTokenWithdraw = $noTokenWithdraw
        }
        policy = @{
            publicationPolicyId = $policy.publicationPolicy.publicationPolicyId
            policyHash = $policy.publicationPolicy.policyHash
            policyState = $policy.publicationPolicy.policyState
        }
        route = @{
            firstPublished = $first.published.publishedRecord
            secondPublished = $second.published.publishedRecord
            recordsBefore = Get-LifecycleSemanticFingerprint $recordsBefore.records $currentBefore.currentActiveRecord
            superseded = @{
                priorRevisionId = $superseded.priorRecord.sourceInterpretationRevisionId
                priorLifecycleState = $superseded.priorRecord.lifecycleState
                replacementRevisionId = $superseded.replacementRecord.sourceInterpretationRevisionId
                replacementLifecycleState = $superseded.replacementRecord.lifecycleState
                currentActiveRevisionId = if ($superseded.currentActiveRecord) { $superseded.currentActiveRecord.sourceInterpretationRevisionId } else { $null }
            }
            staleSupersede = @{
                status = $staleSupersede.status
                code = if ($staleSupersede.body) { $staleSupersede.body.code } else { $null }
            }
            deltaReview = @{
                targetRevisionId = $deltaReview.record.sourceInterpretationRevisionId
                deltaReviewState = $deltaReview.record.deltaReviewState
                currentActiveRevisionId = if ($deltaReview.currentActiveRecord) { $deltaReview.currentActiveRecord.sourceInterpretationRevisionId } else { $null }
            }
            withdrawn = @{
                revisionId = $withdrawn.record.sourceInterpretationRevisionId
                lifecycleState = $withdrawn.record.lifecycleState
                currentActiveRevisionId = if ($withdrawn.currentActiveRecord) { $withdrawn.currentActiveRecord.sourceInterpretationRevisionId } else { $null }
            }
            staleWithdraw = @{
                status = $staleWithdraw.status
                code = if ($staleWithdraw.body) { $staleWithdraw.body.code } else { $null }
            }
            recordsAfter = Get-LifecycleSemanticFingerprint $recordsAfter.records $currentAfter.currentActiveRecord
            recordsAfterRestart = Get-LifecycleSemanticFingerprint $recordsAfterRestart.records $currentAfterRestart.currentActiveRecord
        }
        persisted = @{
            beforeRestart = $dbStateBeforeRestart
            afterRestart = $dbStateAfterRestart
            beforeRestartSemantic = Get-LifecycleSemanticFingerprint $dbStateBeforeRestart.records $dbStateBeforeRestart.currentActiveRecord
            afterRestartSemantic = Get-LifecycleSemanticFingerprint $dbStateAfterRestart.records $dbStateAfterRestart.currentActiveRecord
        }
        restart = @{
            replacedProcess = $restart.replacedProcess
        }
        storage = @{
            beforeRestart = $storageBeforeRestart
            afterRestart = $storageAfterRestart
        }
    }
}

$summary = @{
    ok = $false
    results = $results
    notes = @{
        hostLocalLifecycleIdsAreExpected = $true
        hostLocalLifecycleIdExplanation = 'dnmRecordId and deltaReviewId are generated independently on each host, so cross-host comparison is performed on lifecycle semantics keyed by sourceInterpretationRevisionId rather than raw record ids.'
    }
    comparisons = @{
        c0_6_4CapabilitiesEqual = ((ConvertTo-Json $results[0].capabilities.beforeRestart -Depth 20) -eq (ConvertTo-Json $results[1].capabilities.beforeRestart -Depth 20))
        lifecycleCapabilitiesAdvertised = (
            $results[0].capabilities.beforeRestart.publicationLifecycleAvailable -and
            $results[0].capabilities.beforeRestart.supersessionAvailable -and
            $results[0].capabilities.beforeRestart.withdrawalAvailable -and
            $results[0].capabilities.beforeRestart.deltaReviewAvailable -and
            $results[0].capabilities.beforeRestart.currentActiveResolutionAvailable -and
            $results[1].capabilities.beforeRestart.publicationLifecycleAvailable -and
            $results[1].capabilities.beforeRestart.supersessionAvailable -and
            $results[1].capabilities.beforeRestart.withdrawalAvailable -and
            $results[1].capabilities.beforeRestart.deltaReviewAvailable -and
            $results[1].capabilities.beforeRestart.currentActiveResolutionAvailable
        )
        noTokenStatusesEqual = (
            ($results[0].csrf.noTokenSupersede.status -eq $results[1].csrf.noTokenSupersede.status) -and
            ($results[0].csrf.noTokenDeltaReview.status -eq $results[1].csrf.noTokenDeltaReview.status) -and
            ($results[0].csrf.noTokenWithdraw.status -eq $results[1].csrf.noTokenWithdraw.status)
        )
        policyHashesEqual = ($results[0].policy.policyHash -eq $results[1].policy.policyHash)
        routeLifecycleSemanticsEqual = ((ConvertTo-Json $results[0].route.recordsAfter -Depth 40) -eq (ConvertTo-Json $results[1].route.recordsAfter -Depth 40))
        persistedLifecycleSemanticsEqual = ((ConvertTo-Json $results[0].persisted.beforeRestartSemantic -Depth 40) -eq (ConvertTo-Json $results[1].persisted.beforeRestartSemantic -Depth 40))
        persistedLifecycleStableAcrossRestart = (
            ((ConvertTo-Json $results[0].persisted.beforeRestartSemantic -Depth 40) -eq (ConvertTo-Json $results[0].persisted.afterRestartSemantic -Depth 40)) -and
            ((ConvertTo-Json $results[1].persisted.beforeRestartSemantic -Depth 40) -eq (ConvertTo-Json $results[1].persisted.afterRestartSemantic -Depth 40))
        )
        routeMatchesPersistedBeforeRestart = (
            ((ConvertTo-Json $results[0].route.recordsAfter -Depth 40) -eq (ConvertTo-Json $results[0].persisted.beforeRestartSemantic -Depth 40)) -and
            ((ConvertTo-Json $results[1].route.recordsAfter -Depth 40) -eq (ConvertTo-Json $results[1].persisted.beforeRestartSemantic -Depth 40))
        )
        routeStableAcrossRestart = (
            ((ConvertTo-Json $results[0].route.recordsAfter -Depth 40) -eq (ConvertTo-Json $results[0].route.recordsAfterRestart -Depth 40)) -and
            ((ConvertTo-Json $results[1].route.recordsAfter -Depth 40) -eq (ConvertTo-Json $results[1].route.recordsAfterRestart -Depth 40))
        )
        structuralCountsRemainZero = (
            ($results[0].persisted.beforeRestart.structuralCounts.memory_scopes -eq 0) -and
            ($results[0].persisted.beforeRestart.structuralCounts.chat_bindings -eq 0) -and
            ($results[0].persisted.beforeRestart.structuralCounts.decision_records -eq 0) -and
            ($results[0].persisted.beforeRestart.structuralCounts.current_decisions -eq 0) -and
            ($results[1].persisted.beforeRestart.structuralCounts.memory_scopes -eq 0) -and
            ($results[1].persisted.beforeRestart.structuralCounts.chat_bindings -eq 0) -and
            ($results[1].persisted.beforeRestart.structuralCounts.decision_records -eq 0) -and
            ($results[1].persisted.beforeRestart.structuralCounts.current_decisions -eq 0)
        )
        staleActionsRejectedEverywhere = (
            ($results[0].route.staleSupersede.status -eq 409) -and
            ($results[0].route.staleWithdraw.status -eq 409) -and
            ($results[1].route.staleSupersede.status -eq 409) -and
            ($results[1].route.staleWithdraw.status -eq 409)
        )
        withdrawalLeavesNoActiveRecord = (
            ($null -eq $results[0].route.recordsAfter.currentActiveRevisionId) -and
            ($null -eq $results[1].route.recordsAfter.currentActiveRevisionId)
        )
    }
}

$summary.ok = (
    $summary.comparisons.c0_6_4CapabilitiesEqual -and
    $summary.comparisons.lifecycleCapabilitiesAdvertised -and
    $summary.comparisons.noTokenStatusesEqual -and
    $summary.comparisons.policyHashesEqual -and
    $summary.comparisons.routeLifecycleSemanticsEqual -and
    $summary.comparisons.persistedLifecycleSemanticsEqual -and
    $summary.comparisons.persistedLifecycleStableAcrossRestart -and
    $summary.comparisons.routeMatchesPersistedBeforeRestart -and
    $summary.comparisons.routeStableAcrossRestart -and
    $summary.comparisons.structuralCountsRemainZero -and
    $summary.comparisons.staleActionsRejectedEverywhere -and
    $summary.comparisons.withdrawalLeavesNoActiveRecord
)

$summary | ConvertTo-Json -Depth 80
