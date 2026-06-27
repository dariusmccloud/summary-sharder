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
    memoryScopeId = 'scope_c064_live'
    memorySubjectId = 'character:jeep.png'
    interpretationId = 'interp_c064_publication'
    parentRevisionId = 'interprev_c064_publication_v1'
    childRevisionId = 'interprev_c064_publication_v2'
    activePublicationPolicyId = 'dnm-publication-v1'
    revokePolicyId = 'dnm-publication-revoked-v1'
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

function New-ActivePublicationPolicyBody {
    return @{
        publicationPolicyId = $ids.activePublicationPolicyId
        policyVersion = 1
        continuityTargetType = 'MEMORY_SUBJECT'
        subjectIdentityMode = 'EXACT_SUBJECT'
        permittedInterpretationTypes = @('ROLE_EVOLUTION', 'RELATIONAL_PROGRESSION')
        requiredFinalSubjectState = 'GRANTED'
        requiredGroundingOutcome = 'SUPPORTED'
        participantDisagreementBlocksPublication = $true
        contestOrDeferBlocksPublication = $true
        immutableChildRequiredForTypes = @('ROLE_EVOLUTION')
        postGrantHumanPublicationAuthorizationRequired = $true
        details = @{
            policyClass = 'dnm-publication-v1'
            description = 'Governed DNM publication policy for C0.6.4 host proof.'
        }
        now = 1782519000000
    }
}

function New-RevokePublicationPolicyBody {
    return @{
        publicationPolicyId = $ids.revokePolicyId
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
            policyClass = 'dnm-publication-revoked-v1'
            description = 'Revocation route proof policy.'
        }
        now = 1782519060000
    }
}

function New-ParentCandidateBody {
    return @{
        interpretationId = $ids.interpretationId
        interpretationRevisionId = $ids.parentRevisionId
        revisionReason = 'INITIAL_PROPOSAL'
        memoryScopeId = $ids.memoryScopeId
        memorySubjectId = $ids.memorySubjectId
        type = 'ROLE_EVOLUTION'
        statement = "Jeep evolved from an analytical role into the primary architectural authority for the extension's design."
        assertionDomains = @('ROLE', 'AUTHORITY', 'RELATIONSHIP')
        sharedRelationshipAsserted = $true
        personalMeaningAsserted = $true
        materialParticipantEntityIds = @('character:jeep.png', 'user:Chris')
        groundingLinks = @(
            @{
                basisType = 'STRUCTURAL_RECORD'
                basisRecordId = 'decision:interpretive-memory-sovereignty'
                basisRecordVersion = 1
                basisRecordHash = 'sha256:decision-c064-structural'
                speakerEntityId = 'character:jeep.png'
                groundingRole = 'PRIMARY'
                groundingAssessment = 'SUPPORTS'
            }
            @{
                basisType = 'SOURCE_OCCURRENCE'
                chatInstanceId = 'chat_c064_live'
                messageId = 'msg_c064live000000000000000000000001'
                messageRevisionHash = 'sha256:msg-c064-live-1'
                speakerEntityId = 'user:Chris'
                groundingRole = 'SUPPORTING'
                groundingAssessment = 'SUPPORTS'
            }
        )
        now = 1782519120000
    }
}

