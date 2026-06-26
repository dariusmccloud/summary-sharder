/**
 * Floating Action Button for Summary Sharder
 * Crystal shard hub with animated radial quick-access panels.
 */

import { saveSettings } from '../../core/settings.js';
import { getAllMessages } from '../../core/chat/chat-state.js';
import { showSsInput } from '../common/modal-base.js';
import { buildFabPanels, getFabPanelIds } from './fab-content.js';
import { createFabPanels, WHEEL_RADIUS_PX, WHEEL_MAX_HALF_EXTENT_PX } from './fab-panels.js';
import { createFabAnimator } from './fab-animation.js';
import { log } from '../../core/logger.js';

let fabElement = null;
let settingsRef = null;
let callbacksRef = null;
let animator = null;
let panelsController = null;
let isGenerating = false;
let fabState = 'closed';
let previousFocus = null;
let fabTransitionToken = 0;
let relocation = createRelocationState();
let pendingPositionSaveId = null;
let pendingPositionSaveMode = null;
let pendingPositionValue = null;
let lastPersistedPosition = null;
let scheduledToggleId = null;
let scheduledToggleMode = null;
const fabPerfSamples = new Map();

// Bound listeners stored for cleanup
let onOutsideClick = null;
let onResize = null;
let onOperationStarted = null;
let onOperationEnded = null;
let onSharderModeChange = null;
let onKeyDown = null;
let onVisualViewportChange = null;
let onPageHide = null;
let onBeforeUnload = null;

const FAB_SIZE_PX = 56;
const FAB_RADIUS_PX = FAB_SIZE_PX / 2;
const MOBILE_BREAKPOINT_QUERY = '(max-width: 768px)';

/**
 * Mobile FAB scale — percentage of default size (100 = current size).
 * Adjust this single value to resize the FAB + wheel buttons on mobile.
 * Examples: 75 = 75% size, 100 = unchanged, 120 = 20% larger.
 */
const MOBILE_FAB_SCALE_PERCENT = 80;

function getMobileScale() {
    return isMobileViewport() ? MOBILE_FAB_SCALE_PERCENT / 100 : 1;
}

const SAFE_VIEWPORT_MARGIN_PX = 8;
const MOBILE_EXTRA_TAP_PADDING_PX = 6;
const MIN_NUDGE_DELTA_PX = 2;
const NUDGE_IN_DURATION_MS = 160;
const NUDGE_IN_EASING = 'cubic-bezier(0.22, 0.61, 0.36, 1)';
const NUDGE_BACK_DURATION_MS = 180;
const NUDGE_BACK_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';
const POSITION_SAVE_IDLE_TIMEOUT_MS = 200;
const POSITION_SAVE_TIMEOUT_FALLBACK_MS = 64;
const FAB_PERF_DEBUG = false;
const FAB_PERF_SAMPLE_LIMIT = 120;
const FAB_PERF_LOG_INTERVAL = 20;

function createRelocationState() {
    return {
        mode: 'idle',
        home: null,
        nudged: null,
        shouldReturn: false,
        anim: null,
    };
}

function recordFabPerfSample(metric, value) {
    if (!Number.isFinite(value)) return;

    const state = fabPerfSamples.get(metric) || { samples: [], count: 0, max: 0 };
    state.count += 1;
    state.max = Math.max(state.max, value);
    if (state.samples.length >= FAB_PERF_SAMPLE_LIMIT) {
        state.samples.shift();
    }
    state.samples.push(value);
    fabPerfSamples.set(metric, state);

    if (!FAB_PERF_DEBUG) return;
    if (state.count % FAB_PERF_LOG_INTERVAL !== 0 && value < 50) return;

    const sorted = [...state.samples].sort((a, b) => a - b);
    const p50 = getPercentile(sorted, 0.5);
    const p95 = getPercentile(sorted, 0.95);
    log.debug(
        `[FAB perf] ${metric} n=${state.samples.length} p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms max=${state.max.toFixed(1)}ms`
    );
}

