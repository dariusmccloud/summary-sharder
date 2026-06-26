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
    memorySubjectId = 'character:jeep.png'
    memoryScopeId = 'scope_c063_live'
    activePolicyId = 'jeep-developmental-synthesis-v1'
    prohibitedPolicyId = 'jeep-developmental-synthesis-authority-blocked-v1'
    activeRunId = 'synthrun_c063_live_admitted_v1'
    refusedRunId = 'synthrun_c063_live_refused_v1'
    driftRunId = 'synthrun_c063_live_drift_v1'
    activeInterpretationId = 'interp_c063_live_generated'
    activeInterpretationRevisionId = 'interprev_c063_live_generated_v1'
    activeProposalId = 'synthproposal_c063_live_generated_v1'
    driftProposalId = 'synthproposal_c063_live_drift_v1'
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
        ledgerPath = Join-Path $storageRoot 'interpretive-governance-ledger.jsonl'
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
        ledger = Get-FileFingerprint $paths.ledgerPath
        wal = Get-FileFingerprint "$($paths.dbPath)-wal"
        shm = Get-FileFingerprint "$($paths.dbPath)-shm"
    }
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

function Get-NoTokenPolicyCreateStatus([hashtable]$HostSpec) {
    return Invoke-JsonRequestAllowError -Method 'POST' -Uri "http://127.0.0.1:$($HostSpec.Port)/api/plugins/summary-sharder-memory/interpretive/synthesis/policies" -Body @{
        synthesisPolicyId = $ids.activePolicyId
        policyVersion = 1
        memorySubjectId = $ids.memorySubjectId
        enabled = $true
        allowedTypes = @('ROLE_EVOLUTION', 'PROJECT_TRANSFORMATION', 'RELATIONAL_PROGRESSION')
        allowedAssertionDomains = @('ROLE', 'AUTHORITY', 'RELATIONSHIP')
        prohibitedDomains = @()
        manualTriggerRequiredForHighRisk = $true
        maxCandidatesPerRun = 3
        now = 1782442800000
    } -TimeoutSec 15
}

function New-ActivePolicyBody {
    return @{
        synthesisPolicyId = $ids.activePolicyId
        policyVersion = 1
        memorySubjectId = $ids.memorySubjectId
        enabled = $true
        allowedTypes = @('ROLE_EVOLUTION', 'PROJECT_TRANSFORMATION', 'RELATIONAL_PROGRESSION')
        allowedAssertionDomains = @('ROLE', 'AUTHORITY', 'RELATIONSHIP')
        prohibitedDomains = @()
        manualTriggerRequiredForHighRisk = $true
        maxCandidatesPerRun = 3
        now = 1782442800000
    }
}

function New-ProhibitedPolicyBody {
    return @{
        synthesisPolicyId = $ids.prohibitedPolicyId
        policyVersion = 1
        memorySubjectId = $ids.memorySubjectId
        enabled = $true
        allowedTypes = @('ROLE_EVOLUTION', 'PROJECT_TRANSFORMATION', 'RELATIONAL_PROGRESSION')
        allowedAssertionDomains = @('ROLE', 'AUTHORITY', 'RELATIONSHIP')
        prohibitedDomains = @('AUTHORITY')
        manualTriggerRequiredForHighRisk = $true
        maxCandidatesPerRun = 3
        now = 1782442860000
    }
}

function New-RefusedRunBody {
    return @{
        synthesisRunId = $ids.refusedRunId
        memoryScopeId = $ids.memoryScopeId
        memorySubjectId = $ids.memorySubjectId
        synthesisPolicyId = $ids.prohibitedPolicyId
        requestedInterpretationTypes = @('ROLE_EVOLUTION')
        requestedAssertionDomains = @('ROLE', 'AUTHORITY')
        sharedRelationshipRequested = $false
        personalMeaningRequested = $false
        maxCandidatesRequested = 2
        manualTriggerAcknowledged = $true
        createdByEntityId = 'user:Chris'
        sourceManifestEntries = @(
            @{
                sourceClass = 'STRUCTURAL_RECORD'
                memoryScopeId = $ids.memoryScopeId
                basisRecordId = 'decision:constitutional-sovereignty'
                basisRecordVersion = 1
                basisRecordHash = 'sha256:constitutional-sovereignty'
                speakerEntityId = 'character:jeep.png'
            }
            @{
                sourceClass = 'SOURCE_OCCURRENCE'
                memoryScopeId = $ids.memoryScopeId
                chatInstanceId = 'chat_alpha'
                messageId = 'msg_alpha0000000000000000000000000'
                messageRevisionHash = 'sha256:msg-alpha'
                speakerEntityId = 'user:Chris'
            }
        )
        now = 1782443100000
    }
}