function Get-PublicationDbState {
    param(
        [hashtable]$HostSpec,
        [string]$InterpretationRevisionId,
        [string]$PublicationPolicyId,
        [string]$RevokedPolicyId
    )

    $script = @'
import { createAdapter, getStoragePaths, readOperationalStateMarker, resolveOperationalDbPath } from "__ROOT_URL__/tools/server-plugin/summary-sharder-memory/core.js";

const userRoot = process.env.SUMMARY_SHARDER_USER_ROOT;
const ids = JSON.parse(process.env.SUMMARY_SHARDER_IDS || "{}");
const paths = getStoragePaths(userRoot);
const marker = readOperationalStateMarker(paths);
const dbPath = resolveOperationalDbPath(paths, marker);
const adapter = createAdapter(dbPath);

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

    const publicationPolicies = adapter.all(
        `SELECT publication_policy_id, policy_version, policy_hash, policy_state, revocation_reason
         FROM interpretation_publication_policies
         ORDER BY publication_policy_id, policy_version`
    ).map((row) => ({
        publicationPolicyId: row.publication_policy_id,
        policyVersion: Number(row.policy_version),
        policyHash: row.policy_hash,
        policyState: row.policy_state,
        revocationReason: row.revocation_reason,
    }));

    const authorizations = adapter.all(
        `SELECT publication_authorization_id, qualification_id, interpretation_revision_id, publication_policy_id,
                policy_version, policy_hash, continuity_target_id, memory_scope_id, memory_subject_id,
                qualification_binding_hash, authorized_by, authorized_at, expires_at, status, consumed_at, dnm_record_id
         FROM interpretation_publication_authorizations
         ORDER BY authorized_at, publication_authorization_id`
    ).map((row) => ({
        publicationAuthorizationId: row.publication_authorization_id,
        qualificationId: row.qualification_id,
        interpretationRevisionId: row.interpretation_revision_id,
        publicationPolicyId: row.publication_policy_id,
        policyVersion: Number(row.policy_version),
        policyHash: row.policy_hash,
        continuityTargetId: row.continuity_target_id,
        memoryScopeId: row.memory_scope_id,
        memorySubjectId: row.memory_subject_id,
        qualificationBindingHash: row.qualification_binding_hash,
        authorizedBy: row.authorized_by,
        authorizedAt: Number(row.authorized_at),
        expiresAt: Number(row.expires_at),
        status: row.status,
        consumedAt: row.consumed_at === null ? null : Number(row.consumed_at),
        dnmRecordId: row.dnm_record_id,
    }));

    const qualifications = adapter.all(
        `SELECT qualification_id, interpretation_revision_id, publication_policy_id, policy_version, policy_hash,
                continuity_target_id, eligibility_verdict, refusal_codes_json, binding_json, evaluated_at
         FROM interpretation_publication_qualifications
         ORDER BY evaluated_at, qualification_id`
    ).map((row) => ({
        qualificationId: row.qualification_id,
        interpretationRevisionId: row.interpretation_revision_id,
        publicationPolicyId: row.publication_policy_id,
        policyVersion: Number(row.policy_version),
        policyHash: row.policy_hash,
        continuityTargetId: row.continuity_target_id,
        eligibilityVerdict: row.eligibility_verdict,
        refusalCodes: JSON.parse(row.refusal_codes_json),
        binding: JSON.parse(row.binding_json),
        evaluatedAt: Number(row.evaluated_at),
    }));

    const publishedRecords = adapter.all(
        `SELECT dnm_record_id, continuity_target_id, memory_subject_id, memory_scope_id,
                source_interpretation_revision_id, source_interpretation_id, published_statement,
                proposal_content_hash, grounding_binding_mode, grounding_envelope_hash,
                grounding_protocol_version, grounding_source_set_hash, review_envelope_hash,
                publication_policy_id, publication_policy_version, publication_policy_hash,
                publication_state, lifecycle_state, published_at, publication_authorization_id
         FROM dnm_publication_records
         ORDER BY published_at, dnm_record_id`
    ).map((row) => ({
        dnmRecordId: row.dnm_record_id,
        continuityTargetId: row.continuity_target_id,
        memorySubjectId: row.memory_subject_id,
        memoryScopeId: row.memory_scope_id,
        sourceInterpretationRevisionId: row.source_interpretation_revision_id,
        sourceInterpretationId: row.source_interpretation_id,
        publishedStatement: row.published_statement,
        proposalContentHash: row.proposal_content_hash,
        groundingBindingMode: row.grounding_binding_mode,
        groundingEnvelopeHash: row.grounding_envelope_hash,
        groundingProtocolVersion: Number(row.grounding_protocol_version),
        groundingSourceSetHash: row.grounding_source_set_hash,
        reviewEnvelopeHash: row.review_envelope_hash,
        publicationPolicyId: row.publication_policy_id,
        publicationPolicyVersion: Number(row.publication_policy_version),
        publicationPolicyHash: row.publication_policy_hash,
        publicationState: row.publication_state,
        lifecycleState: row.lifecycle_state,
        publishedAt: Number(row.published_at),
        publicationAuthorizationId: row.publication_authorization_id,
    }));

    const interpretation = getOptional(
        `SELECT interpretation_revision_id, interpretation_id, memory_scope_id, memory_subject_id,
                review_state, subject_disposition_state, publication_state, authority_effect,
                proposal_content_hash, review_envelope_hash, statement_text
         FROM interpretation_revisions
         WHERE interpretation_revision_id = ?`,
        [ids.interpretationRevisionId],
    );

    const subjectDisposition = getOptional(
        `SELECT state, commentary, updated_at
         FROM interpretation_subject_dispositions
         WHERE interpretation_revision_id = ?`,
        [ids.interpretationRevisionId],
    );
    const subjectDispositionProvenance = getOptional(
        `SELECT action_target_id
         FROM interpretation_action_provenance
         WHERE interpretation_revision_id = ?
           AND action_kind = 'SUBJECT_DISPOSITION'
         ORDER BY created_at DESC, action_provenance_id DESC
         LIMIT 1`,
        [ids.interpretationRevisionId],
    );

    process.stdout.write(JSON.stringify({
        dbPath,
        structuralCounts,
        publicationCounts: {
            policies: getCount('interpretation_publication_policies'),
            qualifications: getCount('interpretation_publication_qualifications'),
            authorizations: getCount('interpretation_publication_authorizations'),
            records: getCount('dnm_publication_records'),
        },
        publicationPolicies,
        qualifications,
        authorizations,
        publishedRecords,
        interpretation: interpretation ? {
            interpretationRevisionId: interpretation.interpretation_revision_id,
            interpretationId: interpretation.interpretation_id,
            memoryScopeId: interpretation.memory_scope_id,
            memorySubjectId: interpretation.memory_subject_id,
            reviewState: interpretation.review_state,
            subjectDispositionState: interpretation.subject_disposition_state,
            publicationState: interpretation.publication_state,
            authorityEffect: interpretation.authority_effect,
            proposalContentHash: interpretation.proposal_content_hash,
            reviewEnvelopeHash: interpretation.review_envelope_hash,
            statement: interpretation.statement_text,
        } : null,
        subjectDisposition: subjectDisposition ? {
            subjectDispositionId: subjectDispositionProvenance ? subjectDispositionProvenance.action_target_id : null,
            state: subjectDisposition.state,
            commentary: subjectDisposition.commentary,
            updatedAt: Number(subjectDisposition.updated_at),
        } : null,
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
            interpretationRevisionId = $InterpretationRevisionId
            publicationPolicyId = $PublicationPolicyId
            revokedPolicyId = $RevokedPolicyId
        } | ConvertTo-Json -Compress)
        $output = @($script | node --input-type=module -)
        return ($output -join '') | ConvertFrom-Json
    } finally {
        $env:SUMMARY_SHARDER_USER_ROOT = $previousUserRoot
        $env:SUMMARY_SHARDER_IDS = $previousIds
    }
}