function getPercentile(sortedValues, fraction) {
    if (!sortedValues.length) return 0;
    const index = Math.max(0, Math.min(sortedValues.length - 1, Math.floor((sortedValues.length - 1) * fraction)));
    return sortedValues[index];
}

/**
 * Initialize the FAB.
 * @param {Object} settings
 * @param {Object} callbacks
 */
export function initFab(settings, callbacks) {
    settingsRef = settings;
    callbacksRef = callbacks;
    fabTransitionToken = 0;
    relocation = createRelocationState();
    pendingPositionValue = null;
    cancelPendingPositionSaveFlush();
    cancelScheduledTogglePanels();

    if (!settingsRef.fab) {
        settingsRef.fab = { enabled: true, position: { x: null, y: null } };
    }
    lastPersistedPosition = isValidPoint(settingsRef.fab.position) ? {
        x: settingsRef.fab.position.x,
        y: settingsRef.fab.position.y,
    } : null;

    createFabElement();
    document.documentElement.style.setProperty('--ss-fab-mobile-scale', MOBILE_FAB_SCALE_PERCENT / 100);
    animator = createFabAnimator(fabElement);
    bindEvents();
    restorePosition();
    updateFabVisibility();
}

function createFabElement() {
    fabElement = document.createElement('div');
    fabElement.className = 'ss-fab';
    fabElement.id = 'ss-fab';
    fabElement.innerHTML = `
        <button type="button" class="ss-fab-trigger" title="Summary Sharder Quick Actions" aria-haspopup="dialog" aria-expanded="false">
            <div class="ss-crystal-icon" aria-hidden="true">
                <svg viewBox="0 0 24 28" xmlns="http://www.w3.org/2000/svg">
                    <polygon class="ss-crystal-shard ss-crystal-shard--1" points="12,0 4,8 12,10"></polygon>
                    <polygon class="ss-crystal-shard ss-crystal-shard--2" points="12,0 20,8 12,10"></polygon>
                    <polygon class="ss-crystal-shard ss-crystal-shard--3" points="4,8 12,10 12,18 2,14"></polygon>
                    <polygon class="ss-crystal-shard ss-crystal-shard--4" points="20,8 12,10 12,18 22,14"></polygon>
                    <polygon class="ss-crystal-shard ss-crystal-shard--5a" points="2,14 12,18 12,28"></polygon>
                    <polygon class="ss-crystal-shard ss-crystal-shard--5b" points="12,18 22,14 12,28"></polygon>
                </svg>
            </div>
        </button>
    `;
    document.body.appendChild(fabElement);
}

function bindEvents() {
    setupDrag();

    onOutsideClick = (e) => {
        if (!isOpenState()) return;

        const clickedFab = fabElement?.contains(e.target);
        const clickedPanels = panelsController?.containsTarget(e.target);

        if (!clickedFab && !clickedPanels) {
            void closePanels();
        }
    };
    document.addEventListener('pointerdown', onOutsideClick);

    onResize = () => {
        handleViewportChange();
    };
    window.addEventListener('resize', onResize);
    onVisualViewportChange = () => {
        handleViewportChange();
    };
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', onVisualViewportChange);
        window.visualViewport.addEventListener('scroll', onVisualViewportChange);
    }

    onPageHide = () => {
        flushPendingPositionSave();
    };
    window.addEventListener('pagehide', onPageHide);

    onBeforeUnload = () => {
        flushPendingPositionSave();
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    onOperationStarted = () => {
        isGenerating = true;
        fabElement.classList.add('ss-fab-generating');
        refreshOpenPanels(['actions', 'config', 'advanced']);
    };
    onOperationEnded = () => {
        isGenerating = false;
        fabElement.classList.remove('ss-fab-generating');
        refreshOpenPanels(['actions', 'config', 'advanced']);
    };
    window.addEventListener('ss-operation-started', onOperationStarted);
    window.addEventListener('ss-operation-ended', onOperationEnded);

    onSharderModeChange = () => {
        refreshOpenPanels(['actions', 'config', 'advanced']);
    };

    const sharderToggle = document.getElementById('ss-sharder-mode');
    if (sharderToggle) {
        sharderToggle.addEventListener('change', onSharderModeChange);
    }

    onKeyDown = (event) => {
        if (event.key === 'Escape' && isOpenState()) {
            event.preventDefault();
            void closePanels();
            return;
        }

        if ((event.key === 'Enter' || event.key === ' ') && document.activeElement === getTrigger()) {
            event.preventDefault();
            scheduleTogglePanels();
            return;
        }

        if (isOpenState() && isFocusWithinFabControls() && (event.key === 'ArrowRight' || event.key === 'ArrowDown')) {
            event.preventDefault();
            panelsController?.focusNextWheel?.(1);
            return;
        }

        if (isOpenState() && isFocusWithinFabControls() && (event.key === 'ArrowLeft' || event.key === 'ArrowUp')) {
            event.preventDefault();
            panelsController?.focusNextWheel?.(-1);
            return;
        }

        if (event.key === 'Tab' && isOpenState() && panelsController?.root) {
            trapFocus(event, panelsController.root);
        }
    };
    document.addEventListener('keydown', onKeyDown);
}