function New-AdmittedRunBody {
    param(
        [string]$RunId,
        [int64]$NowMs
    )

    return @{
        synthesisRunId = $RunId
        memoryScopeId = $ids.memoryScopeId
        memorySubjectId = $ids.memorySubjectId
        synthesisPolicyId = $ids.activePolicyId
        requestedInterpretationTypes = @('ROLE_EVOLUTION')
        requestedAssertionDomains = @('ROLE', 'AUTHORITY', 'RELATIONSHIP')
        sharedRelationshipRequested = $true
        personalMeaningRequested = $true
        maxCandidatesRequested = 1
        manualTriggerAcknowledged = $true
        createdByEntityId = 'user:Chris'
        sourceManifestEntries = @(
            @{
                sourceClass = 'STRUCTURAL_RECORD'
                memoryScopeId = $ids.memoryScopeId
                basisRecordId = 'decision:constitutional-sovereignty'
                basisRecordVersion = 1
                basisRecordHash = 'sha256:constitutional-sovereignty'
                speakerEntityId = 'character:jeep.png'
            }
            @{
                sourceClass = 'SOURCE_OCCURRENCE'
                memoryScopeId = $ids.memoryScopeId
                chatInstanceId = 'chat_alpha'
                messageId = 'msg_alpha0000000000000000000000000'
                messageRevisionHash = 'sha256:msg-alpha'
                speakerEntityId = 'user:Chris'
            }
        )
        now = $NowMs
    }
}