function Get-CandidateFingerprint($Interpretation) {
    return @{
        interpretationRevisionId = $Interpretation.interpretationRevisionId
        interpretationId = $Interpretation.interpretationId
        statement = $Interpretation.statement
        reviewState = $Interpretation.reviewState
        subjectDispositionState = $Interpretation.subjectDispositionState
        publicationState = $Interpretation.publicationState
        authorityEffect = $Interpretation.authorityEffect
        proposalContentHash = $Interpretation.proposalContentHash
        reviewEnvelopeHash = $Interpretation.reviewEnvelopeHash
    }
}

function Get-QualificationFingerprint($Qualification) {
    return @{
        eligibilityVerdict = $Qualification.eligibilityVerdict
        refusalCodes = @($Qualification.refusalCodes)
        binding = @{
            interpretationRevisionId = $Qualification.binding.interpretationRevisionId
            interpretationId = $Qualification.binding.interpretationId
            proposalContentHash = $Qualification.binding.proposalContentHash
            groundingBindingMode = $Qualification.binding.groundingBindingMode
            groundingEnvelopeHash = $Qualification.binding.groundingEnvelopeHash
            groundingProtocolVersion = $Qualification.binding.groundingProtocolVersion
            groundingSourceSetHash = $Qualification.binding.groundingSourceSetHash
            reviewEnvelopeHash = $Qualification.binding.reviewEnvelopeHash
            reviewState = $Qualification.binding.reviewState
            subjectDispositionState = $Qualification.binding.subjectDispositionState
            subjectDispositionRecordId = $Qualification.binding.subjectDispositionRecordId
            memoryScopeId = $Qualification.binding.memoryScopeId
            memorySubjectId = $Qualification.binding.memorySubjectId
            continuityTargetId = $Qualification.binding.continuityTargetId
            publicationPolicyId = $Qualification.binding.publicationPolicyId
            publicationPolicyVersion = $Qualification.binding.publicationPolicyVersion
            publicationPolicyHash = $Qualification.binding.publicationPolicyHash
            postGrantHumanPublicationAuthorizationRequired = $Qualification.binding.postGrantHumanPublicationAuthorizationRequired
        }
    }
}

function Get-AuthorizationFingerprint($Authorization) {
    return @{
        interpretationRevisionId = $Authorization.interpretationRevisionId
        publicationPolicyId = $Authorization.publicationPolicyId
        policyVersion = $Authorization.policyVersion
        policyHash = $Authorization.policyHash
        continuityTargetId = $Authorization.continuityTargetId
        continuityTargetType = $Authorization.continuityTargetType
        memoryScopeId = $Authorization.memoryScopeId
        memorySubjectId = $Authorization.memorySubjectId
        qualificationBindingHash = $Authorization.qualificationBindingHash
        authorizedBy = $Authorization.authorizedBy
        status = $Authorization.status
        dnmRecordId = $Authorization.dnmRecordId
    }
}

function Get-PublishedRecordFingerprint($Record) {
    return @{
        continuityTargetId = $Record.continuityTargetId
        memorySubjectId = $Record.memorySubjectId
        memoryScopeId = $Record.memoryScopeId
        sourceInterpretationRevisionId = $Record.sourceInterpretationRevisionId
        sourceInterpretationId = $Record.sourceInterpretationId
        publishedStatement = $Record.publishedStatement
        proposalContentHash = $Record.proposalContentHash
        groundingBindingMode = $Record.groundingBindingMode
        groundingEnvelopeHash = $Record.groundingEnvelopeHash
        groundingProtocolVersion = $Record.groundingProtocolVersion
        groundingSourceSetHash = $Record.groundingSourceSetHash
        reviewEnvelopeHash = $Record.reviewEnvelopeHash
        publicationPolicyId = $Record.publicationPolicyId
        publicationPolicyVersion = $Record.publicationPolicyVersion
        publicationPolicyHash = $Record.publicationPolicyHash
        publicationState = $Record.publicationState
        lifecycleState = $Record.lifecycleState
    }
}