function setupDrag() {
    const trigger = getTrigger();
    let isDragging = false;
    let startX = null;
    let startY = null;
    let initialX;
    let initialY;
    let lastDraggedPosition = null;
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const DRAG_THRESHOLD = isTouchDevice ? 12 : 5;

    trigger.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;

        isDragging = false;
        startX = e.clientX;
        startY = e.clientY;

        const position = getRenderedFabPosition();
        initialX = position.x;
        initialY = position.y;
        lastDraggedPosition = null;

        trigger.setPointerCapture(e.pointerId);
        fabElement.classList.add('ss-fab-dragging');
    });

    trigger.addEventListener('pointermove', (e) => {
        if (startX === null) return;

        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        if (!isDragging && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
            isDragging = true;
            clearRelocationForDrag();
            closePanelsImmediate();
            fabState = 'dragging';
        }

        if (isDragging) {
            const { x, y } = clampToViewport(initialX + dx, initialY + dy);
            lastDraggedPosition = { x, y };
            setFabPosition(x, y);
        }
    });

    trigger.addEventListener('pointerup', () => {
        const startedAt = performance.now();
        try {
            if (isDragging) {
                const position = lastDraggedPosition || getSafeCurrentPosition();
                savePosition(position.x, position.y);
                fabState = 'closed';
            } else if (startX !== null) {
                scheduleTogglePanels();
            }
        } finally {
            isDragging = false;
            startX = null;
            startY = null;
            lastDraggedPosition = null;
            fabElement.classList.remove('ss-fab-dragging');
            recordFabPerfSample('pointerup', performance.now() - startedAt);
        }
    });

    // Touch browsers may fire pointercancel instead of pointerup (e.g. when
    // the OS takes over the gesture). Reset state to avoid a stuck FAB.
    trigger.addEventListener('pointercancel', () => {
        startX = null;
        startY = null;
        isDragging = false;
        lastDraggedPosition = null;
        fabElement.classList.remove('ss-fab-dragging');
        if (fabState === 'dragging') {
            fabState = 'closed';
        }
    });
}

function scheduleTogglePanels() {
    if (scheduledToggleId !== null) return;

    const run = async () => {
        scheduledToggleId = null;
        scheduledToggleMode = null;
        await togglePanels();
    };

    if (typeof window.requestAnimationFrame === 'function') {
        scheduledToggleMode = 'raf';
        scheduledToggleId = window.requestAnimationFrame(() => {
            void run();
        });
        return;
    }

    scheduledToggleMode = 'timeout';
    scheduledToggleId = window.setTimeout(() => {
        void run();
    }, 0);
}

function cancelScheduledTogglePanels() {
    if (scheduledToggleId === null) return;
    if (scheduledToggleMode === 'raf' && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(scheduledToggleId);
    } else {
        window.clearTimeout(scheduledToggleId);
    }
    scheduledToggleId = null;
    scheduledToggleMode = null;
}

async function togglePanels() {
    // Trigger toggles are single-flight to avoid interleaving open/close paths.
    if (fabState === 'opening' || fabState === 'closing' || fabState === 'dragging') {
        return;
    }

    if (isOpenState()) {
        await closePanels();
    } else {
        await openPanels();
    }
}