function Get-InterpretiveDbState {
    param(
        [hashtable]$HostSpec,
        [string]$ActiveRunId,
        [string]$ActiveProposalId,
        [string]$ActiveInterpretationRevisionId,
        [string]$DriftRunId,
        [string]$DriftProposalId
    )

    $script = @'
import { createAdapter, getStoragePaths } from "__ROOT_URL__/tools/server-plugin/summary-sharder-memory/core.js";

const userRoot = process.env.SUMMARY_SHARDER_USER_ROOT;
const ids = JSON.parse(process.env.SUMMARY_SHARDER_IDS || "{}");
const paths = getStoragePaths(userRoot);
const adapter = createAdapter(paths.dbPath);

function getCount(tableName) {
    return Number(adapter.get(`SELECT COUNT(*) AS count FROM ${tableName}`).count || 0);
}

function getOptional(sql, params = []) {
    const row = adapter.get(sql, params);
    return row || null;
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

    const policyRows = adapter.all(
        `SELECT synthesis_policy_id, policy_version, policy_hash, enabled, prohibited_domains_json
         FROM interpretation_synthesis_policies
         ORDER BY synthesis_policy_id, policy_version`
    ).map((row) => ({
        synthesisPolicyId: row.synthesis_policy_id,
        policyVersion: Number(row.policy_version),
        policyHash: row.policy_hash,
        enabled: Number(row.enabled) === 1,
        prohibitedDomains: JSON.parse(row.prohibited_domains_json),
    }));

    const activeRun = getOptional(
        `SELECT synthesis_run_id, source_manifest_hash, run_status, failure_code, generated_candidate_ids_json, policy_hash
         FROM interpretation_synthesis_runs
         WHERE synthesis_run_id = ?`,
        [ids.activeRunId],
    );
    const driftRun = getOptional(
        `SELECT synthesis_run_id, source_manifest_hash, run_status, failure_code, generated_candidate_ids_json, policy_hash
         FROM interpretation_synthesis_runs
         WHERE synthesis_run_id = ?`,
        [ids.driftRunId],
    );
    const activeProposal = getOptional(
        `SELECT synthesis_proposal_id, interpretation_revision_id, proposal_status, proposal_content_hash, quarantine_code
         FROM interpretation_synthesis_proposals
         WHERE synthesis_proposal_id = ?`,
        [ids.activeProposalId],
    );
    const driftProposal = getOptional(
        `SELECT synthesis_proposal_id, interpretation_revision_id, proposal_status, proposal_content_hash, quarantine_code
         FROM interpretation_synthesis_proposals
         WHERE synthesis_proposal_id = ?`,
        [ids.driftProposalId],
    );
    const activeGrounding = getOptional(
        `SELECT grounding_envelope_hash, source_manifest_hash, referential_status, aggregate_outcome, scope_assessment,
                counterevidence_present, evaluation_protocol_version, evaluator_config_hash
         FROM interpretation_synthesis_grounding_evaluations
         WHERE synthesis_proposal_id = ?`,
        [ids.activeProposalId],
    );
    const driftGrounding = getOptional(
        `SELECT grounding_envelope_hash, source_manifest_hash, referential_status, aggregate_outcome, scope_assessment,
                counterevidence_present, evaluation_protocol_version, evaluator_config_hash
         FROM interpretation_synthesis_grounding_evaluations
         WHERE synthesis_proposal_id = ?`,
        [ids.driftProposalId],
    );
    const interpretation = getOptional(
        `SELECT interpretation_revision_id, interpretation_id, review_state, subject_disposition_state, publication_state,
                authority_effect, review_envelope_hash
         FROM interpretation_revisions
         WHERE interpretation_revision_id = ?`,
        [ids.activeInterpretationRevisionId],
    );
    const policyBinding = getOptional(
        `SELECT validation_policy_id, policy_version, policy_hash
         FROM interpretation_policy_bindings
         WHERE interpretation_revision_id = ?`,
        [ids.activeInterpretationRevisionId],
    );
    const risk = getOptional(
        `SELECT risk_class, risk_reasons_json
         FROM interpretation_risk_classifications
         WHERE interpretation_revision_id = ?`,
        [ids.activeInterpretationRevisionId],
    );
    const reviewRequests = adapter.all(
        `SELECT reviewer_role, reviewer_entity_id, status, review_envelope_hash
         FROM interpretation_review_requests
         WHERE interpretation_revision_id = ?
         ORDER BY reviewer_role, reviewer_entity_id`,
        [ids.activeInterpretationRevisionId],
    ).map((row) => ({
        reviewerRole: row.reviewer_role,
        reviewerEntityId: row.reviewer_entity_id,
        status: row.status,
        reviewEnvelopeHash: row.review_envelope_hash,
    }));

    process.stdout.write(JSON.stringify({
        structuralCounts,
        interpretiveCounts: {
            synthesisPolicies: getCount('interpretation_synthesis_policies'),
            synthesisRuns: getCount('interpretation_synthesis_runs'),
            synthesisProposals: getCount('interpretation_synthesis_proposals'),
            synthesisGroundingEvaluations: getCount('interpretation_synthesis_grounding_evaluations'),
            interpretationRevisions: getCount('interpretation_revisions'),
            reviewRequests: getCount('interpretation_review_requests'),
        },
        policyRows,
        activeRun: activeRun ? {
            synthesisRunId: activeRun.synthesis_run_id,
            sourceManifestHash: activeRun.source_manifest_hash,
            runStatus: activeRun.run_status,
            failureCode: activeRun.failure_code,
            generatedCandidateIds: JSON.parse(activeRun.generated_candidate_ids_json),
            policyHash: activeRun.policy_hash,
        } : null,
        driftRun: driftRun ? {
            synthesisRunId: driftRun.synthesis_run_id,
            sourceManifestHash: driftRun.source_manifest_hash,
            runStatus: driftRun.run_status,
            failureCode: driftRun.failure_code,
            generatedCandidateIds: JSON.parse(driftRun.generated_candidate_ids_json),
            policyHash: driftRun.policy_hash,
        } : null,
        activeProposal: activeProposal ? {
            synthesisProposalId: activeProposal.synthesis_proposal_id,
            interpretationRevisionId: activeProposal.interpretation_revision_id,
            proposalStatus: activeProposal.proposal_status,
            proposalContentHash: activeProposal.proposal_content_hash,
            quarantineCode: activeProposal.quarantine_code,
        } : null,
        driftProposal: driftProposal ? {
            synthesisProposalId: driftProposal.synthesis_proposal_id,
            interpretationRevisionId: driftProposal.interpretation_revision_id,
            proposalStatus: driftProposal.proposal_status,
            proposalContentHash: driftProposal.proposal_content_hash,
            quarantineCode: driftProposal.quarantine_code,
        } : null,
        activeGrounding: activeGrounding ? {
            groundingEnvelopeHash: activeGrounding.grounding_envelope_hash,
            sourceManifestHash: activeGrounding.source_manifest_hash,
            referentialStatus: activeGrounding.referential_status,
            aggregateOutcome: activeGrounding.aggregate_outcome,
            scopeAssessment: activeGrounding.scope_assessment,
            counterevidencePresent: Number(activeGrounding.counterevidence_present) === 1,
            evaluationProtocolVersion: Number(activeGrounding.evaluation_protocol_version),
            evaluatorConfigHash: activeGrounding.evaluator_config_hash,
        } : null,
        driftGrounding: driftGrounding ? {
            groundingEnvelopeHash: driftGrounding.grounding_envelope_hash,
            sourceManifestHash: driftGrounding.source_manifest_hash,
            referentialStatus: driftGrounding.referential_status,
            aggregateOutcome: driftGrounding.aggregate_outcome,
            scopeAssessment: driftGrounding.scope_assessment,
            counterevidencePresent: Number(driftGrounding.counterevidence_present) === 1,
            evaluationProtocolVersion: Number(driftGrounding.evaluation_protocol_version),
            evaluatorConfigHash: driftGrounding.evaluator_config_hash,
        } : null,
        interpretation: interpretation ? {
            interpretationRevisionId: interpretation.interpretation_revision_id,
            interpretationId: interpretation.interpretation_id,
            reviewState: interpretation.review_state,
            subjectDispositionState: interpretation.subject_disposition_state,
            publicationState: interpretation.publication_state,
            authorityEffect: interpretation.authority_effect,
            reviewEnvelopeHash: interpretation.review_envelope_hash,
        } : null,
        policyBinding: policyBinding ? {
            validationPolicyId: policyBinding.validation_policy_id,
            policyVersion: Number(policyBinding.policy_version),
            policyHash: policyBinding.policy_hash,
        } : null,
        risk: risk ? {
            riskClass: risk.risk_class,
            riskReasons: JSON.parse(risk.risk_reasons_json),
        } : null,
        reviewRequests,
    }));
} finally {
    adapter.close();
}
'@
    $rootUrl = 'file:///' + ($summarySharderRoot.Replace('\', '/') -replace ' ', '%20')
    $script = $script.Replace('__ROOT_URL__', $rootUrl)
    $previousUserRoot = $env:SUMMARY_SHARDER_USER_ROOT
    $previousIds = $env:SUMMARY_SHARDER_IDS
    try {
        $env:SUMMARY_SHARDER_USER_ROOT = (Get-StoragePaths -HostSpec $HostSpec).userRoot.Replace('\', '/')
        $env:SUMMARY_SHARDER_IDS = (@{
            activeRunId = $ActiveRunId
            activeProposalId = $ActiveProposalId
            activeInterpretationRevisionId = $ActiveInterpretationRevisionId
            driftRunId = $DriftRunId
            driftProposalId = $DriftProposalId
        } | ConvertTo-Json -Compress)
        $output = @($script | node --input-type=module -)
        return ($output -join '') | ConvertFrom-Json
    } finally {
        $env:SUMMARY_SHARDER_USER_ROOT = $previousUserRoot
        $env:SUMMARY_SHARDER_IDS = $previousIds
    }
}

function Get-RunFingerprint($Run) {
    $proposal = $Run.proposals[0]
    return @{
        synthesisRunId = $Run.synthesisRunId
        sourceManifestHash = $Run.sourceManifestHash
        runStatus = $Run.runStatus
        failureCode = $Run.failureCode
        generatedCandidateIds = @($Run.generatedCandidateIds)
        policyHash = $Run.policyHash
        proposal = if ($proposal) {
            @{
                synthesisProposalId = $proposal.synthesisProposalId
                interpretationRevisionId = $proposal.interpretationRevisionId
                proposalStatus = $proposal.proposalStatus
                proposalContentHash = $proposal.proposalContentHash
                quarantineCode = $proposal.quarantineCode
                groundingEvaluation = if ($proposal.groundingEvaluation) {
                    @{
                        groundingEnvelopeHash = $proposal.groundingEvaluation.groundingEnvelopeHash
                        sourceManifestHash = $proposal.groundingEvaluation.sourceManifestHash
                        referentialStatus = $proposal.groundingEvaluation.referentialStatus
                        aggregateOutcome = $proposal.groundingEvaluation.aggregateOutcome
                        scopeAssessment = $proposal.groundingEvaluation.scopeAssessment
                        counterevidencePresent = $proposal.groundingEvaluation.counterevidencePresent
                        evaluationProtocolVersion = $proposal.groundingEvaluation.evaluationProtocolVersion
                        evaluatorConfigHash = $proposal.groundingEvaluation.evaluatorConfigHash
                    }
                } else {
                    $null
                }
            }
        } else {
            $null
        }
    }
}

function Get-CandidateFingerprint($Interpretation) {
    return @{
        interpretationId = $Interpretation.interpretationId
        interpretationRevisionId = $Interpretation.interpretationRevisionId
        statement = $Interpretation.statement
        reviewState = $Interpretation.reviewState
        subjectDispositionState = $Interpretation.subjectDispositionState
        publicationState = $Interpretation.publicationState
        authorityEffect = $Interpretation.authorityEffect
        reviewEnvelopeHash = $Interpretation.reviewEnvelopeHash
        policyBinding = @{
            validationPolicyId = $Interpretation.policyBinding.validationPolicyId
            policyVersion = $Interpretation.policyBinding.policyVersion
            policyHash = $Interpretation.policyBinding.policyHash
        }
        risk = @{
            riskClass = $Interpretation.risk.riskClass
            riskReasons = @($Interpretation.risk.riskReasons)
        }
        reviewRequests = @(
            $Interpretation.reviewRequests |
                Sort-Object reviewerRole, reviewerEntityId |
                ForEach-Object {
                    @{
                        reviewerRole = $_.reviewerRole
                        reviewerEntityId = $_.reviewerEntityId
                        status = $_.status
                        reviewEnvelopeHash = $_.reviewEnvelopeHash
                    }
                }
        )
    }
}

function Get-ReviewsFingerprint($Reviews) {
    return @(
        $Reviews |
            Sort-Object reviewerRole, reviewerEntityId |
            ForEach-Object {
                @{
                    reviewerRole = $_.reviewerRole
                    reviewerEntityId = $_.reviewerEntityId
                    status = $_.status
                    obligationState = $_.obligationState
                    blockingReason = $_.blockingReason
                    reviewEnvelopeHash = $_.reviewEnvelopeHash
                }
            }
    )
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
    $policyDefinitions = Invoke-JsonRequest -Method 'GET' -Uri "$base/interpretive/policies" -TimeoutSec 15
    $noTokenPolicyCreate = Get-NoTokenPolicyCreateStatus -HostSpec $hostSpec
    $csrf = Get-CsrfSession -Port $hostSpec.Port

    $prohibitedPolicy = Invoke-JsonRequest -Method 'POST' -Uri "$base/interpretive/synthesis/policies" -Body (New-ProhibitedPolicyBody) -Session $csrf.Session -CsrfToken $csrf.Token -TimeoutSec 30
    $activePolicy = Invoke-JsonRequest -Method 'POST' -Uri "$base/interpretive/synthesis/policies" -Body (New-ActivePolicyBody) -Session $csrf.Session -CsrfToken $csrf.Token -TimeoutSec 30
    $encodedMemorySubjectId = [System.Uri]::EscapeDataString($ids.memorySubjectId)
    $listedPolicies = Invoke-JsonRequest -Method 'GET' -Uri "$base/interpretive/synthesis/policies?memorySubjectId=$encodedMemorySubjectId" -Session $csrf.Session -TimeoutSec 15

    $refusedRun = Invoke-JsonRequest -Method 'POST' -Uri "$base/interpretive/synthesis/runs" -Body (New-RefusedRunBody) -Session $csrf.Session -CsrfToken $csrf.Token -TimeoutSec 30

    $admittedRun = Invoke-JsonRequest -Method 'POST' -Uri "$base/interpretive/synthesis/runs" -Body (New-AdmittedRunBody -RunId $ids.activeRunId -NowMs 1782443105000) -Session $csrf.Session -CsrfToken $csrf.Token -TimeoutSec 30
    $fetchedAdmittedRun = Invoke-JsonRequest -Method 'GET' -Uri "$base/interpretive/synthesis/runs/$($ids.activeRunId)" -Session $csrf.Session -TimeoutSec 15

    $generated = Invoke-JsonRequest -Method 'POST' -Uri "$base/interpretive/synthesis/runs/$($ids.activeRunId)/generate" -Body @{
        adapterId = 'DETERMINISTIC_STUB_V1'
        synthesisProposalId = $ids.activeProposalId
        interpretationId = $ids.activeInterpretationId
        interpretationRevisionId = $ids.activeInterpretationRevisionId
        now = 1782443160000
    } -Session $csrf.Session -CsrfToken $csrf.Token -TimeoutSec 30
    $candidate = Invoke-JsonRequest -Method 'GET' -Uri "$base/interpretive/candidates/$($ids.activeInterpretationRevisionId)" -Session $csrf.Session -TimeoutSec 15
    $reviews = Invoke-JsonRequest -Method 'GET' -Uri "$base/interpretive/reviews?interpretationRevisionId=$($ids.activeInterpretationRevisionId)" -Session $csrf.Session -TimeoutSec 15

    $driftRun = Invoke-JsonRequest -Method 'POST' -Uri "$base/interpretive/synthesis/runs" -Body (New-AdmittedRunBody -RunId $ids.driftRunId -NowMs 1782443220000) -Session $csrf.Session -CsrfToken $csrf.Token -TimeoutSec 30
    $driftGenerated = Invoke-JsonRequest -Method 'POST' -Uri "$base/interpretive/synthesis/runs/$($ids.driftRunId)/generate" -Body @{
        adapterId = 'DETERMINISTIC_STUB_V1'
        synthesisProposalId = $ids.driftProposalId
        expectedSourceManifestHash = 'sha256:stale-manifest'
        now = 1782443280000
    } -Session $csrf.Session -CsrfToken $csrf.Token -TimeoutSec 30
    $fetchedDriftRun = Invoke-JsonRequest -Method 'GET' -Uri "$base/interpretive/synthesis/runs/$($ids.driftRunId)" -Session $csrf.Session -TimeoutSec 15

    $dbStateBeforeRestart = Get-InterpretiveDbState -HostSpec $hostSpec -ActiveRunId $ids.activeRunId -ActiveProposalId $ids.activeProposalId -ActiveInterpretationRevisionId $ids.activeInterpretationRevisionId -DriftRunId $ids.driftRunId -DriftProposalId $ids.driftProposalId
    $storageBeforeRestart = Get-StorageFingerprints -HostSpec $hostSpec

    $restart = Restart-Host -HostSpec $hostSpec

    $healthAfterRestart = Invoke-JsonRequest -Method 'GET' -Uri "$base/health" -TimeoutSec 15
    $capabilitiesAfterRestart = Invoke-JsonRequest -Method 'GET' -Uri "$base/capabilities" -TimeoutSec 15
    $fetchedAdmittedRunAfterRestart = Invoke-JsonRequest -Method 'GET' -Uri "$base/interpretive/synthesis/runs/$($ids.activeRunId)" -TimeoutSec 15
    $candidateAfterRestart = Invoke-JsonRequest -Method 'GET' -Uri "$base/interpretive/candidates/$($ids.activeInterpretationRevisionId)" -TimeoutSec 15
    $reviewsAfterRestart = Invoke-JsonRequest -Method 'GET' -Uri "$base/interpretive/reviews?interpretationRevisionId=$($ids.activeInterpretationRevisionId)" -TimeoutSec 15
    $fetchedDriftRunAfterRestart = Invoke-JsonRequest -Method 'GET' -Uri "$base/interpretive/synthesis/runs/$($ids.driftRunId)" -TimeoutSec 15

    $dbStateAfterRestart = Get-InterpretiveDbState -HostSpec $hostSpec -ActiveRunId $ids.activeRunId -ActiveProposalId $ids.activeProposalId -ActiveInterpretationRevisionId $ids.activeInterpretationRevisionId -DriftRunId $ids.driftRunId -DriftProposalId $ids.driftProposalId
    $storageAfterRestart = Get-StorageFingerprints -HostSpec $hostSpec

    $results += @{
        host = $hostSpec.Name
        runtime = $hostSpec.Runtime
        port = $hostSpec.Port
        health = $health
        healthAfterRestart = $healthAfterRestart
        capabilities = @{
            c0_6_1 = $capabilities.capabilities.c0_6_1
            c0_6_2 = $capabilities.capabilities.c0_6_2
            c0_6_3 = $capabilities.capabilities.c0_6_3
        }
        capabilitiesAfterRestart = @{
            c0_6_1 = $capabilitiesAfterRestart.capabilities.c0_6_1
            c0_6_2 = $capabilitiesAfterRestart.capabilities.c0_6_2
            c0_6_3 = $capabilitiesAfterRestart.capabilities.c0_6_3
        }
        policyDefinitions = @($policyDefinitions.policies | ForEach-Object {
            @{
                validationPolicyId = $_.validationPolicyId
                policyVersion = $_.policyVersion
                requiredGroundingOutcome = $_.requiredGroundingOutcome
                requiredReviewers = @($_.requiredReviewers)
            }
        })
        noTokenPolicyCreate = $noTokenPolicyCreate
        policies = @{
            prohibited = @{
                created = $prohibitedPolicy.created
                synthesisPolicyId = $prohibitedPolicy.synthesisPolicy.synthesisPolicyId
                policyHash = $prohibitedPolicy.synthesisPolicy.policyHash
            }
            active = @{
                created = $activePolicy.created
                synthesisPolicyId = $activePolicy.synthesisPolicy.synthesisPolicyId
                policyHash = $activePolicy.synthesisPolicy.policyHash
            }
            listed = @($listedPolicies.policies | ForEach-Object {
                @{
                    synthesisPolicyId = $_.synthesisPolicyId
                    policyVersion = $_.policyVersion
                    policyHash = $_.policyHash
                    prohibitedDomains = @($_.prohibitedDomains)
                }
            })
        }
        refusedRun = Get-RunFingerprint $refusedRun.synthesisRun
        admittedRun = @{
            initial = Get-RunFingerprint $admittedRun.synthesisRun
            fetched = Get-RunFingerprint $fetchedAdmittedRun.synthesisRun
            generated = Get-RunFingerprint $generated.synthesisRun
            generatedInterpretation = Get-CandidateFingerprint $generated.interpretation
            fetchedCandidate = Get-CandidateFingerprint $candidate.interpretation
            reviews = Get-ReviewsFingerprint $reviews.reviews
        }
        driftRun = @{
            initial = Get-RunFingerprint $driftRun.synthesisRun
            generated = Get-RunFingerprint $driftGenerated.synthesisRun
            fetched = Get-RunFingerprint $fetchedDriftRun.synthesisRun
        }
        persisted = @{
            beforeRestart = $dbStateBeforeRestart
            afterRestart = $dbStateAfterRestart
            routeMatchesDb = @{
                activeRun = ($generated.synthesisRun.sourceManifestHash -eq $dbStateBeforeRestart.activeRun.sourceManifestHash -and
                    $generated.synthesisRun.proposals[0].proposalContentHash -eq $dbStateBeforeRestart.activeProposal.proposalContentHash -and
                    $generated.synthesisRun.proposals[0].groundingEvaluation.groundingEnvelopeHash -eq $dbStateBeforeRestart.activeGrounding.groundingEnvelopeHash)
                candidate = ($candidate.interpretation.reviewEnvelopeHash -eq $dbStateBeforeRestart.interpretation.reviewEnvelopeHash -and
                    $candidate.interpretation.policyBinding.validationPolicyId -eq $dbStateBeforeRestart.policyBinding.validationPolicyId -and
                    $candidate.interpretation.risk.riskClass -eq $dbStateBeforeRestart.risk.riskClass)
                reviews = (($reviews.reviews | Measure-Object).Count -eq ($dbStateBeforeRestart.reviewRequests | Measure-Object).Count)
                driftRun = ($driftGenerated.synthesisRun.proposals[0].groundingEvaluation.referentialStatus -eq $dbStateBeforeRestart.driftGrounding.referentialStatus -and
                    $driftGenerated.synthesisRun.proposals[0].quarantineCode -eq $dbStateBeforeRestart.driftProposal.quarantineCode)
            }
        }
        restart = @{
            replacedProcess = $restart.replacedProcess
            routeDurability = @{
                runStable = ((ConvertTo-Json (Get-RunFingerprint $generated.synthesisRun) -Depth 20) -eq (ConvertTo-Json (Get-RunFingerprint $fetchedAdmittedRunAfterRestart.synthesisRun) -Depth 20))
                candidateStable = ((ConvertTo-Json (Get-CandidateFingerprint $candidate.interpretation) -Depth 20) -eq (ConvertTo-Json (Get-CandidateFingerprint $candidateAfterRestart.interpretation) -Depth 20))
                reviewsStable = ((ConvertTo-Json (Get-ReviewsFingerprint $reviews.reviews) -Depth 20) -eq (ConvertTo-Json (Get-ReviewsFingerprint $reviewsAfterRestart.reviews) -Depth 20))
                driftStable = ((ConvertTo-Json (Get-RunFingerprint $driftGenerated.synthesisRun) -Depth 20) -eq (ConvertTo-Json (Get-RunFingerprint $fetchedDriftRunAfterRestart.synthesisRun) -Depth 20))
            }
            storageStable = ((ConvertTo-Json $storageBeforeRestart -Depth 20) -eq (ConvertTo-Json $storageAfterRestart -Depth 20))
        }
        storage = @{
            beforeRestart = $storageBeforeRestart
            afterRestart = $storageAfterRestart
        }
    }
}

$summary = @{
    ok = $true
    results = $results
    comparisons = @{
        capabilityBlocksEqual = ((ConvertTo-Json $results[0].capabilities -Depth 20) -eq (ConvertTo-Json $results[1].capabilities -Depth 20))
        policyDefinitionsEqual = ((ConvertTo-Json $results[0].policyDefinitions -Depth 20) -eq (ConvertTo-Json $results[1].policyDefinitions -Depth 20))
        activePolicyHashesEqual = ($results[0].policies.active.policyHash -eq $results[1].policies.active.policyHash)
        prohibitedPolicyHashesEqual = ($results[0].policies.prohibited.policyHash -eq $results[1].policies.prohibited.policyHash)
        refusedRunEqual = ((ConvertTo-Json $results[0].refusedRun -Depth 20) -eq (ConvertTo-Json $results[1].refusedRun -Depth 20))
        admittedGeneratedRunEqual = ((ConvertTo-Json $results[0].admittedRun.generated -Depth 20) -eq (ConvertTo-Json $results[1].admittedRun.generated -Depth 20))
        candidateFingerprintsEqual = ((ConvertTo-Json $results[0].admittedRun.fetchedCandidate -Depth 20) -eq (ConvertTo-Json $results[1].admittedRun.fetchedCandidate -Depth 20))
        reviewFingerprintsEqual = ((ConvertTo-Json $results[0].admittedRun.reviews -Depth 20) -eq (ConvertTo-Json $results[1].admittedRun.reviews -Depth 20))
        driftRunEqual = ((ConvertTo-Json $results[0].driftRun.generated -Depth 20) -eq (ConvertTo-Json $results[1].driftRun.generated -Depth 20))
        persistedDbStateEqual = ((ConvertTo-Json $results[0].persisted.beforeRestart -Depth 30) -eq (ConvertTo-Json $results[1].persisted.beforeRestart -Depth 30))
        persistedDbStateStableAcrossRestart = (
            ((ConvertTo-Json $results[0].persisted.beforeRestart -Depth 30) -eq (ConvertTo-Json $results[0].persisted.afterRestart -Depth 30)) -and
            ((ConvertTo-Json $results[1].persisted.beforeRestart -Depth 30) -eq (ConvertTo-Json $results[1].persisted.afterRestart -Depth 30))
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
        noTokenPolicyCreateCodesEqual = ($results[0].noTokenPolicyCreate.status -eq $results[1].noTokenPolicyCreate.status)
    }
}

$summary | ConvertTo-Json -Depth 60