function Get-CandidateSemanticFingerprint($Interpretation) {
    return @{
        interpretationRevisionId = $Interpretation.interpretationRevisionId
        interpretationId = $Interpretation.interpretationId
        parentRevisionId = $Interpretation.parentRevisionId
        revisionReason = $Interpretation.revisionReason
        memoryScopeId = $Interpretation.memoryScopeId
        memorySubjectId = $Interpretation.memorySubjectId
        type = $Interpretation.type
        statement = $Interpretation.statement
        assertionDomains = @($Interpretation.assertionDomains)
        sharedRelationshipAsserted = $Interpretation.sharedRelationshipAsserted
        personalMeaningAsserted = $Interpretation.personalMeaningAsserted
        materialParticipantEntityIds = @($Interpretation.materialParticipantEntityIds)
        candidateState = $Interpretation.candidateState
        groundingState = $Interpretation.groundingState
        reviewState = $Interpretation.reviewState
        subjectDispositionState = $Interpretation.subjectDispositionState
        publicationState = $Interpretation.publicationState
        authorityEffect = $Interpretation.authorityEffect
        groundingAggregate = if ($Interpretation.groundingAggregate) {
            @{
                groundingOutcome = $Interpretation.groundingAggregate.groundingOutcome
            }
        } else { $null }
        risk = if ($Interpretation.risk) {
            @{
                riskClass = $Interpretation.risk.riskClass
                riskReasons = @($Interpretation.risk.riskReasons)
            }
        } else { $null }
        policyBinding = if ($Interpretation.policyBinding) {
            @{
                validationPolicyId = $Interpretation.policyBinding.validationPolicyId
                policyVersion = $Interpretation.policyBinding.policyVersion
                policyHash = $Interpretation.policyBinding.policyHash
                matchedRuleIds = @($Interpretation.policyBinding.matchedRuleIds)
            }
        } else { $null }
        reviewRequests = @($Interpretation.reviewRequests | ForEach-Object {
            @{
                reviewerRole = $_.reviewerRole
                reviewerEntityId = $_.reviewerEntityId
                status = $_.status
            }
        })
        reviewDispositions = @($Interpretation.reviewDispositions | ForEach-Object {
            @{
                reviewerRole = $_.reviewerRole
                reviewerEntityId = $_.reviewerEntityId
                disposition = $_.disposition
                reasonCodes = @($_.reasonCodes)
            }
        })
        subjectDisposition = if ($Interpretation.subjectDisposition) {
            @{
                state = $Interpretation.subjectDisposition.state
                commentary = $Interpretation.subjectDisposition.commentary
                finalDispositionAuthority = $Interpretation.subjectDisposition.finalDispositionAuthority
                reasonCodes = @($Interpretation.subjectDisposition.reasonCodes)
            }
        } else { $null }
        childRevisionIds = @($Interpretation.childRevisionIds)
    }
}

function Get-QualificationSemanticFingerprint($Qualification) {
    return @{
        eligibilityVerdict = $Qualification.eligibilityVerdict
        refusalCodes = @($Qualification.refusalCodes)
        binding = @{
            interpretationRevisionId = $Qualification.binding.interpretationRevisionId
            interpretationId = $Qualification.binding.interpretationId
            groundingBindingMode = $Qualification.binding.groundingBindingMode
            groundingProtocolVersion = $Qualification.binding.groundingProtocolVersion
            groundingEnvelopeSource = $Qualification.binding.groundingEnvelopeSource
            reviewState = $Qualification.binding.reviewState
            subjectDispositionState = $Qualification.binding.subjectDispositionState
            memoryScopeId = $Qualification.binding.memoryScopeId
            memorySubjectId = $Qualification.binding.memorySubjectId
            continuityTargetId = $Qualification.binding.continuityTargetId
            publicationPolicyId = $Qualification.binding.publicationPolicyId
            publicationPolicyVersion = $Qualification.binding.publicationPolicyVersion
            publicationPolicyHash = $Qualification.binding.publicationPolicyHash
            postGrantHumanPublicationAuthorizationRequired = $Qualification.binding.postGrantHumanPublicationAuthorizationRequired
        }
    }
}

function Get-AuthorizationSemanticFingerprint($Authorization) {
    return @{
        interpretationRevisionId = $Authorization.interpretationRevisionId
        publicationPolicyId = $Authorization.publicationPolicyId
        policyVersion = $Authorization.policyVersion
        policyHash = $Authorization.policyHash
        continuityTargetId = $Authorization.continuityTargetId
        continuityTargetType = $Authorization.continuityTargetType
        memoryScopeId = $Authorization.memoryScopeId
        memorySubjectId = $Authorization.memorySubjectId
        authorizedBy = $Authorization.authorizedBy
        status = $Authorization.status
        dnmRecordPresent = [bool]$Authorization.dnmRecordId
    }
}

function Get-PublishedRecordSemanticFingerprint($Record) {
    return @{
        continuityTargetId = $Record.continuityTargetId
        memorySubjectId = $Record.memorySubjectId
        memoryScopeId = $Record.memoryScopeId
        sourceInterpretationRevisionId = $Record.sourceInterpretationRevisionId
        sourceInterpretationId = $Record.sourceInterpretationId
        publishedStatement = $Record.publishedStatement
        groundingBindingMode = $Record.groundingBindingMode
        groundingProtocolVersion = $Record.groundingProtocolVersion
        publicationPolicyId = $Record.publicationPolicyId
        publicationPolicyVersion = $Record.publicationPolicyVersion
        publicationPolicyHash = $Record.publicationPolicyHash
        publicationState = $Record.publicationState
        lifecycleState = $Record.lifecycleState
    }
}