async function openPanels() {
    if (!fabElement || isOpenState() || fabState === 'opening') return;

    const transitionToken = ++fabTransitionToken;
    fabState = 'opening';
    previousFocus = document.activeElement;

    const homePosition = getSafeCurrentPosition();
    relocation = createRelocationState();
    relocation.home = homePosition;

    const safeOpenPosition = computeSafeOpenPosition(homePosition.x, homePosition.y, getViewportInfo());
    const shouldNudge = shouldApplyMobileNudge(homePosition, safeOpenPosition);

    if (shouldNudge) {
        relocation.mode = 'nudging-in';
        relocation.nudged = { ...safeOpenPosition };
        relocation.shouldReturn = true;
        await animateFabPosition(safeOpenPosition.x, safeOpenPosition.y, {
            duration: NUDGE_IN_DURATION_MS,
            easing: NUDGE_IN_EASING,
        });

        if (transitionToken !== fabTransitionToken || fabState !== 'opening') {
            return;
        }

        relocation.mode = 'nudged';
    }

    const panelMarkup = buildFabPanels(settingsRef, {
        isGenerating,
        lastSummarizedIndex: callbacksRef?.getLastSummarizedIndex?.() ?? -1,
    });

    if (transitionToken !== fabTransitionToken || fabState !== 'opening') {
        return;
    }

    const openAnchorRect = getFabRect();
    panelsController = createFabPanels({
        anchorRect: openAnchorRect,
        panelMarkupById: panelMarkup,
        mobileScalePercent: MOBILE_FAB_SCALE_PERCENT,
        onAction: (action, button) => {
            void handleAction(action, button);
        },
    });

    fabElement.classList.add('ss-fab-open');
    getTrigger().setAttribute('aria-expanded', 'true');

    await animator.animateOpen(panelsController);

    if (transitionToken !== fabTransitionToken || fabState !== 'opening') {
        return;
    }

    // Use synchronous layout to prevent rAF-deferred positioning from being
    // affected by theme CSS mutations or competing callbacks.  Re-use the
    // anchor rect captured at open-time so the wheel positions stay
    // consistent with the initial layout (the FAB does not move during the
    // shard animation on any platform).
    panelsController.repositionSync(openAnchorRect);

    fabState = 'open';
    focusFirstInPanels();
}

async function closePanels() {
    const hasRelocationWork = relocation.shouldReturn || relocation.mode === 'nudging-in' || relocation.mode === 'nudged' || relocation.mode === 'nudging-back';
    if ((!panelsController && !hasRelocationWork && !isOpenState()) || fabState === 'closing') {
        return;
    }

    const transitionToken = ++fabTransitionToken;
    const closingFromOpening = fabState === 'opening';
    fabState = 'closing';

    if (closingFromOpening) {
        animator.cancelAll();
    }

    if (relocation.mode === 'nudging-in') {
        stopRelocationAnimation({ freezePosition: true });
        relocation.mode = 'nudged';
        relocation.shouldReturn = true;
        if (!relocation.nudged) {
            relocation.nudged = getSafeCurrentPosition();
        }
    }

    if (panelsController) {
        await animator.animateClose(panelsController);
        if (transitionToken !== fabTransitionToken) {
            return;
        }
        panelsController.destroy();
        panelsController = null;
    }

    fabElement.classList.remove('ss-fab-open');
    getTrigger()?.setAttribute('aria-expanded', 'false');

    if (relocation.shouldReturn) {
        const home = isValidPoint(relocation.home) ? relocation.home : getSafeCurrentPosition();
        relocation.mode = 'nudging-back';
        await animateFabPosition(home.x, home.y, {
            duration: NUDGE_BACK_DURATION_MS,
            easing: NUDGE_BACK_EASING,
        });

        if (transitionToken !== fabTransitionToken) {
            return;
        }
    }

    resetRelocationState();
    fabState = 'closed';
    restoreFocus();
}

function closePanelsImmediate() {
    fabTransitionToken += 1;
    stopRelocationAnimation({ freezePosition: true });
    resetRelocationState({ cancelAnimation: false });
    animator.cancelAll();

    if (panelsController) {
        panelsController.destroy();
        panelsController = null;
    }

    fabElement.classList.remove('ss-fab-open');
    getTrigger().setAttribute('aria-expanded', 'false');

    if (fabState !== 'dragging') {
        fabState = 'closed';
    }

    restoreFocus();
}

function refreshOpenPanels(panelIds = getFabPanelIds()) {
    if (!panelsController || !isOpenState()) return;

    const panelMarkup = buildFabPanels(settingsRef, {
        isGenerating,
        lastSummarizedIndex: callbacksRef?.getLastSummarizedIndex?.() ?? -1,
    });
    for (const panelId of panelIds) {
        if (panelMarkup[panelId]) {
            panelsController.updatePanel(panelId, panelMarkup[panelId]);
        }
    }

    panelsController.reposition(getFabRect());
}

async function handleAction(action, button) {
    if (!callbacksRef) return;

    try {
        withActionLock(button, true);

        switch (action) {
            case 'single-pass':
                await handleSinglePass();
                break;
            case 'batch-sharder':
                await handleBatchSharder();
                break;
            case 'summarize':
                await closePanels();
                await callbacksRef.onSummarize?.();
                break;
            case 'stop':
                await closePanels();
                await callbacksRef.onStop?.();
                break;
            case 'vectorize':
                await closePanels();
                await callbacksRef.onVectorize?.();
                break;
            case 'purge-vectors':
                await closePanels();
                await callbacksRef.onPurgeVectors?.();
                break;
            case 'browse-vectors':
                await closePanels();
                await callbacksRef.onBrowseVectors?.();
                break;
            case 'rag-debug':
                await closePanels();
                await callbacksRef.onOpenRagDebug?.();
                break;
            case 'manage-collections':
                await closePanels();
                await callbacksRef.onManageCollections?.();
                break;
            case 'rag-history':
                await closePanels();
                await callbacksRef.onOpenRagHistory?.();
                break;
            case 'open-themes':
                await closePanels();
                await callbacksRef.onOpenThemes?.();
                break;
            case 'open-prompts':
                await closePanels();
                await callbacksRef.onOpenPrompts?.();
                break;
            case 'open-api-config':
                await closePanels();
                await callbacksRef.onOpenApiConfig?.();
                break;
            case 'open-rag-settings':
                await closePanels();
                await callbacksRef.onOpenRagSettings?.();
                break;
            case 'open-chat-manager':
                await closePanels();
                await callbacksRef.onOpenChatManager?.();
                break;
            case 'open-interpretive-review':
                await closePanels();
                await callbacksRef.onOpenInterpretiveReview?.();
                break;
            case 'open-visibility':
                await closePanels();
                await callbacksRef.onOpenVisibility?.();
                break;
            case 'open-clean-context':
                await closePanels();
                await callbacksRef.onOpenCleanContext?.();
                break;
            default:
                break;
        }
    } catch (error) {
        toastr.error(`Action failed: ${error?.message || error}`);
    } finally {
        withActionLock(button, false);
    }
}

function withActionLock(button, isLocked) {
    if (!button) return;
    button.disabled = isLocked;
    button.classList.toggle('ss-fab-action-busy', isLocked);
}

async function handleSinglePass() {
    await closePanels();

    const messages = getAllMessages();
    if (!messages || messages.length === 0) {
        toastr.warning('No messages available');
        return;
    }

    const maxIndex = messages.length - 1;
    const rangeStr = await showSsInput(
        'Sharder: Select Range',
        `Enter message range for sharder (0 to ${maxIndex}):\nExample: '5-25'`,
        `0-${maxIndex}`
    );

    const range = parseRangeInput(rangeStr, maxIndex);
    if (!range) return;

    await callbacksRef.onSinglePass?.(range.startIdx, range.endIdx);
}