function Get-PersistedSemanticFingerprint($DbState) {
    return @{
        structuralCounts = $DbState.structuralCounts
        publicationCounts = $DbState.publicationCounts
        policies = @{
            active = @($DbState.publicationPolicies | Where-Object { $_.publicationPolicyId -eq $ids.activePublicationPolicyId } | ForEach-Object {
                @{
                    publicationPolicyId = $_.publicationPolicyId
                    policyVersion = $_.policyVersion
                    policyHash = $_.policyHash
                    policyState = $_.policyState
                }
            })
            revoked = @($DbState.publicationPolicies | Where-Object { $_.publicationPolicyId -eq $ids.revokePolicyId } | ForEach-Object {
                @{
                    publicationPolicyId = $_.publicationPolicyId
                    policyVersion = $_.policyVersion
                    policyHash = $_.policyHash
                    policyState = $_.policyState
                    revocationReason = $_.revocationReason
                }
            })
        }
        interpretation = if ($DbState.interpretation) {
            @{
                interpretationRevisionId = $DbState.interpretation.interpretationRevisionId
                interpretationId = $DbState.interpretation.interpretationId
                memoryScopeId = $DbState.interpretation.memoryScopeId
                memorySubjectId = $DbState.interpretation.memorySubjectId
                reviewState = $DbState.interpretation.reviewState
                subjectDispositionState = $DbState.interpretation.subjectDispositionState
                publicationState = $DbState.interpretation.publicationState
                authorityEffect = $DbState.interpretation.authorityEffect
                statement = $DbState.interpretation.statement
            }
        } else { $null }
        subjectDisposition = if ($DbState.subjectDisposition) {
            @{
                state = $DbState.subjectDisposition.state
                commentary = $DbState.subjectDisposition.commentary
            }
        } else { $null }
        qualification = if (@($DbState.qualifications).Count -gt 0) {
            Get-QualificationSemanticFingerprint $DbState.qualifications[0]
        } else { $null }
        authorization = if (@($DbState.authorizations).Count -gt 0) {
            Get-AuthorizationSemanticFingerprint $DbState.authorizations[0]
        } else { $null }
        publishedRecord = if (@($DbState.publishedRecords).Count -gt 0) {
            Get-PublishedRecordSemanticFingerprint $DbState.publishedRecords[0]
        } else { $null }
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
    Reset-AuthorityStorage -HostSpec $HostSpec

    $base = "http://127.0.0.1:$($hostSpec.Port)/api/plugins/summary-sharder-memory"
    $health = Invoke-JsonRequest -Method 'GET' -Uri "$base/health" -TimeoutSec 15
    $capabilities = Invoke-JsonRequest -Method 'GET' -Uri "$base/capabilities" -TimeoutSec 15

    $noTokenPolicyCreate = Invoke-JsonRequestAllowError -Method 'POST' -Uri "$base/interpretive/publication/policies" -Body (New-ActivePublicationPolicyBody) -TimeoutSec 15

    $csrf = Get-CsrfSession -Port $hostSpec.Port

    $activePolicy = Invoke-JsonRequest -Method 'POST' -Uri "$base/interpretive/publication/policies" -Body (New-ActivePublicationPolicyBody) -Session $csrf.Session -CsrfToken $csrf.Token -TimeoutSec 30
    $revokePolicy = Invoke-JsonRequest -Method 'POST' -Uri "$base/interpretive/publication/policies" -Body (New-RevokePublicationPolicyBody) -Session $csrf.Session -CsrfToken $csrf.Token -TimeoutSec 30
    $noTokenPolicyRevoke = Invoke-JsonRequestAllowError -Method 'POST' -Uri "$base/interpretive/publication/policies/$($ids.revokePolicyId)/revoke" -Body @{
        policyVersion = 1
        revocationReason = 'no-token-should-fail'
        now = 1782519125000
    } -TimeoutSec 15
    $revokedPolicy = Invoke-JsonRequest -Method 'POST' -Uri "$base/interpretive/publication/policies/$($ids.revokePolicyId)/revoke" -Body @{
        policyVersion = 1
        revocationReason = 'host-proof revocation'
        now = 1782519130000
    } -Session $csrf.Session -CsrfToken $csrf.Token -TimeoutSec 30
    $listedPolicies = Invoke-JsonRequest -Method 'GET' -Uri "$base/interpretive/publication/policies" -Session $csrf.Session -TimeoutSec 15

    $created = Invoke-JsonRequest -Method 'POST' -Uri "$base/interpretive/candidates" -Body (New-ParentCandidateBody) -Session $csrf.Session -CsrfToken $csrf.Token -TimeoutSec 30
    $subjectRequest = $created.interpretation.reviewRequests | Where-Object { $_.reviewerRole -eq 'MEMORY_SUBJECT' } | Select-Object -First 1

    $withEdit = Invoke-JsonRequest -Method 'POST' -Uri "$base/interpretive/reviews/$($subjectRequest.reviewRequestId)/dispositions" -Body @{
        actorEntityId = 'character:jeep.png'
        disposition = 'APPROVE_WITH_EDIT'
        reviewEnvelopeHash = $created.interpretation.reviewEnvelopeHash
        reasonCodes = @('SCOPE_TOO_BROAD')
        revisedCandidate = @{
            interpretationRevisionId = $ids.childRevisionId
            statement = 'Jeep evolved into the primary architectural authority over continuity and memory requirements within a shared architecture with Chris.'
        }
        now = 1782519180000
    } -Session $csrf.Session -CsrfToken $csrf.Token -TimeoutSec 30
    $childParticipantRequest = $withEdit.childInterpretation.reviewRequests | Where-Object { $_.reviewerRole -eq 'RELATIONAL_PARTICIPANT' } | Select-Object -First 1

    $participantApprove = Invoke-JsonRequest -Method 'POST' -Uri "$base/interpretive/reviews/$($childParticipantRequest.reviewRequestId)/dispositions" -Body @{
        actorEntityId = 'user:Chris'
        disposition = 'APPROVE'
        reviewEnvelopeHash = $withEdit.childInterpretation.reviewEnvelopeHash
        now = 1782519185000
    } -Session $csrf.Session -CsrfToken $csrf.Token -TimeoutSec 30

    $granted = Invoke-JsonRequest -Method 'POST' -Uri "$base/interpretive/candidates/$($ids.childRevisionId)/subject-disposition" -Body @{
        actorEntityId = 'character:jeep.png'
        state = 'GRANTED'
        reviewEnvelopeHash = $withEdit.childInterpretation.reviewEnvelopeHash
        commentary = 'Granted for governed DNM publication proof.'
        now = 1782519190000
    } -Session $csrf.Session -CsrfToken $csrf.Token -TimeoutSec 30

    $qualification = Invoke-JsonRequest -Method 'POST' -Uri "$base/interpretive/candidates/$($ids.childRevisionId)/publication-qualifications" -Body @{
        publicationPolicyId = $ids.activePublicationPolicyId
        continuityTargetId = $ids.memorySubjectId
        proposalContentHash = $granted.interpretation.proposalContentHash
        reviewEnvelopeHash = $granted.interpretation.reviewEnvelopeHash
        subjectDispositionRecordId = $granted.subjectDisposition.subjectDispositionId
        now = 1782519195000
    } -Session $csrf.Session -CsrfToken $csrf.Token -TimeoutSec 30

    $noTokenAuthorize = Invoke-JsonRequestAllowError -Method 'POST' -Uri "$base/interpretive/publication/authorizations" -Body @{
        qualificationId = $qualification.qualification.qualificationId
        authorizedBy = 'user:Chris'
        expiresAt = 1782522795000
        now = 1782519200000
    } -TimeoutSec 15

    $authorization = Invoke-JsonRequest -Method 'POST' -Uri "$base/interpretive/publication/authorizations" -Body @{
        qualificationId = $qualification.qualification.qualificationId
        authorizedBy = 'user:Chris'
        expiresAt = 1782522795000
        now = 1782519205000
    } -Session $csrf.Session -CsrfToken $csrf.Token -TimeoutSec 30

    $noTokenExecute = Invoke-JsonRequestAllowError -Method 'POST' -Uri "$base/interpretive/publication/execute" -Body @{
        publicationAuthorizationId = $authorization.authorization.publicationAuthorizationId
        now = 1782519210000
    } -TimeoutSec 15

    $published = Invoke-JsonRequest -Method 'POST' -Uri "$base/interpretive/publication/execute" -Body @{
        publicationAuthorizationId = $authorization.authorization.publicationAuthorizationId
        now = 1782519215000
    } -Session $csrf.Session -CsrfToken $csrf.Token -TimeoutSec 60

    $doubleExecute = Invoke-JsonRequestAllowError -Method 'POST' -Uri "$base/interpretive/publication/execute" -Body @{
        publicationAuthorizationId = $authorization.authorization.publicationAuthorizationId
        now = 1782519220000
    } -Session $csrf.Session -CsrfToken $csrf.Token -TimeoutSec 30

    $candidateAfterPublish = Invoke-JsonRequest -Method 'GET' -Uri "$base/interpretive/candidates/$($ids.childRevisionId)" -Session $csrf.Session -TimeoutSec 15
    $dbStateBeforeRestart = Get-PublicationDbState -HostSpec $hostSpec -InterpretationRevisionId $ids.childRevisionId -PublicationPolicyId $ids.activePublicationPolicyId -RevokedPolicyId $ids.revokePolicyId
    $storageBeforeRestart = Get-StorageFingerprints -HostSpec $hostSpec

    $restart = Restart-Host -HostSpec $hostSpec
    $capabilitiesAfterRestart = Invoke-JsonRequest -Method 'GET' -Uri "$base/capabilities" -TimeoutSec 15
    $candidateAfterRestart = Invoke-JsonRequest -Method 'GET' -Uri "$base/interpretive/candidates/$($ids.childRevisionId)" -Session $csrf.Session -TimeoutSec 15
    $dbStateAfterRestart = Get-PublicationDbState -HostSpec $hostSpec -InterpretationRevisionId $ids.childRevisionId -PublicationPolicyId $ids.activePublicationPolicyId -RevokedPolicyId $ids.revokePolicyId
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
            noTokenPolicyCreate = $noTokenPolicyCreate
            noTokenPolicyRevoke = $noTokenPolicyRevoke
            noTokenAuthorize = $noTokenAuthorize
            noTokenExecute = $noTokenExecute
        }
        policies = @{
            active = @{
                publicationPolicyId = $activePolicy.publicationPolicy.publicationPolicyId
                policyVersion = $activePolicy.publicationPolicy.policyVersion
                policyHash = $activePolicy.publicationPolicy.policyHash
                policyState = $activePolicy.publicationPolicy.policyState
            }
            revoked = @{
                publicationPolicyId = $revokedPolicy.publicationPolicy.publicationPolicyId
                policyVersion = $revokedPolicy.publicationPolicy.policyVersion
                policyHash = $revokedPolicy.publicationPolicy.policyHash
                policyState = $revokedPolicy.publicationPolicy.policyState
                revocationReason = $revokedPolicy.publicationPolicy.revocationReason
            }
            listed = @($listedPolicies.policies | ForEach-Object {
                @{
                    publicationPolicyId = $_.publicationPolicyId
                    policyVersion = $_.policyVersion
                    policyHash = $_.policyHash
                    policyState = $_.policyState
                    revocationReason = $_.revocationReason
                }
            })
        }
        route = @{
            createdParent = Get-CandidateFingerprint $created.interpretation
            createdParentSemantic = Get-CandidateSemanticFingerprint $created.interpretation
            childAfterEdit = Get-CandidateFingerprint $withEdit.childInterpretation
            childAfterEditSemantic = Get-CandidateSemanticFingerprint $withEdit.childInterpretation
            participantApproveOk = $participantApprove.ok
            granted = @{
                candidate = Get-CandidateFingerprint $granted.interpretation
                candidateSemantic = Get-CandidateSemanticFingerprint $granted.interpretation
                subjectDispositionId = $granted.subjectDisposition.subjectDispositionId
                state = $granted.subjectDisposition.state
            }
            qualification = Get-QualificationFingerprint $qualification.qualification
            qualificationSemantic = Get-QualificationSemanticFingerprint $qualification.qualification
            authorization = Get-AuthorizationFingerprint $authorization.authorization
            authorizationSemantic = Get-AuthorizationSemanticFingerprint $authorization.authorization
            publishedRecord = Get-PublishedRecordFingerprint $published.publishedRecord
            publishedRecordSemantic = Get-PublishedRecordSemanticFingerprint $published.publishedRecord
            candidateAfterPublish = Get-CandidateFingerprint $candidateAfterPublish.interpretation
            candidateAfterPublishSemantic = Get-CandidateSemanticFingerprint $candidateAfterPublish.interpretation
            doubleExecute = @{
                status = $doubleExecute.status
                code = if ($doubleExecute.body) { $doubleExecute.body.code } else { $null }
            }
            candidateAfterRestart = Get-CandidateFingerprint $candidateAfterRestart.interpretation
            candidateAfterRestartSemantic = Get-CandidateSemanticFingerprint $candidateAfterRestart.interpretation
        }
        persisted = @{
            beforeRestart = $dbStateBeforeRestart
            afterRestart = $dbStateAfterRestart
            beforeRestartSemantic = Get-PersistedSemanticFingerprint $dbStateBeforeRestart
            afterRestartSemantic = Get-PersistedSemanticFingerprint $dbStateAfterRestart
            routeMatchesDb = @{
                candidateAfterPublish = (
                    $candidateAfterPublish.interpretation.publicationState -eq $dbStateBeforeRestart.interpretation.publicationState -and
                    $candidateAfterPublish.interpretation.authorityEffect -eq $dbStateBeforeRestart.interpretation.authorityEffect -and
                    $candidateAfterPublish.interpretation.proposalContentHash -eq $dbStateBeforeRestart.interpretation.proposalContentHash
                )
                qualificationCount = (($dbStateBeforeRestart.publicationCounts.qualifications -eq 1) -and ($qualification.qualification.eligibilityVerdict -eq $dbStateBeforeRestart.qualifications[0].eligibilityVerdict))
                authorizationCount = (($dbStateBeforeRestart.publicationCounts.authorizations -eq 1) -and ($published.authorization.status -eq $dbStateBeforeRestart.authorizations[0].status))
                publishedRecordCount = (($dbStateBeforeRestart.publicationCounts.records -eq 1) -and ($published.publishedRecord.proposalContentHash -eq $dbStateBeforeRestart.publishedRecords[0].proposalContentHash))
            }
        }
        restart = @{
            replacedProcess = $restart.replacedProcess
            candidateStable = ((ConvertTo-Json (Get-CandidateFingerprint $candidateAfterPublish.interpretation) -Depth 20) -eq (ConvertTo-Json (Get-CandidateFingerprint $candidateAfterRestart.interpretation) -Depth 20))
            candidateSemanticStable = ((ConvertTo-Json (Get-CandidateSemanticFingerprint $candidateAfterPublish.interpretation) -Depth 20) -eq (ConvertTo-Json (Get-CandidateSemanticFingerprint $candidateAfterRestart.interpretation) -Depth 20))
            dbStateStable = ((ConvertTo-Json $dbStateBeforeRestart -Depth 40) -eq (ConvertTo-Json $dbStateAfterRestart -Depth 40))
            dbStateSemanticStable = ((ConvertTo-Json (Get-PersistedSemanticFingerprint $dbStateBeforeRestart) -Depth 40) -eq (ConvertTo-Json (Get-PersistedSemanticFingerprint $dbStateAfterRestart) -Depth 40))
            storageStable = ((ConvertTo-Json $storageBeforeRestart -Depth 20) -eq (ConvertTo-Json $storageAfterRestart -Depth 20))
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
        lineageBoundHashesAreHostLocal = $true
        lineageBoundHashExplanation = 'Child revision and downstream publication hashes bind host-local createdFromDispositionId and subjectDispositionRecordId values; semantic invariants should match across independently enacted hosts, not the generated lineage IDs themselves.'
    }
    comparisons = @{
        c0_6_4CapabilitiesEqual = ((ConvertTo-Json $results[0].capabilities.beforeRestart -Depth 20) -eq (ConvertTo-Json $results[1].capabilities.beforeRestart -Depth 20))
        noTokenStatusesEqual = (
            ($results[0].csrf.noTokenPolicyCreate.status -eq $results[1].csrf.noTokenPolicyCreate.status) -and
            ($results[0].csrf.noTokenPolicyRevoke.status -eq $results[1].csrf.noTokenPolicyRevoke.status) -and
            ($results[0].csrf.noTokenAuthorize.status -eq $results[1].csrf.noTokenAuthorize.status) -and
            ($results[0].csrf.noTokenExecute.status -eq $results[1].csrf.noTokenExecute.status)
        )
        activePolicyHashesEqual = ($results[0].policies.active.policyHash -eq $results[1].policies.active.policyHash)
        revokedPolicyHashesEqual = ($results[0].policies.revoked.policyHash -eq $results[1].policies.revoked.policyHash)
        qualificationSemanticsEqual = ((ConvertTo-Json $results[0].route.qualificationSemantic -Depth 30) -eq (ConvertTo-Json $results[1].route.qualificationSemantic -Depth 30))
        authorizationSemanticsEqual = ((ConvertTo-Json $results[0].route.authorizationSemantic -Depth 30) -eq (ConvertTo-Json $results[1].route.authorizationSemantic -Depth 30))
        publishedRecordSemanticsEqual = ((ConvertTo-Json $results[0].route.publishedRecordSemantic -Depth 30) -eq (ConvertTo-Json $results[1].route.publishedRecordSemantic -Depth 30))
        candidateSemanticsEqual = ((ConvertTo-Json $results[0].route.candidateAfterPublishSemantic -Depth 20) -eq (ConvertTo-Json $results[1].route.candidateAfterPublishSemantic -Depth 20))
        persistedDbStateSemanticsEqual = ((ConvertTo-Json $results[0].persisted.beforeRestartSemantic -Depth 50) -eq (ConvertTo-Json $results[1].persisted.beforeRestartSemantic -Depth 50))
        persistedDbStateStableAcrossRestart = (
            ((ConvertTo-Json $results[0].persisted.beforeRestartSemantic -Depth 50) -eq (ConvertTo-Json $results[0].persisted.afterRestartSemantic -Depth 50)) -and
            ((ConvertTo-Json $results[1].persisted.beforeRestartSemantic -Depth 50) -eq (ConvertTo-Json $results[1].persisted.afterRestartSemantic -Depth 50))
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
        secondExecuteRejectedEverywhere = (
            ($results[0].route.doubleExecute.status -eq 409) -and
            ($results[1].route.doubleExecute.status -eq 409)
        )
    }
}

$summary.ok = (
    $summary.comparisons.c0_6_4CapabilitiesEqual -and
    $summary.comparisons.noTokenStatusesEqual -and
    $summary.comparisons.activePolicyHashesEqual -and
    $summary.comparisons.revokedPolicyHashesEqual -and
    $summary.comparisons.qualificationSemanticsEqual -and
    $summary.comparisons.authorizationSemanticsEqual -and
    $summary.comparisons.publishedRecordSemanticsEqual -and
    $summary.comparisons.candidateSemanticsEqual -and
    $summary.comparisons.persistedDbStateSemanticsEqual -and
    $summary.comparisons.persistedDbStateStableAcrossRestart -and
    $summary.comparisons.structuralCountsRemainZero -and
    $summary.comparisons.secondExecuteRejectedEverywhere -and
    @($results | Where-Object {
        $_.route.participantApproveOk -and
        $_.persisted.routeMatchesDb.candidateAfterPublish -and
        $_.persisted.routeMatchesDb.qualificationCount -and
        $_.persisted.routeMatchesDb.authorizationCount -and
        $_.persisted.routeMatchesDb.publishedRecordCount -and
        $_.restart.candidateStable -and
        $_.restart.candidateSemanticStable -and
        $_.restart.dbStateSemanticStable
    }).Count -eq $results.Count
)

$summary | ConvertTo-Json -Depth 80