async function handleBatchSharder() {
    await closePanels();

    const messages = getAllMessages();
    if (!messages || messages.length === 0) {
        toastr.warning('No messages available');
        return;
    }

    const maxIndex = messages.length - 1;
    const { openBatchConfigModal } = await import('../modals/summarization/batch-config-modal.js');
    const config = await openBatchConfigModal(messages, maxIndex);
    if (!config?.confirmed) return;

    await callbacksRef.onBatchSharder?.(config.ranges || [], config.batchConfig || {});
}

function parseRangeInput(rangeStr, maxIndex) {
    if (!rangeStr) return null;

    const match = rangeStr.trim().match(/^(\d+)\s*-\s*(\d+)$/);
    if (!match) {
        toastr.warning('Invalid range format. Use: start-end (e.g., 0-25)');
        return null;
    }

    const startIdx = parseInt(match[1], 10);
    const endIdx = parseInt(match[2], 10);

    if (startIdx > endIdx) {
        toastr.warning('Start index must be less than or equal to end index');
        return null;
    }

    if (endIdx > maxIndex) {
        toastr.warning(`End index cannot exceed ${maxIndex}`);
        return null;
    }

    return { startIdx, endIdx };
}

function savePosition(x, y) {
    if (!settingsRef.fab) settingsRef.fab = {};
    const nextPosition = clampToViewport(x, y);
    settingsRef.fab.position = { ...nextPosition };
    pendingPositionValue = { ...nextPosition };
    schedulePendingPositionSaveFlush();
}

function schedulePendingPositionSaveFlush() {
    if (pendingPositionSaveId !== null) return;

    const run = () => {
        pendingPositionSaveId = null;
        pendingPositionSaveMode = null;
        flushPendingPositionSave();
    };

    if (typeof window.requestIdleCallback === 'function') {
        pendingPositionSaveMode = 'idle';
        pendingPositionSaveId = window.requestIdleCallback(run, { timeout: POSITION_SAVE_IDLE_TIMEOUT_MS });
        return;
    }

    pendingPositionSaveMode = 'timeout';
    pendingPositionSaveId = window.setTimeout(run, POSITION_SAVE_TIMEOUT_FALLBACK_MS);
}

function cancelPendingPositionSaveFlush() {
    if (pendingPositionSaveId === null) return;
    if (pendingPositionSaveMode === 'idle' && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(pendingPositionSaveId);
    } else {
        window.clearTimeout(pendingPositionSaveId);
    }
    pendingPositionSaveId = null;
    pendingPositionSaveMode = null;
}

function flushPendingPositionSave() {
    cancelPendingPositionSaveFlush();
    if (!pendingPositionValue || !settingsRef) return;

    const nextPosition = pendingPositionValue;
    pendingPositionValue = null;
    if (samePosition(lastPersistedPosition, nextPosition)) {
        return;
    }

    const startedAt = performance.now();
    saveSettings(settingsRef);
    lastPersistedPosition = { ...nextPosition };
    recordFabPerfSample('savePosition.flush', performance.now() - startedAt);
}

function samePosition(a, b) {
    if (!a || !b) return false;
    return a.x === b.x && a.y === b.y;
}

function restorePosition() {
    const pos = settingsRef.fab?.position;
    if (pos && pos.x !== null && pos.y !== null) {
        const clamped = clampToViewport(pos.x, pos.y);
        setFabPosition(clamped.x, clamped.y);
    }
}

function clampToViewport(x, y) {
    const size = FAB_SIZE_PX * getMobileScale();
    const maxX = Math.max(0, window.innerWidth - size);
    const maxY = Math.max(0, window.innerHeight - size);
    return {
        x: clamp(Number.isFinite(x) ? x : 0, 0, maxX),
        y: clamp(Number.isFinite(y) ? y : 0, 0, maxY),
    };
}

function setFabPosition(x, y) {
    if (!fabElement) return;
    fabElement.style.setProperty('left', `${x}px`, 'important');
    fabElement.style.setProperty('top', `${y}px`, 'important');
    fabElement.style.setProperty('right', 'auto', 'important');
    fabElement.style.setProperty('bottom', 'auto', 'important');
}

function getViewportInfo() {
    const viewport = window.visualViewport;
    if (!viewport) {
        return {
            width: window.innerWidth,
            height: window.innerHeight,
            offsetLeft: 0,
            offsetTop: 0,
        };
    }

    return {
        width: viewport.width,
        height: viewport.height,
        offsetLeft: viewport.offsetLeft,
        offsetTop: viewport.offsetTop,
    };
}

function getRenderedFabPosition() {
    if (!fabElement) {
        return { x: 0, y: 0 };
    }

    const rect = fabElement.getBoundingClientRect();
    const viewport = getViewportInfo();
    return {
        x: rect.left + viewport.offsetLeft,
        y: rect.top + viewport.offsetTop,
    };
}

function getSafeCurrentPosition() {
    const current = getRenderedFabPosition();
    return clampToViewport(current.x, current.y);
}

function isMobileViewport() {
    return window.matchMedia?.(MOBILE_BREAKPOINT_QUERY)?.matches ?? (window.innerWidth <= 768);
}

function shouldApplyMobileNudge(home, safeOpen) {
    if (!isMobileViewport()) return false;
    if (!isValidPoint(home) || !isValidPoint(safeOpen)) return false;
    const delta = Math.abs(home.x - safeOpen.x) + Math.abs(home.y - safeOpen.y);
    return delta >= MIN_NUDGE_DELTA_PX;
}

function computeSafeOpenPosition(x, y, viewportInfo = getViewportInfo()) {
    const scale = getMobileScale();
    const fabRadius = FAB_RADIUS_PX * scale;
    const wingPadding = SAFE_VIEWPORT_MARGIN_PX + (WHEEL_RADIUS_PX * scale) + (WHEEL_MAX_HALF_EXTENT_PX * scale) + MOBILE_EXTRA_TAP_PADDING_PX;

    const minCenterX = viewportInfo.offsetLeft + wingPadding;
    const maxCenterX = viewportInfo.offsetLeft + viewportInfo.width - wingPadding;
    const minCenterY = viewportInfo.offsetTop + wingPadding;
    const maxCenterY = viewportInfo.offsetTop + viewportInfo.height - wingPadding;

    const clampedCenterX = clamp(
        x + fabRadius,
        Math.min(minCenterX, maxCenterX),
        Math.max(minCenterX, maxCenterX)
    );
    const clampedCenterY = clamp(
        y + fabRadius,
        Math.min(minCenterY, maxCenterY),
        Math.max(minCenterY, maxCenterY)
    );

    return clampToViewport(
        clampedCenterX - fabRadius,
        clampedCenterY - fabRadius
    );
}

async function animateFabPosition(x, y, { duration = 0, easing = 'linear' } = {}) {
    const target = clampToViewport(x, y);
    const current = getSafeCurrentPosition();
    const totalDelta = Math.abs(current.x - target.x) + Math.abs(current.y - target.y);

    if (totalDelta < 0.5) {
        setFabPosition(target.x, target.y);
        return;
    }

    stopRelocationAnimation({ freezePosition: true });
    setFabPosition(current.x, current.y);

    const supportsWaapi = typeof fabElement?.animate === 'function' && duration > 0;
    if (!supportsWaapi) {
        setFabPosition(target.x, target.y);
        return;
    }

    const animation = fabElement.animate(
        [
            { left: `${current.x}px`, top: `${current.y}px` },
            { left: `${target.x}px`, top: `${target.y}px` },
        ],
        {
            duration,
            easing,
            fill: 'forwards',
        }
    );
    relocation.anim = animation;

    try {
        await animation.finished;
    } catch {
        // ignored
    } finally {
        if (relocation.anim === animation) {
            relocation.anim = null;
        }
        try {
            animation.cancel();
        } catch {
            // ignored
        }
        setFabPosition(target.x, target.y);
    }
}

function stopRelocationAnimation({ freezePosition = true } = {}) {
    const animation = relocation.anim;
    if (!animation) return;

    const frozenPosition = freezePosition ? getSafeCurrentPosition() : null;
    relocation.anim = null;

    try {
        animation.commitStyles?.();
    } catch {
        // ignored
    }
    try {
        animation.cancel();
    } catch {
        // ignored
    }

    if (frozenPosition) {
        setFabPosition(frozenPosition.x, frozenPosition.y);
    }
}

function resetRelocationState({ cancelAnimation = true } = {}) {
    if (cancelAnimation) {
        stopRelocationAnimation({ freezePosition: true });
    }
    relocation = createRelocationState();
}

function clearRelocationForDrag() {
    stopRelocationAnimation({ freezePosition: true });
    resetRelocationState({ cancelAnimation: false });
}

function handleViewportChange() {
    if (!fabElement) return;

    if (fabElement.style.left !== '') {
        let nextPosition = getSafeCurrentPosition();

        if (
            isOpenState()
            && relocation.shouldReturn
            && (relocation.mode === 'nudged' || relocation.mode === 'nudging-in')
        ) {
            stopRelocationAnimation({ freezePosition: true });
            nextPosition = computeSafeOpenPosition(nextPosition.x, nextPosition.y, getViewportInfo());
            relocation.mode = 'nudged';
            relocation.nudged = { ...nextPosition };
        } else {
            nextPosition = clampToViewport(nextPosition.x, nextPosition.y);
        }

        setFabPosition(nextPosition.x, nextPosition.y);
    }

    if (panelsController) {
        panelsController.reposition(getFabRect());
    }
}

function isValidPoint(point) {
    return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function getFabRect() {
    return fabElement.getBoundingClientRect();
}

function getTrigger() {
    return fabElement.querySelector('.ss-fab-trigger');
}

function isOpenState() {
    return fabState === 'open' || fabState === 'opening';
}

function focusFirstInPanels() {
    panelsController?.focusInitial?.();
}

function restoreFocus() {
    if (previousFocus && typeof previousFocus.focus === 'function') {
        previousFocus.focus();
    } else {
        getTrigger()?.focus();
    }
    previousFocus = null;
}

function trapFocus(event, container) {
    const focusable = getFocusableElements(container);
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
    } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
    }
}

function getFocusableElements(container) {
    return [...container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter((node) => !node.disabled && node.getClientRects().length > 0);
}

function isFocusWithinFabControls() {
    const active = document.activeElement;
    if (!active) return false;
    return Boolean(fabElement?.contains(active) || panelsController?.containsTarget(active));
}

export function updateFabVisibility() {
    if (!fabElement) return;
    fabElement.style.display = settingsRef.fab?.enabled !== false ? '' : 'none';

    if (fabElement.style.display === 'none') {
        flushPendingPositionSave();
        closePanelsImmediate();
    }
}

export function destroyFab() {
    if (onOutsideClick) document.removeEventListener('pointerdown', onOutsideClick);
    if (onResize) window.removeEventListener('resize', onResize);
    if (onVisualViewportChange && window.visualViewport) {
        window.visualViewport.removeEventListener('resize', onVisualViewportChange);
        window.visualViewport.removeEventListener('scroll', onVisualViewportChange);
    }
    if (onOperationStarted) window.removeEventListener('ss-operation-started', onOperationStarted);
    if (onOperationEnded) window.removeEventListener('ss-operation-ended', onOperationEnded);
    if (onKeyDown) document.removeEventListener('keydown', onKeyDown);
    if (onPageHide) window.removeEventListener('pagehide', onPageHide);
    if (onBeforeUnload) window.removeEventListener('beforeunload', onBeforeUnload);

    const sharderToggle = document.getElementById('ss-sharder-mode');
    if (sharderToggle && onSharderModeChange) {
        sharderToggle.removeEventListener('change', onSharderModeChange);
    }

    closePanelsImmediate();
    cancelScheduledTogglePanels();
    flushPendingPositionSave();

    animator?.destroy();
    animator = null;

    if (fabElement) {
        fabElement.remove();
        fabElement = null;
    }

    fabState = 'closed';
    relocation = createRelocationState();
    fabTransitionToken = 0;
    pendingPositionValue = null;
    lastPersistedPosition = null;
    onPageHide = null;
    onBeforeUnload = null;
    settingsRef = null;
    callbacksRef = null;
    isGenerating = false;
}


