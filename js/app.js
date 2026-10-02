import {dspOpenErrorMessage} from './dsp-open-status.js';
import {installFileLaunch} from './file-launch-ui.js';
import {createDspFileSession,fingerprintDspFile,DSP_FILE_TYPES,dspFilename} from './dsp-file-session.js';
import {createRecentActivityClient} from './recent-activity-client.js';
import '../css/recent-works.css';
import {createRecentWorksUI} from './recent-works-ui.js';
import {createRecentDirectory} from './recent-works.js';
import '../css/project-trash.css';
import {renderProjectTrash, confirmProjectTrash} from './project-trash-ui.js';
import {projectTrashError} from './project-trash-client.js';
import {localRecentId} from './local-recent-store.js';
import {showSafeResume} from './safe-resume-ui.js';
import '../css/safe-resume.css';
import {safeResume,protectLocalRecentProject,protectCloudBrowserCopy,flushBeforeSafeResume,isCloudResumeBlocked,markRestoredCloudCopy} from './firebase.js';
import {localCopyDeleteButton,confirmLocalCopyDeletion,showLocalCopyUndo} from './local-copy-delete-ui.js';
import {detachLocalProject,clearCloudMetadata} from './authoring-location.js';
import {chooseAuthoringDestination} from './authoring-destination-dialog.js';
import { localCopySpaceLabel } from './home-local-space.js';
import {syncAuthSaveStatus} from './studio-auth-save-status.js';
import {createStudioInbox} from './studio-inbox.js';
import {createPersonalSharingClient,openPersonalSharingDialog} from './personal-sharing-ui.js';
import {renderJoinedSpaceWorks} from './joined-space-works.js';
import {projectActionsMarkup,bindProjectActions,openProjectSpaceDialog} from './project-actions-ui.js';
import {openProjectCopyDialog} from './project-copy-ui.js';
import {newCloudProjectCopyJob,refreshCloudProjectListing} from './firebase.js';
import '../css/space-members-settings.css';
import { createSpaceMembersSettings } from './space-members-settings.js';
import { createInvitationsClient } from './publishing-invitations-transport.js';
import { withHomeDeadline, homeLoadingMarkup } from './home-load.js';
import '../css/home-workspace.css';
import { createHomeWorkspace } from './home-workspace.js';
import '../css/publishing-spaces.css';
import { createPublishingSpaceUI } from './publishing-spaces-ui.js';
import { requestPublishingSpaces } from './publishing-spaces-client.js';
import { initHistoryPanel } from './studio-history-panel.js';
import { appendPreparedProjectAsset } from './project-assets.js';
import { createImagePagePlan } from './editor-image-page.js';
import { createImagePageImporter, installImagePagePaste } from './editor-image-paste.js';
import { discardPreparedAuthoringImage, inspectPageImageAsset } from './firebase.js';
import { createProjectWithBackup } from './editor-project-create.js';
import { formatFlowPageStatus } from './editor-flow-labels.js';
import { initStudioWebMCP, studioWebMCPMarkup } from './studio-webmcp.js';
import { getProjectSessionIdentity, getProjectSessionEpoch, resetProjectSession, subscribeProjectSession } from './state.js';
let studioAI = null;
import { initStudioHelp } from './studio-help.js';
import {applyFlowReplacePlan} from './flow-replace.js';
import {setFlowPagePlacement,resolvePagePlacement} from './flow-page-placement.js';
import { createStudioFlowSearch } from './studio-flow-search.js';
import { resolveFlowSearchTarget } from './flow-search.js';
import {createFlowObjectToolbarAdapter} from './flow-object-toolbar-adapter.js';
import {openEditorViewerPreview} from './editor-viewer-preview.js';
import { createStudioObjectToolbar } from './studio-object-toolbar.js';
import { validateGraphicObjects, graphicOrder, initializeGraphicObjects } from './graphic-object-model.js';
import { appendGraphicPreview } from './graphic-object-renderer.js';
import { createFlowManuscriptCompare } from './flow-manuscript-compare.js';
import { renderFlowTranslationAutomationPanel } from './flow-authoring-view.js';
import { getFlowEditorProjectionScope } from './flow-editor-session.js';
import { createFlowTranslationCompare } from './flow-translation-compare.js';
import { syncImageRibbonContext, initFlowRibbon, syncFlowRibbonContext, refreshFlowRibbon, syncRibbonDrawerButtons } from './studio-flow-ribbon.js';
import { showFlowIndentRuler, hideFlowIndentRuler } from './flow-indent-ruler.js';
import { canRemoveEmptyFlowTextBlock } from './flow-paragraph-merge.js';
import { createProjectAssetPanel } from './project-asset-panel.js';


/**
 * app.js — Studio メインエントリ（描画・UI 同期・room 切り替え）
 *
 * Room 境界・認証（Google GIS + Firebase）の地図:
 *   docs/studio-app-room-boundaries.md
 *
 * 大まかな塊:
 *   - Home: ダッシュボード（renderHomeDashboard）
 *   - Editor: refresh / キャンバス / サムネ（このファイルが最も長い）
 *   - Press / Works: enterPressRoom（press.js）, openWorksRoom（works.js）は switchRoom から委譲
 *   - 認証 UI: getStudioAuthMarkup → renderStudioAuthSlot（GIS ボタン + フォールバック）
 */
import '../css/flow-annotations.css';
import { openAnnotationDialog } from './flow-annotation-ui.js';
import { refreshFlowRichInput } from './flow-source-rich-input.js';
import { state, dispatch, actionTypes } from './state.js';
import { installSharedRecoveryUI } from './shared-recovery-ui.js';
import { installSharedStudioUI } from './shared-studio-ui.js';
import { subscribeSharedStudioAccess, readSharedStudioAccess, canEditSharedStudio, canReadSharedStudio, assertSharedStudioEdit, assertPersonalStudioOperation } from './shared-studio-access.js';
import { loadSharedProject, checkSharedStudioAccess, sharedStudioLockAction } from './firebase.js';
import { sharedDraftRecovery, prepareSharedSpaceLeave, finishSharedSpaceLeave, getEditorSaveStatus, restorePreviousCloudAuthoring, getLoadedPrivateAuthoringHead, saveProject as persistProject, loadProject, uploadToStorage, prepareAuthoringImage, uploadCoverToStorage, uploadStructureToStorage, triggerAutoSave, flushSave, flushPendingSave, removeLocalRecentProject, restoreLocalRecentProject, generateCroppedThumbnail, listLocalRecentProjects, loadLocalRecentProject, cacheLocalRecentProject, ensureUserBootstrap, storePublicationThumbnailFile, auth as firebaseAuth, authReady, db } from './firebase.js';
import { initGIS, renderGISButton, signInWithGoogle, signOutUser, onAuthChanged, handleRedirectResult } from './gis-auth.js';
import { handleCanvasClick, selectBubble, renderBubbleHTML, getBubbleText, setBubbleText, addBubbleAtCenter, startDrag, startTailDrag, startSpikeDrag } from './bubbles.js';
import { addSection, addTextSection, changeSection, changeBlock, insertStructureBlock, renderThumbs, canDeleteActive, deleteActive, deleteSectionAt, insertSectionAt, insertSpreadImageAt, duplicateSectionAt, moveSection, moveSectionRange, insertPageNearBlock, duplicateBlockAt, moveBlockAt, getOptimizedImageUrl } from './sections.js';
import { pushState, endHistoryGroup, undo, redo, getHistoryInfo, clearHistory, listHistoryEntries, readHistoryEntry, getHistoryGuard } from './history.js';
import { openProjectModal, closeProjectModal, fetchCloudProjects, getCoverImage, getPageCount, deleteCloudProject, restoreCloudProject } from './projects.js';
import { openWorksRoom, closeWorksRoom, refreshWorksRoomLanguage } from './works.js';
import { enterPressRoom, leavePressRoom, refreshFlowHorizonDryRunReadiness } from './press.js';
import { getLangProps, getAllLangs } from './lang.js';
import { t, applyI18n, setUILang, getUILang } from './i18n-studio.js';
import { createPageBlockFromSection, createSectionFromPageBlock, getBlockIndexFromPageIndex, getPageIndexFromBlockIndex, migrateSectionsToBlocks, syncBlocksWithSections, extractSectionsFromBlocks } from './blocks.js';
import { blocksToPages } from './pages.js';
import { moveAuthoringUnitInSpine, moveFixedPageRangeInSpine } from './fixed-page-spine.js';
import {localDraftStatus,isLocalDraft,noteLocalDraftEdit,setLocalCloudTransitionPending} from './local-draft-runtime.js';
import {chooseDspFilename,confirmDspDownload,showDspSaveError} from './dsp-save-dialog.js';
import {installStudioPwa} from './studio-pwa.js';
import {installHomeStart} from './home-start.js';
import { buildDSP, buildDSF, parseAndLoadDSP } from './export.js';
import { hydrateProjectFromPersistence } from './project-persistence.js';
import { applyTheme, bindThemePreferenceListener, getThemeMode, setThemeMode } from './theme.js';
import { get as idbGet } from 'idb-keyval';
import { createId } from './utils.js';
import { CANONICAL_PAGE_WIDTH, CANONICAL_PAGE_HEIGHT } from './page-geometry.js';
import { loadBookSpinePublisher } from './book-spine-publisher.js';
import { mountBookSpineEditor, bookSpineSettingsReady, releaseBookSpineEditor } from './book-spine-editor.js';
import { canInsertSpreadImageAt, getBookCompositionIssues, getPageDisplayLabel, getReadablePageCount, normalizeBookSettings, getPageCoverKey } from './page-labels.js';
import { composeText, paginateText, PAGE_BREAK_MARKER, getWritingModeFromConfigs, getFontPresetFromConfigs, getFontPresetOptions, parseRubyTokens, tokensToPlainText, alignRubyToLines } from './layout.js';
import { formatPublicationDate, normalizePlanTier } from './publication.js';
import { resolveProjectDisplayTitle, resolveProjectName } from './project-display-title.js';
import { selectProjectAuthoringCoverThumbnail } from './project-listing-thumbnail.js';
import { buildOwnerDraftViewerUrl } from './viewer-owner-preview.js';
import { buildPublicViewerUrl } from './viewer-release-route.js';
import { PROJECT_SCHEMA_VERSION, createFlowGroupBlock, hasFlowGroups } from './flow-project-model.js';
import { applyFlowAuthoringOperation } from './flow-authoring.js';
import { createFlowTextSelection, validateFlowTextSelection } from './flow-text-selection.js';
import { isolateFlowTitlePage, updateFlowTitleRegion } from './flow-title-page.js';
import { getFlowJoinLayoutDifferences, inspectFlowJoin, joinFlowWithPrevious } from './flow-group-join.js';
import { createFlowImageInsertion, moveExistingImageIntoFlow } from './flow-image-insertion.js';
import { alignFlowDirectCompositionElement } from './flow-direct-composition.js';
import { createFlowCanvasView } from './flow-canvas-view.js';
import { bindEditorThumbnailDrag } from './editor-thumbnail-drag.js';
import { buildFlowPageProjection } from './flow-page-projection.js';
import { resolveEditorFlowPageBoundary, resolveEditorFlowSourcePoint, findEditorCanvasFlowPageIndex, getEditorCanvasSpreadJoins } from './editor-canvas-projection.js';
import { normalizeFlowPageGuideMode } from './flow-page-guides.js';
import { measureFlowDirectNavigationStops, resolveFlowDirectNavigation } from './flow-direct-navigation.js';
import {
    FlowDirectEditError,
    createFlowDirectEditSession,
    createFlowDirectBlockFormatTransaction,
    createFlowDirectEditTransaction,
    createFlowDirectEmptyParagraphAfterHeadingRemovalTransaction,
    createFlowDirectHeadingParagraphTransaction,
    createFlowDirectPageBreakTransaction,
    createFlowDirectParagraphMergeBackwardTransaction,
    createFlowDirectParagraphMergeForwardTransaction,
    createFlowDirectParagraphSplitTransaction,
    createFlowDirectTextSplitTransaction,
} from './flow-direct-edit.js';
import {
    ensureFlowLanguageTypography,
    getFlowLanguageProgress,
    getFlowSourceLanguageGroupIds,
    resolveFlowAuthoringLanguage,
} from './flow-multilingual-authoring.js';
import { isFlowWritingModeSupported } from './flow-typography.js';
import { deriveFlowTranslationStatus } from './flow-translation-state.js';
import { chooseSourceLanguage, languageName, updateLanguagePresentation, annotateTranslationPage } from './studio-language-settings.js';
import {
    createFlowTranslationApplyPlan,
    createFlowTranslationRequest,
} from './flow-translation-request.js';
import { applyFlowTranslationPlan } from './flow-translation-apply.js';
import {
    listTranslationProviderModels,
    listTranslationProviders,
    registerTranslationProvider,
    runTranslationProvider,
} from './translation-provider.js';
import {
    BROWSER_TRANSLATOR_PROVIDER_ID,
    createBrowserTranslationProvider,
    isBrowserTranslatorSupported,
} from './browser-translator-provider.js';
import {
    LM_STUDIO_TRANSLATOR_PROVIDER_ID,
    createLMStudioTranslationProvider,
} from './lm-studio-translator-provider.js';
import {
    getFlowTranslationApplyFailurePresentation,
    renderFlowAuthoringView,
    updateFlowAuthoringViewStatus,
    updateFlowTranslationAutomationView,
} from './flow-authoring-view.js';
import {
    getFlowEditorSelection,
    isFlowDirectEditing,
    isFlowSourceSelected,
    resetFlowEditorSelections,
    restoreFlowDirectSelection,
    selectFlowDirectEditing,
    selectFlowGeneratedPage,
    selectFlowSource,
} from './flow-editor-session.js';
import { renderFlowGeneratedPage } from './flow-dom-measurer.js';
import {
    findFlowSourcePointInPages,
    getFlowSourcePointClientRect,
    getFlowSourceRangeClientRects,
    mapFlowClientPointToSource,
    mapFlowTextUtf16OffsetToGrapheme,
} from './flow-source-mapping.js';
import {
    FLOW_RUNTIME_INVALIDATED_EVENT,
    createFlowRuntimePageProjection,
    createFlowRuntimeProjectionSignature,
    getCachedFlowRuntimePageProjection,
    getSelectedFlowRuntimePageIndex,
    invalidateFlowRuntimeAuthoring,
    invalidateFlowRuntimePages,
    setSelectedFlowRuntimePageIndex,
} from './flow-runtime-pages.js';
import { collection, getDocs, query, where, limit } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const flowObjectToolbar=createFlowObjectToolbarAdapter({
    state,
    canEdit:()=>canEditSharedStudio() && !_flowAuthoringComposing && _flowTranslationJob?.state!=='running',
    stopEditing:()=>{
        clearFlowDirectEditRuntime();
        const group=getActiveBlock();
        if(group?.kind==='flow')selectFlowGeneratedPage(group.id);
    },
    getAnchor:group=>{
        if(_flowDirectEditSession?.groupId===group.id)return _flowDirectEditSession.blockId;
        const index=getSelectedFlowRuntimePageIndex(group.id);
        const page=_flowCanvasView?.getPages()?.find(p=>p.groupId===group.id&&p.flowPageIndex===index);
        return page?.page.fragments.find(f=>f.blockType==='paragraph')?.blockId
            || group.flow.document.sections.flatMap(s=>s.blocks).find(b=>b.type==='paragraph')?.id;
    },
    save:(group,assets)=>{
        clearFlowDirectEditRuntime();endHistoryGroup();pushState();
        state.projectAssets=assets;state.version=6;
        dispatch({type:actionTypes.SET_STATE_FIELD,payload:{key:'blocks',value:state.blocks.map(b=>b.id===group.id?group:b)}});
        _flowAuthoringSourceRevision+=1;
        scheduleFlowAuthoringReflow(group.id,{immediate:true});refresh();updateHistoryButtons();triggerAutoSave();
    },
});
const objectToolbar = createStudioObjectToolbar({
    flow:flowObjectToolbar,
    state, refresh, prepareImage: prepareAuthoringImage, canEdit:canEditActiveFixedPage,
    activateAt: target => {
        const surface=target.closest('[data-testid="editor-fixed-page"],[data-testid="flow-editor-generated-page"]'),page=surface?._flowPageEntry;
        if(page?.kind!=='fixed' && page?.groupId){
            if(page.isSourceFallback || !flowObjectToolbar.canEdit())return false;
            clearFlowDirectEditRuntime();activateProjectionPage(page);setSelectedFlowRuntimePageIndex(page.groupId,page.flowPageIndex);return true;
        }
        if(page)activateProjectionPage(page);return canEditActiveFixedPage();
    },
    commitBlocks: mutate => {
        if(!canEditActiveFixedPage())return false;
        const blocks=structuredClone(state.blocks);
        try{mutate(blocks);validateGraphicObjects({...state,blocks});}catch{return false;}
        endHistoryGroup();pushState();state.blocks=blocks;state.version=6;
        state.sections=extractSectionsFromBlocks(blocks);state.pages=blocksToPages(blocks);
        refresh();updateHistoryButtons();triggerAutoSave();return true;
    },
    editText: (id,language,value) => {
        if(!canEditActiveFixedPage())return;
        const target=getActiveBlock(),object=target.content.graphicObjects?.find(o=>o.id===id);
        if(!object||object.locked||object.texts[language]===value)return;
        pushState({groupKey:`graphic-text:${target.id}:${id}:${language}`});
        object.texts[language]=value;
        state.sections=extractSectionsFromBlocks(state.blocks);state.pages=blocksToPages(state.blocks);
        updateHistoryButtons();triggerAutoSave();
    },
    finishText:()=>{endHistoryGroup();refresh();},
    selectLegacy: index => { state.activeBubbleIdx=index; refresh(); },
    commit: mutate => {
        const target=getActiveBlock(); if(target?.kind!=='page'||!canEditActiveFixedPage()) return;
        const content=structuredClone(target.content),oldAssets=state.projectAssets,oldVersion=state.version;
        try { mutate(content); validateGraphicObjects({...state,blocks:state.blocks.map(b=>b===target?{...b,content}:b)}); }
        catch { state.projectAssets=oldAssets;state.version=oldVersion;alert('変更できませんでした。入力値を確認してください。 / Check object values.');return; }
        const assets=state.projectAssets;
        state.projectAssets=oldAssets;state.version=oldVersion;
        endHistoryGroup();pushState();target.content=content;state.projectAssets=assets;state.version=6;
        state.sections=extractSectionsFromBlocks(state.blocks);state.pages=blocksToPages(state.blocks);
        refresh();updateHistoryButtons();triggerAutoSave();
    }
});
const flowSearch = createStudioFlowSearch({
    state,
    canNavigate: () => !_flowAuthoringComposing && _flowTranslationJob?.state !== 'running',
    canReplace: () => !editorDragBlocked() && !_editorFlowProjectionController,
    applyReplacement: plan => {
        if(editorDragBlocked()||_editorFlowProjectionController)throw Object.assign(new Error('REPLACE_BUSY'),{code:'REPLACE_STALE'});
        const active=getActiveBlock(),source=active?.kind==='flow'&&isFlowSourceSelected(active.id);
        const result=applyFlowReplacePlan(state.blocks,plan);
        if(result.count)applyEditorSpineChange({...result,activeBlockIndex:state.activeBlockIdx},{flowPageIndex:getSelectedFlowRuntimePageIndex(active?.id),preserveFlowSource:source});
        return result;
    },
    reveal: async (match, isCurrent) => {
        const target = resolveFlowSearchTarget(state.blocks, match);
        if (!target) return false;
        const sourceMode = getActiveBlock()?.kind === 'flow' && isFlowSourceSelected(getActiveBlock().id);
        endHistoryGroup(); clearFlowDirectEditRuntime(); objectToolbar.clearSelection();
        state.activeLang = match.languageKey;
        const point = { sectionId: match.sectionId, blockId: match.blockId, languageKey: match.languageKey,
            utf16Offset: match.start, ...mapFlowTextUtf16OffsetToGrapheme(match.expectedText, match.start, match.languageKey, 'forward'),
            affinity: 'forward', selectionStart: match.start, selectionEnd: match.end };
        if (sourceMode) selectFlowSource(match.groupId, point); else selectFlowDirectEditing(match.groupId, point);
        changeBlock(state.blocks.indexOf(target.group), refresh);
        for (let attempt = 0; attempt < 100 && isCurrent(); attempt++) {
            if (!resolveFlowSearchTarget(state.blocks, match) || state.activeLang !== match.languageKey || getActiveBlock()?.id !== match.groupId) return false;
            if (sourceMode) {
                const root = [...document.querySelectorAll('.flow-authoring-editor, #flow-authoring-surface')].find(el => el.getClientRects().length && el.dataset.flowGroupId === match.groupId && el.dataset.languageKey === match.languageKey);
                const input = [...(root?.querySelectorAll('[data-flow-field="block-text"]') || [])].find(el => {
                    const target = getFlowAuthoringTarget(el); return target.sectionId === match.sectionId && target.blockId === match.blockId;
                });
                if (input && input.value === match.expectedText) {
                    input.focus({ preventScroll: true });input.setSelectionRange(match.start, match.end);
                    scrollFlowSourceCaretIntoView(root, input, match.start);return true;
                }
            }
            const pages = !sourceMode && getEditorPageProjection()?.pages.filter(p => p.kind === 'flow' && p.groupId === match.groupId && p.languageKey === match.languageKey);
            const location = pages && findFlowSourcePointInPages(pages, point);
            const page = location && pages[location.pageIndex];
            if (page && !_editorFlowProjectionController) {
                const surface = ensureFlowCanvasPage(page.flowPageIndex, true);
                const session = tryCreateFlowDirectEditSession(target.group, page, point);
                if (surface && session) {
                    selectFlowDirectEditing(match.groupId, point);
                    mountFlowDirectEditProxy(target.group, page, surface, { ...session, selectionStart: match.start, selectionEnd: match.end });
                    setSelectedFlowRuntimePageIndex(match.groupId, page.flowPageIndex, page.flowPageCount);
                    syncThumbSelectionDom(); syncPageNavigationSlider(); return true;
                }
            }
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        return false;
    },
});
const projectAssetPanel = createProjectAssetPanel({
    state, prepareImage: prepareAuthoringImage, inspectPageImage: inspectPageImageAsset,
    projectIdentity: getProjectSessionIdentity,
    renameAsset: (id, name) => {
        if (!state.projectAssets?.some(asset => asset.id === id)) return;
        endHistoryGroup(); pushState();
        state.projectAssets = state.projectAssets.map(asset => asset.id === id ? { ...asset, name } : asset);
        refresh(); updateHistoryButtons(); triggerAutoSave();
    },
    dropAsset: (id, target) => {
        const surface = target.closest?.('[data-testid="editor-fixed-page"], [data-testid="flow-editor-generated-page"]');
        if (surface) {
            const page = surface._flowPageEntry;
            if (!['fixed','flow'].includes(page?.kind)) return;
            activateProjectionPage(page);
        } else if (!target.closest?.('#canvas-view') || _flowCanvasView?.getPages()?.length) return;
        objectToolbar.placeAsset(id);
    },

    addAsset: ({ name, mainUrl, thumbUrl, width, height, byteLength }) => {
        const assets = appendPreparedProjectAsset(state.projectAssets, { mainUrl, thumbUrl, width, height, byteLength }, name, createId('asset'));
        if (assets === state.projectAssets) return;
        endHistoryGroup(); pushState();
        state.version = 6;
        state.projectAssets = assets;
        refresh(); updateHistoryButtons(); triggerAutoSave();
    },
    useAsset: (id, kind) => {
        if(kind==='place'){objectToolbar.placeAsset(id);return;}
        const asset = state.projectAssets?.find(item => item.id === id);
        if (!asset || _flowAuthoringComposing || _flowTranslationJob?.state === 'running') return;
        const active = getActiveBlock();
        if (kind === 'apply' && !(active?.kind === 'page' && active.content?.pageKind !== 'text')) return;
        if (kind === 'add') {
            if (readStudioAIState().busy) return;
            applyEditorSpineChange(createImagePagePlan(readStudioAIState(), id));
            return;
        }
        endHistoryGroup(); pushState();
        const target = getActiveBlock();
        if (target?.kind !== 'page') return;
        const group = target.content?.spreadImage?.groupId;
        for (const block of state.blocks) {
            if (block !== target && (!group || block.content?.spreadImage?.groupId !== group)) continue;
            block.content ||= {};
            block.content.backgrounds = { ...block.content.backgrounds, [state.activeLang]: asset.background };
            if ((state.languages || []).length <= 1) block.content.background = asset.background;
            block.content.thumbnail = asset.thumbnail;
            const position = { x: 0, y: 0, scale: 1, rotation: 0, flipX: false };
            block.content.imagePosition = position;
            block.content.imagePositions = { ...block.content.imagePositions, [state.activeLang]: position };
            block.content.imageBasePosition = { ...position };
        }
        state.sections = extractSectionsFromBlocks(state.blocks);
        state.pages = blocksToPages(state.blocks);
        refresh(); updateHistoryButtons(); triggerAutoSave();
    },
});
window.uploadAsset = event => projectAssetPanel.upload(event);

const EDITOR_FRAME_WIDTH = CANONICAL_PAGE_WIDTH;
const EDITOR_FRAME_HEIGHT = CANONICAL_PAGE_HEIGHT;
const IMAGE_SNAP_THRESHOLD = 12;
const editorImageAspectCache = new Map();
const TEXT_PAPER_PRESETS = Object.freeze({
    white: {
        label: '白紙',
        backgroundColor: '#ffffff',
        textColor: '#000000'
    },
    book: {
        label: '書籍用紙',
        backgroundColor: '#f7f1df',
        textColor: '#1f1b16'
    }
});
const TEXT_ALIGN_VALUES = Object.freeze(['start', 'center', 'end']);
const EMPTY_IMAGE_SNAP_STATE = Object.freeze({
    centerX: false,
    centerY: false,
    edgeLeft: false,
    edgeRight: false,
    edgeTop: false,
    edgeBottom: false
});
let imageSnapState = { ...EMPTY_IMAGE_SNAP_STATE };

// 見開きクリックで「隣ページをアクティブ化」した時、元のアクティブページを隣として維持するための一時保持
let _spreadActivationPinnedAdjIdx = -1;
let _pageHeadingPushTimer = null;
let _editorFlowProjectionController = null;
let _editorFlowProjectionRequestId = 0;
let _editorFlowProjectionRequestKey = '';
let _flowAuthoringReflowTimer = null;
let _flowAuthoringSourceRevision = 0;
let _flowAuthoringRenderedRevision = 0;
let _flowAuthoringComposing = false;
let _flowAuthoringLanguageFeedback = null;
const FLOW_AUTHORING_WRITING_MODES = Object.freeze(['horizontal-tb', 'vertical-rl']);
let _flowPendingSourceCaret = null;
let _flowImageInsertionBusy = false;
let _flowDirectEditProxy = null;
let _flowDirectEditSession = null;
let _flowDirectCompositionText = '';
let _flowDirectCompositionRange = null;
let _flowDirectEditMounting = false;
let _flowDirectEditApplying = false;
let _flowDirectPreferredInlinePosition = null;
let _flowDirectPointerCleanup = null;
let _flowCanvasView = null;
let _flowCompare = null;
let _flowManuscriptCompare = null;
let _flowNormalCanvasView = null;
const editorFlowScope = getFlowEditorProjectionScope;
let _flowCanvasContextKey = '';
let _flowPageGuideMode = 'off';
let _fixedCanvasFocus = null;

function getEditorCanvasProjection() {
    if (hasFlowGroups(state)) return getEditorPageProjection();
    return buildFlowPageProjection({ blocks: state.blocks || [], fixedPages: state.sections || [],
        requestedLanguageKey: state.activeLang || state.defaultLang || 'ja' });
}

function parkFixedCanvasStage() {
    const stage = document.getElementById('canvas-stage');
    const home = document.getElementById('canvas-view');
    if (!stage || !home || stage.parentElement === home) return;
    const focused = document.activeElement;
    if (stage.contains(focused)) {
        _fixedCanvasFocus = { element: focused, start: focused.selectionStart,
            end: focused.selectionEnd, direction: focused.selectionDirection };
    }
    home.appendChild(stage);
}

function attachFixedCanvasStage() {
    if (getActiveBlock()?.kind !== 'page' || _flowCanvasView?.viewport.hidden) return;
    const page = _flowCanvasView.getPages().find(p => p.kind === 'fixed' && p.blockIndex === state.activeBlockIdx);
    const surface = page && _flowCanvasView.getPageElement(page.index);
    const stage = document.getElementById('canvas-stage');
    if (!surface || !stage) return;
    if (stage.parentElement !== surface) {
        surface.replaceChildren(stage);
        surface.parentElement.classList.add('editor-fixed-active-frame');
    }
    stage.hidden = false;
    if (_fixedCanvasFocus?.element.isConnected) {
        const { element, start, end, direction } = _fixedCanvasFocus;
        _fixedCanvasFocus = null;
        element.focus({ preventScroll: true });
        if (typeof start === 'number' && typeof element.setSelectionRange === 'function') {
            element.setSelectionRange(start, end, direction);
        }
    }
}

function ensureFlowCanvasPage(flowPageIndex, reveal = true) {
    const groupId = _flowDirectEditSession?.groupId || getActiveBlock()?.id;
    const index = findEditorCanvasFlowPageIndex(_flowCanvasView?.getPages() || [], groupId, flowPageIndex);
    return index < 0 ? null : _flowCanvasView.ensurePage(index, reveal);
}

function getMountedActiveFlowPages() {
    const groupId = _flowDirectEditSession?.groupId || getActiveBlock()?.id;
    return (_flowCanvasView?.getMountedPages() || []).filter(entry => entry.page.kind === 'flow'
        && entry.page.groupId === groupId).map(entry => ({ ...entry, pageIndex: entry.page.flowPageIndex }));
}

function isFixedLanguageCompareActive() {
    return !hasFlowGroups(state) && !!state.uiPrefs?.languageCompareView && !!getActiveCompareLang();
}

function renderUnifiedFixedCanvas() {
    if (getActiveBlock()?.kind !== 'page' || isFixedLanguageCompareActive()) return;
    const projection = getEditorCanvasProjection();
    if (!projection?.pages.length) { if (!_flowCompare?.enabled) hideFlowCanvas(); return; }
    const selected = getActiveProjectionPageIndex(projection);
    if (selected < 0) return;
    const canvas = ensureFlowCanvasView();
    document.getElementById('canvas-view').classList.add('flow-canvas-active', 'editor-unified-canvas');
    canvas.viewport.setAttribute('aria-label', t('editor_canvas_label'));
    canvas.update(projection.pages, selected, `${state.projectId || 'local'}:${projection.languageKey}`);
    _flowCompare?.update(canvas);
    canvasScale = canvas.getScale();
    syncCanvasZoomUI();
}


function hideFlowCanvas() {
    if (_flowCompare?.enabled) _flowCompare.setEnabled(false);
    parkFixedCanvasStage();
    _flowCanvasView?.setGuideMode('off');
    _flowCanvasView?.setVisible(false);
    _flowCanvasContextKey = '';
    document.getElementById('canvas-view')?.classList.remove('flow-canvas-active', 'editor-unified-canvas');
    const stage = document.getElementById('canvas-stage');
    if (stage) stage.hidden = false;
}

function rememberFlowDirectSelection(session = _flowDirectEditSession) {
    if (!session || isFlowSourceSelected(session.groupId)) return;
    selectFlowDirectEditing(session.groupId, {
        ...session.sourcePoint,
        selectionStart: session.selectionStart,
        selectionEnd: session.selectionEnd,
        selectionDirection: session.selectionDirection,
    });
}

registerTranslationProvider(
    BROWSER_TRANSLATOR_PROVIDER_ID,
    createBrowserTranslationProvider(),
);
registerTranslationProvider(
    LM_STUDIO_TRANSLATOR_PROVIDER_ID,
    createLMStudioTranslationProvider(),
);

const _flowTranslationRuntime = {
    providerId: isBrowserTranslatorSupported(globalThis)
        ? BROWSER_TRANSLATOR_PROVIDER_ID
        : LM_STUDIO_TRANSLATOR_PROVIDER_ID,
    modelsByProvider: {
        [BROWSER_TRANSLATOR_PROVIDER_ID]: [{
            id: 'chrome-managed',
            label: 'Chrome built-in model',
        }],
    },
    modelIdByProvider: {
        [BROWSER_TRANSLATOR_PROVIDER_ID]: 'chrome-managed',
    },
    modelStateByProvider: {
        [BROWSER_TRANSLATOR_PROVIDER_ID]: 'ready',
        [LM_STUDIO_TRANSLATOR_PROVIDER_ID]: 'idle',
    },
    modelMessageByProvider: {},
};
let _flowTranslationJob = null;
let _flowTranslationJobSequence = 0;

function resetFlowRuntimeForProjectChange({keepSession = false} = {}) {
    if (!keepSession) resetProjectSession();
    if (_flowAuthoringReflowTimer) clearTimeout(_flowAuthoringReflowTimer);
    _flowAuthoringReflowTimer = null;
    _flowAuthoringSourceRevision = 0;
    _flowAuthoringRenderedRevision = 0;
    _flowAuthoringComposing = false;
    _flowAuthoringLanguageFeedback = null;
    _flowPendingSourceCaret = null;
    clearFlowDirectEditRuntime();
    _flowTranslationJob?.controller?.abort?.();
    _flowTranslationJob = null;
    endHistoryGroup();
    resetFlowEditorSelections();
    _editorFlowProjectionController?.abort();
    _editorFlowProjectionController = null;
    _editorFlowProjectionRequestKey = '';
    _editorFlowProjectionRequestId += 1;
    invalidateFlowRuntimePages();
}

function resetFlowRuntimeAfterGroupRemoval(groupId) {
    if (_flowAuthoringReflowTimer) clearTimeout(_flowAuthoringReflowTimer);
    _flowAuthoringReflowTimer = null;
    _flowAuthoringComposing = false;
    _flowAuthoringLanguageFeedback = null;
    _flowPendingSourceCaret = null;
    clearFlowDirectEditRuntime();
    if (_flowTranslationJob?.groupId === groupId) {
        _flowTranslationJob.controller?.abort?.();
        _flowTranslationJob = null;
    }
    resetFlowEditorSelections();
    _editorFlowProjectionController?.abort();
    _editorFlowProjectionController = null;
    _editorFlowProjectionRequestKey = '';
    _editorFlowProjectionRequestId += 1;
    _flowAuthoringSourceRevision += 1;
    invalidateFlowRuntimePages();
}

function getEditorPageProjection() {
    if (state.version !== 6 || !hasFlowGroups(state)) return null;
    const languageKey = getEditorFlowProjectionLanguage(getActiveBlock());
    return getCachedFlowRuntimePageProjection(
        state,
        languageKey,
        state.sections || [],
        document,
        editorFlowScope(),
    );
}

function getActiveProjectionPageIndex(projection = getEditorPageProjection()) {
    if (!projection?.pages?.length) return -1;
    const activeBlock = getActiveBlock();
    if (activeBlock?.kind === 'page') {
        return projection.pages.findIndex((page) => (
            page.kind === 'fixed' && page.blockIndex === state.activeBlockIdx
        ));
    }
    if (activeBlock?.kind === 'flow') {
        const selected = getSelectedFlowRuntimePageIndex(activeBlock.id);
        return projection.pages.findIndex((page) => (
            page.kind === 'flow'
            && page.groupId === activeBlock.id
            && page.flowPageIndex === selected
        ));
    }
    if (Number.isInteger(state.activeBlockIdx)) {
        const currentFixedPageIndex = projection.pages.findIndex((page) => (
            page.kind === 'fixed' && page.fixedPageIndex === state.activeIdx
        ));
        if (currentFixedPageIndex >= 0) return currentFixedPageIndex;
        const nextPageIndex = projection.pages.findIndex((page) => page.blockIndex >= state.activeBlockIdx);
        return nextPageIndex >= 0 ? nextPageIndex : projection.pages.length - 1;
    }
    return 0;
}

function activateProjectionPage(page) {
    if (!page) return;
    if (page.kind === 'flow') {
        selectFlowGeneratedPage(page.groupId);
        setSelectedFlowRuntimePageIndex(page.groupId, page.flowPageIndex, page.flowPageCount);
    }
    changeBlock(page.blockIndex, refreshForThumbSelection);
}

let _flowTextSelection = null;

function clearFlowDirectEditRuntime(options = {}) {
    hideFlowIndentRuler();
    if (!options.preservePointer) _flowDirectPointerCleanup?.();
    if (!options.preserveSelection) _flowTextSelection = null;
    const pageElement = _flowDirectEditProxy?._flowDirectPageElement;
    if (pageElement) {
        pageElement.classList.remove('flow-direct-edit-active', 'flow-direct-edit-reflow-pending');
        delete pageElement.dataset.flowDirectState;
        pageElement.querySelectorAll('[data-flow-direct-indicator]').forEach((element) => element.remove());
    }
    _flowDirectEditProxy?.remove?.();
    _flowDirectEditProxy = null;
    _flowDirectEditSession = null;
    _flowDirectCompositionText = '';
    _flowDirectCompositionRange = null;
    _flowDirectEditMounting = false;
    _flowDirectEditApplying = false;
    _flowCanvasView?.getMountedPages().forEach(({ pageElement }) => {
        pageElement.querySelectorAll('[data-flow-direct-indicator]').forEach(element => element.remove());
    });
    if (options.resetComposition !== false) _flowAuthoringComposing = false;
    syncFlowDirectFormatControls();
}


// Alignment belongs to semantic paragraphs, never generated page slices.
function flowParagraphAlignmentTargets(group, languageKey) {
    let points;
    if (_flowTextSelection) {
        const selection = validateFlowTextSelection(group, _flowTextSelection);
        if (!selection || selection.languageKey !== languageKey) return [];
        points = selection.ranges.filter((r,i,rows) => r.end > r.start
            || (i < rows.length-1 && r.text.length === 0));
    } else {
        const saved = isFlowSourceSelected(group.id) ? getFlowEditorSelection(group.id) : _flowDirectEditSession;
        if (!saved || saved.groupId !== group.id || (!isFlowSourceSelected(group.id) && !isFlowDirectEditing(group.id))) return [];
        if (saved.languageKey && saved.languageKey !== languageKey) return [];
        points = [saved];
    }
    return points.flatMap(point => {
        const block = group.flow.document.sections.find(s => s.id === point.sectionId)?.blocks.find(b => b.id === point.blockId);
        if (!['paragraph','heading'].includes(block?.type) || typeof block.texts?.[languageKey] !== 'string') return [];
        return [{sectionId:point.sectionId,blockId:block.id,expectedText:block.texts[languageKey],
            expectedAlignment:block.textAlignByLanguage?.[languageKey] ?? null,
            effectiveAlignment:block.textAlignByLanguage?.[languageKey] || block.titleRegion?.textAlign
                || group.flow.layout.typographyByLanguage[languageKey]?.textAlign || 'start'}];
    });
}

function syncFlowParagraphAlignment(group, languageKey) {
    const control = document.getElementById('flow-placement-inline');
    const targets = flowParagraphAlignmentTargets(group, languageKey);
    const values = new Set(targets.map(target => target.effectiveAlignment));
    control.value = values.size === 1 ? targets[0].effectiveAlignment : '';
    control.disabled = !targets.length || editorDragBlocked(false) || !!_editorFlowProjectionController
        || _flowDirectEditProxy?.dataset.flowReflowPending === 'true';
    control.onchange = () => {
        if (control.disabled || getActiveBlock()?.id !== group.id || getFlowAuthoringLanguage(group) !== languageKey
            || editorDragBlocked(false) || _editorFlowProjectionController) return;
        const current = flowParagraphAlignmentTargets(getFlowGroupById(group.id),languageKey);
        if (JSON.stringify(current) !== JSON.stringify(targets)) { syncFlowPageSourceControls(); return; }
        const value = control.value;
        if (current.every(target => target.effectiveAlignment === value)) return;
        const editorFocus = isFlowSourceSelected(group.id) ? captureFlowAuthoringFocusSnapshot() : captureFlowDirectEditFocusSnapshot();
        endHistoryGroup();
        try {
            applyFlowAuthoringEdit({type:'setTextAlign',groupId:group.id,languageKey,value,
                targets:current.map(({effectiveAlignment,...target})=>target)}, {immediate:true,editorFocus});
        } catch (error) { alert(t('flow_alignment_stale')); }
        syncFlowPageSourceControls();
    };
}

function syncFlowPageSourceControls() {
    const panel = document.getElementById('flow-page-source-props');
    const group = getActiveBlock();
    const active = group?.kind === 'flow';
    panel.hidden = !active;
    const languageKey = active ? getFlowAuthoringLanguage(group) : '';
    syncFlowRibbonContext({active, source:active && isFlowSourceSelected(group.id), language:languageKey,
        writingMode:group?.flow?.layout?.typographyByLanguage?.[languageKey]?.writingMode || group?.flow?.layout?.writingMode || 'horizontal-tb'});
    if (!active) {
        const status=document.getElementById('flow-placement-status');
        if(status)status.textContent='';
        return;
    }
    const profile = group.flow.layout.typographyByLanguage[languageKey];
    const scope = document.getElementById('flow-placement-scope');
    const page = getEditorPageProjection()?.pages.find(p=>p.kind==='flow' && p.groupId===group.id
        && p.flowPageIndex===getSelectedFlowRuntimePageIndex(group.id));
    const titleRegion=page?.page?.fragments?.[0]?.titleRegion;
    const canUsePage = !!page && !page.isSourceFallback && page.languageKey===languageKey
        && !isFlowSourceSelected(group.id) && !editorDragBlocked(false)
        && !_editorFlowProjectionController && _flowDirectEditProxy?.dataset.flowReflowPending!=='true';
    const canChangeStructure = canUsePage && languageKey===group.flow.document.sourceLanguage;
    const canAlignPage = canUsePage;
    const pagePlacement=page ? resolvePagePlacement(group,page.page,languageKey) : {};
    scope.dataset.sharedTitle = String(!!titleRegion);
    scope.title = t(titleRegion ? 'flow_scope_shared_title' : 'flow_placement_scope');
    const applyPlacement = (field,value,restore=false) => {
        if (getActiveBlock()?.id!==group.id || getFlowAuthoringLanguage(group)!==languageKey || editorDragBlocked(false)) return;
        const effective = field => (scope.value==='page' ? titleRegion?.[field] || (field==='blockAlign'?pagePlacement.blockAlign:null) : undefined) || profile?.[field] || 'start';
        // Re-selecting the current value must not isolate/split a page or add history.
        if (field && !restore && !pagePlacement.conflict && effective(field)===value && !(scope.value==='page' && !titleRegion && !pagePlacement.anchors?.length)) return;
        if (scope.value==='page' && (!page || page.flowPageIndex!==getSelectedFlowRuntimePageIndex(group.id))) return;
        try {
            let result;
            if(titleRegion && (restore || scope.value==='page')) {
                if(!canAlignPage || (restore && !canChangeStructure)) return;
                result=updateFlowTitleRegion(state.blocks,group.id,titleRegion.id,{field,value,remove:restore});
            } else if(scope.value==='page' && !restore && field==='blockAlign') {
                if(!canAlignPage)return;
                result=setFlowPagePlacement(state.blocks,group.id,page.page,languageKey,value);
            } else if(scope.value==='page' && !restore) {
                if(!canChangeStructure) return;
                result=isolateFlowTitlePage(state.blocks,group.id,page.page,field ? {initialAlignment:{textAlign:effective('textAlign'),blockAlign:effective('blockAlign')}} : {});
            } else result={blocks:structuredClone(state.blocks),activeBlockIndex:state.activeBlockIdx};
            const target=result.blocks[result.activeBlockIndex];
            if(restore && !titleRegion) {
                delete target.flow.pageRole;
                Object.assign(target.flow.layout.typographyByLanguage[languageKey],{textAlign:'start',blockAlign:'start'});
            } else if(field && scope.value==='group' && !result.regionId) target.flow.layout.typographyByLanguage[languageKey][field]=value;
            if(result.regionId && field) result=updateFlowTitleRegion(result.blocks,group.id,result.regionId,{field,value});
            applyEditorSpineChange(result,{flowPageIndex:getSelectedFlowRuntimePageIndex(group.id)});
            syncFlowPageSourceControls();
        } catch(error) { console.warn('[Flow page placement]',error.code || error.name);
            alert(t(error.code==='translation'?'flow_title_translation_blocked':error.code==='wrap'?'flow_placement_wrap_blocked':['stale','source','FLOW_PLACEMENT_STALE'].includes(error.code)?'flow_title_stale':'flow_placement_invalid'));  }
    };
    const titleButton=document.getElementById('flow-make-title');
    titleButton.disabled=!canChangeStructure;
    titleButton.onclick=()=>{scope.value='page';applyPlacement();};
    const restoreButton=document.getElementById('flow-restore-body');
    restoreButton.hidden=!titleRegion && group.flow.pageRole!=='title';
    restoreButton.disabled=editorDragBlocked(false)||!profile||(!!titleRegion && !canChangeStructure);
    restoreButton.onclick=()=>applyPlacement(null,null,true);
    scope.onchange=()=>syncFlowPageSourceControls();
    for (const [id,field] of [['flow-placement-block','blockAlign']]) {
        const control = document.getElementById(id);
        control.value = (scope.value==='page' ? titleRegion?.[field] || pagePlacement.blockAlign : undefined) || profile?.[field] || 'start';
        control.disabled = !profile || editorDragBlocked(false) || (scope.value==='page' && !canAlignPage);
        control.onchange = () => {
            if (getActiveBlock()?.id !== group.id || editorDragBlocked(false)) return;
            applyPlacement(field,control.value);
        };
    }
    const placementStatus=document.getElementById('flow-placement-status');
    if(placementStatus)placementStatus.textContent=pagePlacement.conflict?t('flow_placement_conflict'):page?.page?.placementOffset?.blocked?t('flow_placement_blocked'):'';
    syncFlowParagraphAlignment(group,languageKey);
    const source = isFlowSourceSelected(group.id);
    const button = document.getElementById('flow-open-source');
    button.textContent = t(source ? 'flow_return_page' : 'flow_open_source');
    button.disabled = _flowAuthoringComposing || _flowImageInsertionBusy;
    button.onmousedown = event => event.preventDefault();
    button.onclick = () => {
        if (_flowAuthoringComposing || _flowImageInsertionBusy) return;
        if (source) {
            const input = document.activeElement?.matches?.('[data-flow-field="block-text"]') ? document.activeElement : null;
            const target = input ? getFlowAuthoringTarget(input) : null;
            const saved = target ? { ...target, languageKey: getFlowAuthoringLanguage(group),
                ...mapFlowTextUtf16OffsetToGrapheme(input.value, input.selectionEnd, getFlowAuthoringLanguage(group)) }
                : getFlowEditorSelection(group.id);
            const pages = getEditorPageProjection()?.pages.filter(page => page.kind === 'flow' && page.groupId === group.id) || [];
            const location = saved.blockId ? findFlowSourcePointInPages(pages.map(page => page.page), saved) : null;
            window.changeFlowGeneratedPage(state.activeBlockIdx, location?.pageIndex ?? getSelectedFlowRuntimePageIndex(group.id));
            return;
        }
        window.changeFlowSourceBlock(state.activeBlockIdx);
    };
    refreshFlowRibbon();
}

function scrollFlowSourceCaretIntoView(root, input, offset) {
    // Source textareas auto-size to the whole paragraph. Measure the actual caret
    // line so a long paragraph opens at the selected page, rather than its midpoint.
    const style = getComputedStyle(input);
    const mirror = document.createElement('div');
    for (const name of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing',
        'wordSpacing', 'textIndent', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
        'boxSizing', 'wordBreak', 'overflowWrap', 'tabSize', 'direction']) mirror.style[name] = style[name];
    Object.assign(mirror.style, { position: 'fixed', left: '-100000px', top: '0',
        width: input.getBoundingClientRect().width + 'px', whiteSpace: 'pre-wrap', visibility: 'hidden' });
    mirror.appendChild(document.createTextNode(input.value.slice(0, offset)));
    const caret = document.createElement('span');
    caret.textContent = input.value.slice(offset, offset + 1) || '\u200b';
    mirror.appendChild(caret);
    document.body.appendChild(mirror);
    const lineTop = caret.getBoundingClientRect().top - mirror.getBoundingClientRect().top;
    mirror.remove();
    const top = input.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
    root.scrollTop = Math.max(0, top + lineTop - root.clientHeight / 2);
}

function syncFlowDirectFormatControls() {
    refreshEditorLanguagePresentation();
    syncFlowPageSourceControls();
    const panel = document.getElementById('flow-direct-format-props');
    if (!panel) return;
    const session = _flowDirectEditSession;
    const active = !!session && _flowDirectEditProxy?.isConnected
        && getActiveBlock()?.id === session.groupId && isFlowDirectEditing(session.groupId);
    panel.hidden = !active;
    let annotationButton=panel.querySelector('[data-flow-annotation-button]');
    if(!annotationButton){annotationButton=document.createElement('button');annotationButton.type='button';annotationButton.dataset.flowAnnotationButton='';annotationButton.textContent='ルビ・圏点…';panel.append(annotationButton);}
    annotationButton.disabled=!active || !!_flowTextSelection || _flowAuthoringComposing || _flowDirectEditProxy?.dataset.flowReflowPending==='true';
    for (const button of document.querySelectorAll('[data-flow-insert-image]')) {
        button.hidden = !active;
        button.disabled = !active || isTranslatedFlowDirectSession() || !!_flowTextSelection || _flowImageInsertionBusy || _flowAuthoringComposing
            || _flowDirectEditApplying || _flowTranslationJob?.state === 'running'
            || _flowDirectEditProxy.selectionStart !== _flowDirectEditProxy.selectionEnd;
        button.onpointerdown = event => event.stopPropagation();
        button.ontouchstart = event => event.stopPropagation();
        button.onmousedown = event => { event.preventDefault(); event.stopPropagation(); };
        button.onclick = chooseFlowImageAtCaret;
    }
    syncFlowPageGuideControls(active);
    if (!active) { refreshFlowRibbon(); return; }
    const group = getFlowGroupById(session.groupId);
    const block = group?.flow?.document?.sections?.find(entry => entry.id === session.sectionId)
        ?.blocks?.find(entry => entry.id === session.blockId);
    const select = document.getElementById('flow-direct-block-format');
    const pending = _flowDirectEditProxy.dataset.flowReflowPending === 'true';
    const disabled = !!_flowTextSelection || _flowAuthoringComposing || pending;
    select.value = block?.type === 'heading' ? `heading-${block.level}` : 'paragraph';
    select.disabled = disabled || isTranslatedFlowDirectSession();
    select.onchange = handleFlowDirectFormatChange;
    const resume = document.getElementById('flow-direct-resume');
    resume.disabled = disabled;
    resume.onclick = () => _flowDirectEditProxy?.focus({ preventScroll: true });
    const pageBreak = document.getElementById('flow-direct-page-break');
    const hasRange = _flowDirectEditProxy.selectionStart !== _flowDirectEditProxy.selectionEnd;
    // Pagination may be pending: the transaction validates the current semantic source.
    pageBreak.disabled = _flowAuthoringComposing || _flowDirectEditApplying || hasRange || isTranslatedFlowDirectSession();
    pageBreak.onclick = () => insertFlowDirectPageBreak(_flowDirectEditProxy);
    document.getElementById('flow-direct-format-status').textContent = _flowAuthoringComposing
        ? t('flow_direct_format_composing') : pending ? t('flow_direct_format_pending')
            : hasRange ? t('flow_direct_page_break_selection') : isTranslatedFlowDirectSession() ? t('flow_direct_translation_hint') : '';
    refreshFlowRibbon();
}

function syncFlowPageGuideControls(active) {
    const select = document.getElementById('flow-direct-guide-mode');
    if (!select) return;
    select.value = _flowPageGuideMode;
    select.onchange = handleFlowPageGuideModeChange;
    _flowCanvasView?.setGuideMode(active ? _flowPageGuideMode : 'off');
}

function handleFlowPageGuideModeChange(event) {
    const session = _flowDirectEditSession;
    const active = !!session && _flowDirectEditProxy?.isConnected
        && getActiveBlock()?.id === session.groupId && isFlowDirectEditing(session.groupId);
    if (!active) {
        syncFlowPageGuideControls(false);
        return;
    }
    _flowPageGuideMode = normalizeFlowPageGuideMode(event.target.value);
    syncFlowPageGuideControls(true);
}

function applyFlowDirectIndent(indent) {
    const session=_flowDirectEditSession,proxy=_flowDirectEditProxy;
    if(!session || !proxy?.isConnected || _flowTextSelection || _flowAuthoringComposing || _flowDirectEditApplying
        || proxy.dataset.flowReflowPending==='true')return;
    const block=getFlowGroupById(session.groupId)?.flow.document.sections.find(s=>s.id===session.sectionId)?.blocks.find(b=>b.id===session.blockId);
    if(!block || block.texts?.[session.languageKey]!==session.expectedText)return;
    const editorFocus=captureFlowDirectEditFocusSnapshot();
    endHistoryGroup();_flowDirectEditApplying=true;proxy.dataset.flowReflowPending='true';
    try { applyFlowAuthoringEdit({type:'setIndent',groupId:session.groupId,sectionId:session.sectionId,
        blockId:session.blockId,languageKey:session.languageKey,expectedText:session.expectedText,
        expectedIndent:JSON.stringify(block.indentByLanguage?.[session.languageKey] || null),indent}, {immediate:true,editorFocus}); }
    finally {_flowDirectEditApplying=false;}
    setFlowDirectEditNote('この段落のインデントを変更しました。');
}

function handleFlowDirectFormatChange(event) {
    if (_flowTextSelection) { event.preventDefault(); return; }
    const proxy = _flowDirectEditProxy;
    const session = _flowDirectEditSession;
    if (!proxy?.isConnected || !session || getActiveBlock()?.id !== session.groupId
        || !isFlowDirectEditing(session.groupId)
        || getFlowAuthoringLanguage(getFlowGroupById(session.groupId)) !== session.languageKey
        || _flowAuthoringComposing || _flowDirectEditApplying
        || proxy.dataset.flowReflowPending === 'true') {
        syncFlowDirectFormatControls();
        return;
    }
    const value = String(event.target.value || '');
    const input = value === 'paragraph' ? { blockType: 'paragraph' }
        : { blockType: 'heading', level: Number(value.replace('heading-', '')) };
    let transaction;
    try {
        transaction = createFlowDirectBlockFormatTransaction(getFlowGroupById(session.groupId), session, input);
    } catch (error) {
        if (!(error instanceof FlowDirectEditError)) throw error;
        syncFlowDirectFormatControls();
        setFlowDirectEditNote(t('flow_direct_format_stale'));
        return;
    }
    if (!transaction) return;
    endHistoryGroup();
    _flowDirectEditApplying = true;
    try {
        applyFlowAuthoringEdit(transaction.operation, { immediate: true });
        _flowDirectEditSession = transaction.nextSession;
        rememberFlowDirectSelection();
        proxy.dataset.flowReflowPending = 'true';
        proxy._flowDirectPageElement?.classList.add('flow-direct-edit-reflow-pending');
    } finally {
        _flowDirectEditApplying = false;
        syncFlowDirectFormatControls();
    }
}

function setFlowDirectEditNote(message) {
    const pageLockNote = document.getElementById('page-lock-note');
    if (!pageLockNote) return;
    pageLockNote.textContent = message;
    pageLockNote.style.display = 'block';
}

function toFlowPageLocalRect(pageElement, rect) {
    const pageRect = pageElement?.getBoundingClientRect?.();
    if (!pageRect || pageRect.width <= 0 || pageRect.height <= 0 || !rect) return null;
    const scaleX = (pageElement.offsetWidth || pageRect.width) / pageRect.width;
    const scaleY = (pageElement.offsetHeight || pageRect.height) / pageRect.height;
    return {
        left: (rect.left - pageRect.left) * scaleX,
        top: (rect.top - pageRect.top) * scaleY,
        width: rect.width * scaleX,
        height: rect.height * scaleY,
    };
}

function createFlowDirectSourcePoint(session, text, utf16Offset, affinity = 'nearest') {
    const mapped = mapFlowTextUtf16OffsetToGrapheme(text, utf16Offset, session.languageKey, affinity);
    return Object.freeze({
        sectionId: session.sectionId,
        blockId: session.blockId,
        blockType: session.blockType,
        languageKey: session.languageKey,
        graphemeOffset: mapped.graphemeOffset,
        utf16Offset: mapped.utf16Offset,
        affinity,
    });
}

function renderFlowCaretIndicator(pageElement, page, sourcePoint, writingMode) {
    const caretRect = getFlowSourcePointClientRect(pageElement, page.page, sourcePoint, { writingMode });
    const localCaret = toFlowPageLocalRect(pageElement, caretRect);
    if (!localCaret || !caretRect) return null;
    const horizontalCaret = caretRect.caretOrientation === 'horizontal';
    const caret = document.createElement('span');
    caret.className = 'flow-direct-caret';
    caret.dataset.testid = 'flow-direct-caret';
    caret.dataset.flowDirectIndicator = 'caret';
    caret.dataset.flowCaretOrientation = caretRect.caretOrientation;
    caret.dataset.flowCaretBasis = caretRect.basis;
    caret.dataset.flowWritingMode = writingMode;
    caret.dataset.flowSectionId = sourcePoint.sectionId;
    caret.dataset.flowBlockId = sourcePoint.blockId;
    caret.dataset.flowSourceUtf16Offset = String(sourcePoint.utf16Offset);
    caret.dataset.flowSourceGraphemeOffset = String(sourcePoint.graphemeOffset);
    Object.assign(caret.style, horizontalCaret ? {
        left: `${localCaret.left}px`,
        top: `${localCaret.top}px`,
        width: `${Math.max(12, localCaret.width)}px`,
        height: '2px',
    } : {
        left: `${localCaret.left}px`,
        top: `${localCaret.top}px`,
        width: '2px',
        height: `${Math.max(12, localCaret.height)}px`,
    });
    pageElement.appendChild(caret);
    return Object.freeze({ caret, caretRect, localCaret });
}

function renderFlowDirectEditIndicators(proxy = _flowDirectEditProxy) {
    const session = _flowDirectEditSession;
    const pageElement = proxy?._flowDirectPageElement;
    const page = proxy?._flowDirectPageEntry;
    if (!proxy || proxy !== _flowDirectEditProxy || !session || !pageElement || !page) return;
    const mountedPages = getMountedActiveFlowPages();
    mountedPages.forEach(entry => entry.pageElement.querySelectorAll('[data-flow-direct-indicator]')
        .forEach(element => element.remove()));
    const isComposing = _flowAuthoringComposing && proxy.dataset.composing === 'true';
    if (!isComposing && String(proxy.value || '') !== session.expectedText) return;

    const text = session.expectedText;
    const composedOffset = Math.max(0, Math.min(Number(_flowDirectCompositionRange?.start
        ?? session.sourcePoint?.utf16Offset) || 0, text.length));
    const start = isComposing
        ? composedOffset
        : Math.max(0, Math.min(Number(proxy.selectionStart) || 0, text.length));
    const end = isComposing
        ? composedOffset
        : Math.max(start, Math.min(Number(proxy.selectionEnd) || start, text.length));
    const direction = !isComposing && proxy.selectionDirection === 'backward' ? 'backward' : 'none';
    const collapsedAffinity = start === end
        ? String(session.sourcePoint?.affinity || 'forward')
        : null;
    const startPoint = createFlowDirectSourcePoint(
        session,
        text,
        start,
        collapsedAffinity || 'forward',
    );
    const endPoint = createFlowDirectSourcePoint(
        session,
        text,
        end,
        collapsedAffinity || 'backward',
    );
    const focusPoint = start === end
        ? endPoint
        : createFlowDirectSourcePoint(
            session,
            text,
            direction === 'backward' ? start : end,
            session.sourcePoint?.affinity || (direction === 'backward' ? 'backward' : 'forward'),
        );

    if (_flowTextSelection) {
        const selected = validateFlowTextSelection(getFlowGroupById(session.groupId), _flowTextSelection);
        if (!selected) { _flowTextSelection = null; proxy.readOnly = false; }
        else for (const range of selected.ranges) {
            mountedPages.forEach(({ pageElement: surface, page: entry }) => {
                const fragments = entry.page.fragments.filter(f => f.blockId === range.blockId && f.sectionId === range.sectionId);
                if (!fragments.length) return;
                const from = Math.max(range.start, fragments[0].sourceRange.start);
                const to = Math.min(range.end, fragments.at(-1).sourceRange.end);
                if (from >= to) return;
                const a = createFlowDirectSourcePoint(range, range.text, from, 'forward');
                const b = createFlowDirectSourcePoint(range, range.text, to, 'backward');
                for (const rect of getFlowSourceRangeClientRects(surface, entry.page, a, b)) {
                    const local = toFlowPageLocalRect(surface, rect);
                    if (!local) continue;
                    const highlight = document.createElement('span');
                    highlight.className = 'flow-direct-selection';
                    highlight.dataset.flowDirectIndicator = 'selection';
                    Object.assign(highlight.style, { left: local.left+'px', top: local.top+'px', width: local.width+'px', height: local.height+'px' });
                    surface.appendChild(highlight);
                }
            });
        }
    }
    if (!_flowTextSelection && start < end) {
        mountedPages.forEach(({ pageElement: surface, page: entry }) => {
        const fragments = entry.page.fragments.filter(fragment => fragment.blockId === session.blockId
            && fragment.sectionId === session.sectionId);
        if (!fragments.length) return;
        const clippedStart = Math.max(startPoint.utf16Offset, fragments[0].sourceRange.start);
        const clippedEnd = Math.min(endPoint.utf16Offset, fragments.at(-1).sourceRange.end);
        if (clippedStart >= clippedEnd) return;
        const pageStart = createFlowDirectSourcePoint(session, text, clippedStart, 'forward');
        const pageEnd = createFlowDirectSourcePoint(session, text, clippedEnd, 'backward');
        getFlowSourceRangeClientRects(surface, entry.page, pageStart, pageEnd).forEach((rect) => {
            const local = toFlowPageLocalRect(surface, rect);
            if (!local) return;
            const highlight = document.createElement('span');
            highlight.className = 'flow-direct-selection';
            highlight.dataset.flowDirectIndicator = 'selection';
            Object.assign(highlight.style, {
                left: `${local.left}px`,
                top: `${local.top}px`,
                width: `${local.width}px`,
                height: `${local.height}px`,
            });
            surface.appendChild(highlight);
        });
        });
    }

    const focusLocation = findFlowSourcePointInPages(mountedPages.map(entry => entry.page), focusPoint);
    const focusEntry = mountedPages[focusLocation?.pageIndex] || { pageElement, page };
    const renderedCaret = renderFlowCaretIndicator(
        focusEntry.pageElement,
        focusEntry.page,
        focusPoint,
        session.writingMode,
    );
    if (!renderedCaret) { hideFlowIndentRuler(); return; }
    const indentGroup=getFlowGroupById(session.groupId);
    const indentBlock=indentGroup?.flow.document.sections.find(s=>s.id===session.sectionId)?.blocks.find(b=>b.id===session.blockId);
    const indentFragment=[...focusEntry.pageElement.querySelectorAll('.flow-dom-block')].find(e=>e.dataset.flowBlockId===session.blockId && e.dataset.flowSectionId===session.sectionId);
    if (indentBlock && indentFragment) showFlowIndentRuler({pageElement:focusEntry.pageElement,fragment:indentFragment,
        block:indentBlock,language:session.languageKey,writingMode:session.writingMode,caret:renderedCaret.caretRect,
        disabled:!!_flowTextSelection || _flowAuthoringComposing || proxy.dataset.flowReflowPending==='true',
        onCommit:applyFlowDirectIndent});

    // The input/IME anchor belongs to the replacement start, while the visible
    // focus caret may be on another page. Keep the native input stable before IME starts.
    const inputRect = start < end
        ? getFlowSourcePointClientRect(pageElement, page.page, startPoint, { writingMode: session.writingMode })
        : renderedCaret.caretRect;
    const caretRect = inputRect || renderedCaret.caretRect;
    const localCaret = toFlowPageLocalRect(pageElement, caretRect);
    const verticalWriting = session.writingMode === 'vertical-rl';
    const sourceFragment = [...pageElement.querySelectorAll('.flow-dom-block')].find((element) => (
        element.dataset.flowSectionId === session.sectionId
        && element.dataset.flowBlockId === session.blockId
    ));
    const sourceStyle = sourceFragment ? getComputedStyle(sourceFragment) : null;
    // The caret describes the font's glyph bounds, not the CSS line box.
    // Match the native input line box to that glyph's center for the OS IME anchor.
    const fontSize = parseFloat(sourceStyle?.fontSize) || page.typography?.fontSize || 16;
    const lineHeight = parseFloat(sourceStyle?.lineHeight)
        || fontSize * (page.typography?.lineHeight || 1.8);
    proxy.dataset.flowWritingMode = session.writingMode;
    Object.assign(proxy.style, verticalWriting ? {
        left: `${localCaret.left + (localCaret.width - lineHeight) / 2}px`,
        top: `${localCaret.top}px`,
        width: `${lineHeight}px`,
        minWidth: `${lineHeight}px`,
        maxWidth: 'none',
        height: '2px',
        minHeight: '2px',
        maxHeight: '2px',
        writingMode: 'vertical-rl',
        textOrientation: 'mixed',
        direction: 'ltr',
    } : {
        left: `${localCaret.left}px`,
        top: `${localCaret.top + (localCaret.height - lineHeight) / 2}px`,
        width: '2px',
        minWidth: '2px',
        maxWidth: '2px',
        height: `${lineHeight}px`,
        minHeight: '0',
        maxHeight: 'none',
        writingMode: 'horizontal-tb',
        textOrientation: 'mixed',
        direction: 'ltr',
    });
    Object.assign(proxy.style, {
        fontFamily: sourceStyle?.fontFamily || page.typography?.fontFamily || 'inherit',
        fontSize: sourceStyle?.fontSize || `${page.typography?.fontSize || 16}px`,
        fontWeight: sourceStyle?.fontWeight || page.typography?.fontWeight || '400',
        lineHeight: sourceStyle?.lineHeight || String(page.typography?.lineHeight || 1.8),
        letterSpacing: sourceStyle?.letterSpacing || `${page.typography?.letterSpacing || 0}px`,
        fontFeatureSettings: sourceStyle?.fontFeatureSettings || 'normal',
    });

    if (_flowDirectCompositionText) {
        const composition = document.createElement('span');
        composition.className = 'flow-direct-composition';
        composition.dataset.flowDirectIndicator = 'composition';
        composition.lang = session.languageKey;
        composition.textContent = _flowDirectCompositionText;
        composition.dataset.flowWritingMode = session.writingMode;
        Object.assign(composition.style, verticalWriting ? {
            left: `${localCaret.left}px`,
            top: `${localCaret.top}px`,
            minWidth: `${Math.max(16, localCaret.width)}px`,
            minHeight: '16px',
            writingMode: 'vertical-rl',
            textOrientation: 'mixed',
            direction: 'ltr',
        } : {
            left: `${localCaret.left}px`,
            top: `${localCaret.top}px`,
            minHeight: `${Math.max(16, localCaret.height)}px`,
            writingMode: 'horizontal-tb',
            textOrientation: 'mixed',
            direction: 'ltr',
        });
        Object.assign(composition.style, {
            fontFamily: sourceStyle?.fontFamily || page.typography?.fontFamily || 'inherit',
            fontSize: sourceStyle?.fontSize || `${page.typography?.fontSize || 16}px`,
            fontWeight: sourceStyle?.fontWeight || page.typography?.fontWeight || '400',
            lineHeight: sourceStyle?.lineHeight || String(page.typography?.lineHeight || 1.8),
            letterSpacing: sourceStyle?.letterSpacing || `${page.typography?.letterSpacing || 0}px`,
            color: sourceStyle?.color || page.typography?.textColor || 'inherit',
            fontFeatureSettings: sourceStyle?.fontFeatureSettings || 'normal',
        });
        pageElement.appendChild(composition);
        alignFlowDirectCompositionElement({
            pageElement, compositionElement: composition, caretRect,
            writingMode: session.writingMode, languageKey: session.languageKey,
        });
    }
}

function updateFlowDirectSelectionFromProxy(proxy, options = {}) {
    if (_flowTextSelection) return;
    if (
        proxy !== _flowDirectEditProxy
        || !_flowDirectEditSession
        // Explicit page navigation wins over a proxy retained until the next render.
        || !isFlowDirectEditing(_flowDirectEditSession.groupId)
        || _flowDirectEditMounting
        || _flowDirectEditApplying
        || _flowAuthoringComposing
        || (proxy.dataset.flowReflowPending === 'true' && !options.allowPending)
        || String(proxy.value || '') !== _flowDirectEditSession.expectedText
    ) return;
    const text = _flowDirectEditSession.expectedText;
    const selectionStart = Math.max(0, Math.min(Number(proxy.selectionStart) || 0, text.length));
    const selectionEnd = Math.max(selectionStart, Math.min(Number(proxy.selectionEnd) || selectionStart, text.length));
    const selectionDirection = proxy.selectionDirection === 'backward' ? 'backward' : 'none';
    const focusOffset = selectionDirection === 'backward' ? selectionStart : selectionEnd;
    const focusPoint = createFlowDirectSourcePoint(
        _flowDirectEditSession,
        text,
        focusOffset,
        focusOffset === _flowDirectEditSession.sourcePoint.utf16Offset
            ? _flowDirectEditSession.sourcePoint.affinity
            : selectionDirection === 'backward' ? 'backward' : 'forward',
    );
    _flowDirectEditSession = Object.freeze({
        ..._flowDirectEditSession,
        selectionStart,
        selectionEnd,
        selectionDirection,
        sourcePoint: focusPoint,
    });
    rememberFlowDirectSelection();
    renderFlowDirectEditIndicators(proxy);
    syncFlowDirectFormatControls();

    if (options.navigate === false || _flowAuthoringComposing) return;
    const activeBlock = getActiveBlock();
    const projection = getEditorPageProjection();
    if (activeBlock?.id !== _flowDirectEditSession.groupId || !projection) return;
    const groupPages = projection.pages.filter((page) => (
        page.kind === 'flow' && page.groupId === activeBlock.id
    ));
    let location;
    try {
        location = findFlowSourcePointInPages(groupPages, focusPoint);
    } catch (_) {
        return;
    }
    if (!location) return;
    setSelectedFlowRuntimePageIndex(activeBlock.id, location.pageIndex, groupPages.length);
    moveFlowDirectProxyToPage(location.pageIndex);
    syncThumbSelectionDom();
}

function recoverFlowDirectEditProxy(proxy, message) {
    if (proxy !== _flowDirectEditProxy || !_flowDirectEditSession) return;
    _flowDirectEditMounting = true;
    proxy.value = _flowDirectEditSession.expectedText;
    const offset = Math.min(_flowDirectEditSession.sourcePoint.utf16Offset, proxy.value.length);
    proxy.setSelectionRange(offset, offset, 'none');
    delete proxy.dataset.flowReflowPending;
    _flowDirectEditMounting = false;
    setFlowDirectEditNote(message);
    renderFlowDirectEditIndicators(proxy);
}

function commitFlowDirectEdit(proxy) {
    if (_flowTextSelection) return;
    _flowDirectPreferredInlinePosition = null;
    if (proxy !== _flowDirectEditProxy || !_flowDirectEditSession || _flowDirectEditApplying) return;
    const group = getFlowGroupById(_flowDirectEditSession.groupId);
    if (!group) return;
    let transaction;
    try {
        transaction = createFlowDirectEditTransaction(group, _flowDirectEditSession, {
            text: String(proxy.value || ''),
            selectionStart: proxy.selectionStart,
            selectionEnd: proxy.selectionEnd,
            selectionDirection: proxy.selectionDirection,
        });
    } catch (error) {
        if (error instanceof FlowDirectEditError) {
            const message = error.code === 'FLOW_DIRECT_LINE_BREAK_STRUCTURE_UNSUPPORTED'
                ? '改行の追加・削除は次の実装単位で対応します。通常の文字編集は続けられます。'
                : 'この操作はまだ直接編集できません。Flow原稿画面で編集してください。';
            recoverFlowDirectEditProxy(proxy, message);
            return;
        }
        throw error;
    }

    const changed = transaction.operation.text !== _flowDirectEditSession.expectedText;
    _flowDirectEditSession = transaction.nextSession;
    rememberFlowDirectSelection();
    if (!changed) {
        if (proxy.dataset.flowReflowPending !== 'true') renderFlowDirectEditIndicators(proxy);
        return;
    }

    _flowDirectEditApplying = true;
    proxy.dataset.flowReflowPending = 'true';
    proxy._flowDirectPageElement?.classList.add('flow-direct-edit-reflow-pending');
    try {
        applyFlowAuthoringEdit(transaction.operation, {
            historyKey: `flow:${transaction.operation.groupId}:${transaction.operation.sectionId}:${transaction.operation.blockId}:${transaction.operation.languageKey}`,
            immediate: true,
        });
    } finally {
        _flowDirectEditApplying = false;
        syncFlowDirectFormatControls();
    }
}


function chooseFlowImageAtCaret() {
    if (_flowTextSelection) return;
    const proxy = _flowDirectEditProxy;
    const session = _flowDirectEditSession;
    if (!proxy?.isConnected || !session || _flowImageInsertionBusy || _flowAuthoringComposing
        || _flowDirectEditApplying || _flowTranslationJob?.state === 'running'
        || getActiveBlock()?.id !== session.groupId || !isFlowDirectEditing(session.groupId)) return;
    const imageBlock = createPageBlockFromSection({ type: 'image' });
    const options = { selectionStart: proxy.selectionStart, selectionEnd: proxy.selectionEnd,
        expectedText: proxy.value, imageBlock };
    let plan;
    try {
        plan = createFlowImageInsertion(state.blocks, session, options);
    } catch {
        setFlowDirectEditNote(t('flow_image_invalid_position'));
        return;
    }
    const original = { blocks: JSON.stringify(state.blocks), projectId: state.projectId,
        workId: state.workId, uid: state.uid, language: state.activeLang };
    const editorFocus = captureFlowDirectEditFocusSnapshot();
    const current = () => original.projectId === state.projectId && original.workId === state.workId
        && original.uid === state.uid && original.language === state.activeLang
        && original.blocks === JSON.stringify(state.blocks) && getActiveBlock()?.id === session.groupId
        && _flowTranslationJob?.state !== 'running';
    const picker = document.getElementById('flow-image-file');
    picker.value = '';
    _flowImageInsertionBusy = true;
    syncFlowDirectFormatControls();
    const finish = () => {
        _flowImageInsertionBusy = false;
        picker.onchange = null;
        picker.oncancel = null;
        picker.value = '';
        syncFlowDirectFormatControls();
    };
    picker.oncancel = finish;
    picker.onchange = async () => {
        const file = picker.files?.[0];
        if (!file) { finish(); return; }
        let prepared, committed = false;
        try {
            if (!current()) throw new Error('stale');
            setFlowDirectEditNote(t('flow_image_preparing'));
            prepared = await prepareAuthoringImage(file, { uid: original.uid });
            const { mainUrl, thumbUrl } = prepared;
            // File selection/upload can outlive edits, project switches or sign-out.
            if (!current()) throw new Error('stale');
            const inserted = plan.blocks[plan.activeBlockIndex];
            inserted.content.background = mainUrl;
            inserted.content.backgrounds = { [session.languageKey]: mainUrl };
            inserted.content.thumbnail = thumbUrl;
            const assets = appendPreparedProjectAsset(state.projectAssets, prepared, file.name, createId('asset'));
            endHistoryGroup();
            pushState({ editorFocus });
            state.projectAssets = assets;
            state.version = 6;
            committed = true;
            clearFlowDirectEditRuntime();
            dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'blocks', value: plan.blocks } });
            dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'sections', value: extractSectionsFromBlocks(plan.blocks) } });
            dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'pages', value: blocksToPages(plan.blocks) } });
            dispatch({ type: actionTypes.SET_ACTIVE_BLOCK_INDEX, payload: plan.activeBlockIndex });
            dispatch({ type: actionTypes.SET_ACTIVE_INDEX, payload: getPageIndexFromBlockIndex(plan.blocks, plan.activeBlockIndex) });
            dispatch({ type: actionTypes.SET_ACTIVE_BUBBLE_INDEX, payload: null });
            _flowAuthoringSourceRevision += 1;
            refresh();
            updateHistoryButtons();
            triggerAutoSave();
        } catch {
            // Neither storage errors nor internal source payloads reach the UI.
            setFlowDirectEditNote(t('flow_image_failed'));
            alert(t('flow_image_failed'));
        } finally {
            if (prepared && !committed) await discardPreparedAuthoringImage(prepared);
            finish();
        }
    };
    picker.click();
}

function insertFlowDirectPageBreak(proxy) {
    if (isTranslatedFlowDirectSession()) { setFlowDirectEditNote(t('flow_direct_translation_hint')); return false; }
    if (_flowTextSelection) return;
    const session = _flowDirectEditSession;
    if (proxy !== _flowDirectEditProxy || !proxy?.isConnected || !session
        || getActiveBlock()?.id !== session.groupId || !isFlowDirectEditing(session.groupId)
        || _flowDirectEditApplying) return false;
    if (_flowAuthoringComposing) {
        setFlowDirectEditNote(t('flow_direct_format_composing'));
        return false;
    }
    const group = getFlowGroupById(session.groupId);
    if (getFlowAuthoringLanguage(group) !== session.languageKey || proxy.value !== session.expectedText) {
        setFlowDirectEditNote(t('flow_direct_page_break_stale'));
        return false;
    }
    let transaction;
    try {
        transaction = createFlowDirectPageBreakTransaction(group, session, {
            selectionStart: proxy.selectionStart,
            selectionEnd: proxy.selectionEnd,
            newBlockId: createId('flow_text'),
            pageBreakId: createId('flow_break'),
        });
    } catch (error) {
        if (!(error instanceof FlowDirectEditError)) throw error;
        setFlowDirectEditNote(t(error.code === 'FLOW_DIRECT_COLLAPSED_CARET_REQUIRED'
            ? 'flow_direct_page_break_selection' : 'flow_direct_page_break_stale'));
        return false;
    }

    const editorFocus = captureFlowDirectEditFocusSnapshot();
    endHistoryGroup();
    _flowDirectEditApplying = true;
    try {
        // Apply all three blocks atomically before moving the input to the new tail.
        applyFlowAuthoringEdit(transaction.operation, { immediate: true, editorFocus });
        _flowDirectPreferredInlinePosition = null;
        _flowDirectEditSession = transaction.nextSession;
        rememberFlowDirectSelection();
        _flowDirectEditMounting = true;
        try {
            proxy.value = transaction.nextSession.expectedText;
            proxy.dataset.flowBlockId = transaction.nextSession.blockId;
            proxy.setSelectionRange(0, 0, 'none');
            proxy.focus({ preventScroll: true });
        } finally {
            _flowDirectEditMounting = false;
        }
        proxy.dataset.flowReflowPending = 'true';
        proxy._flowDirectPageElement?.classList.add('flow-direct-edit-reflow-pending');
    } finally {
        _flowDirectEditApplying = false;
        syncFlowDirectFormatControls();
    }
    setFlowDirectEditNote(t('flow_direct_page_break_inserted'));
    return true;
}

function splitFlowDirectParagraph(proxy) {
    if (proxy !== _flowDirectEditProxy || !_flowDirectEditSession || _flowDirectEditApplying) return false;
    const group = getFlowGroupById(_flowDirectEditSession.groupId);
    if (!group) return false;
    let transaction;
    try {
        transaction = createFlowDirectParagraphSplitTransaction(group, _flowDirectEditSession, {
            selectionStart: proxy.selectionStart,
            selectionEnd: proxy.selectionEnd,
            newBlockId: createId('flow_paragraph'),
        });
    } catch (error) {
        if (!(error instanceof FlowDirectEditError)) throw error;
        if (error.code === 'FLOW_DIRECT_MERGE_TITLE_BOUNDARY') {
            setFlowDirectEditNote('扉と本文、または別の扉区間の境界です。扉設定を解除してから結合してください。');
        } else if (error.code === 'FLOW_DIRECT_MERGE_METADATA_CONFLICT') {
            setFlowDirectEditNote('段落の設定が異なるため、設定を保持したまま結合できません。');
        } else if (error.code === 'FLOW_DIRECT_PARAGRAPH_REQUIRED') {
            setFlowDirectEditNote('見出しの分割は未対応です。現在はFlow原稿画面で段落を追加してください。');
        } else if (error.code === 'FLOW_DIRECT_COLLAPSED_CARET_REQUIRED') {
            setFlowDirectEditNote('選択範囲を含む段落分割は未対応です。選択を解除してEnterを押してください。');
        } else if (error.code === 'FLOW_DIRECT_GRAPHEME_BOUNDARY_REQUIRED') {
            setFlowDirectEditNote('文字の途中では段落を分割できません。caretを文字の境界へ移動してください。');
        } else {
            recoverFlowDirectEditProxy(proxy, '段落を安全に分割できませんでした。Flow原稿画面で編集してください。');
        }
        return false;
    }

    endHistoryGroup();
    _flowDirectEditSession = transaction.nextSession;
    selectFlowDirectEditing(transaction.operation.groupId, transaction.selection.focusPoint);
    _flowDirectEditMounting = true;
    proxy.value = transaction.nextSession.expectedText;
    proxy.dataset.flowBlockId = transaction.nextSession.blockId;
    proxy.setSelectionRange(0, 0, 'none');
    _flowDirectEditMounting = false;
    _flowDirectEditApplying = true;
    proxy.dataset.flowReflowPending = 'true';
    proxy._flowDirectPageElement?.classList.add('flow-direct-edit-reflow-pending');
    try {
        applyFlowAuthoringEdit(transaction.operation, { immediate: true });
    } finally {
        _flowDirectEditApplying = false;
    }
    setFlowDirectEditNote('段落を分割しました。後続ページを再配置しています。');
    return true;
}

function insertFlowDirectParagraphAfterHeading(proxy) {
    if (proxy !== _flowDirectEditProxy || !_flowDirectEditSession || _flowDirectEditApplying) return false;
    const group = getFlowGroupById(_flowDirectEditSession.groupId);
    if (!group) return false;
    let transaction;
    try {
        transaction = createFlowDirectHeadingParagraphTransaction(group, _flowDirectEditSession, {
            selectionStart: proxy.selectionStart,
            selectionEnd: proxy.selectionEnd,
            newBlockId: createId('flow_paragraph'),
        });
    } catch (error) {
        if (!(error instanceof FlowDirectEditError)) throw error;
        if (error.code === 'FLOW_DIRECT_HEADING_REQUIRED') {
            setFlowDirectEditNote('この位置では見出し後の本文段落を追加できません。');
        } else if (error.code === 'FLOW_DIRECT_COLLAPSED_CARET_REQUIRED') {
            setFlowDirectEditNote('選択範囲を含む見出し後の段落追加は未対応です。選択を解除してください。');
        } else if (error.code === 'FLOW_DIRECT_HEADING_END_REQUIRED') {
            setFlowDirectEditNote('見出しの末尾でのみ、Enterで本文段落を追加できます。');
        } else {
            recoverFlowDirectEditProxy(proxy, '見出しの後ろへ本文段落を安全に追加できませんでした。Flow原稿画面で編集してください。');
        }
        return false;
    }

    endHistoryGroup();
    _flowDirectEditSession = transaction.nextSession;
    selectFlowDirectEditing(transaction.operation.groupId, transaction.selection.focusPoint);
    _flowDirectEditMounting = true;
    proxy.value = transaction.nextSession.expectedText;
    proxy.dataset.flowBlockId = transaction.nextSession.blockId;
    proxy.setSelectionRange(0, 0, 'none');
    _flowDirectEditMounting = false;
    _flowDirectEditApplying = true;
    proxy.dataset.flowReflowPending = 'true';
    proxy._flowDirectPageElement?.classList.add('flow-direct-edit-reflow-pending');
    try {
        applyFlowAuthoringEdit(transaction.operation, { immediate: true });
    } finally {
        _flowDirectEditApplying = false;
    }
    setFlowDirectEditNote('見出しの後ろに本文段落を追加しました。後続ページを再配置しています。');
    return true;
}

function isTranslatedFlowDirectSession() {
    return !!_flowDirectEditSession && _flowDirectEditSession.languageKey !== getFlowGroupById(_flowDirectEditSession.groupId)?.flow.document.sourceLanguage;
}

function applyFlowDirectEnter(proxy) {
    if (isTranslatedFlowDirectSession()) return insertFlowDirectLineBreak(proxy);
    _flowDirectPreferredInlinePosition = null;
    if (proxy.selectionStart !== proxy.selectionEnd
        || (_flowDirectEditSession?.blockType === 'heading' && proxy.selectionStart !== proxy.value.length)) {
        return splitFlowDirectTextSelection(proxy);
    }
    if (_flowDirectEditSession?.blockType === 'heading') {
        return insertFlowDirectParagraphAfterHeading(proxy);
    }
    return splitFlowDirectParagraph(proxy);
}

function splitFlowDirectTextSelection(proxy) {
    const session = _flowDirectEditSession;
    if (proxy !== _flowDirectEditProxy || !proxy?.isConnected || !session || _flowDirectEditApplying || _flowAuthoringComposing) return false;
    const group = getFlowGroupById(session.groupId);
    if (!group || proxy.value !== session.expectedText) return false;
    const editorFocus = captureFlowDirectEditFocusSnapshot();
    try {
        const transaction = createFlowDirectTextSplitTransaction(group, session, {
            selectionStart: proxy.selectionStart, selectionEnd: proxy.selectionEnd, newBlockId: createId('flow_text'),
        });
        endHistoryGroup();
        _flowDirectEditApplying = true;
        applyFlowAuthoringEdit(transaction.operation, { immediate: true, editorFocus });
        _flowDirectEditSession = transaction.nextSession;
        rememberFlowDirectSelection();
        _flowDirectEditMounting = true;
        proxy.value = transaction.nextSession.expectedText;
        proxy.dataset.flowBlockId = transaction.nextSession.blockId;
        proxy.setSelectionRange(0, 0, 'none');
        proxy.dataset.flowReflowPending = 'true';
        proxy._flowDirectPageElement?.classList.add('flow-direct-edit-reflow-pending');
        setFlowDirectEditNote(t('flow_direct_text_split_done'));
        return true;
    } catch {
        setFlowDirectEditNote(t('flow_direct_text_split_blocked'));
        return false;
    } finally { _flowDirectEditApplying = false; _flowDirectEditMounting = false; }
}

function removeFlowDirectEmptyParagraphAfterHeading(proxy) {
    if (proxy !== _flowDirectEditProxy || !_flowDirectEditSession || _flowDirectEditApplying) return false;
    const group = getFlowGroupById(_flowDirectEditSession.groupId);
    if (!group) return false;
    let transaction;
    try {
        transaction = createFlowDirectEmptyParagraphAfterHeadingRemovalTransaction(group, _flowDirectEditSession, {
            selectionStart: proxy.selectionStart,
            selectionEnd: proxy.selectionEnd,
        });
    } catch (error) {
        if (!(error instanceof FlowDirectEditError)) throw error;
        if (error.code === 'FLOW_DIRECT_EMPTY_PARAGRAPH_REQUIRED') {
            setFlowDirectEditNote('見出し直後の段落に本文があるため、Backspaceでは削除しません。');
        } else if (error.code === 'FLOW_DIRECT_EMPTY_PARAGRAPH_DATA_PRESENT') {
            setFlowDirectEditNote('この空段落には翻訳または追加情報があるため、データ保護のため削除しませんでした。');
        } else if (error.code === 'FLOW_DIRECT_COLLAPSED_CARET_REQUIRED') {
            setFlowDirectEditNote('選択範囲を含む空段落削除は未対応です。選択を解除してください。');
        } else if (error.code === 'FLOW_DIRECT_PARAGRAPH_START_REQUIRED') {
            setFlowDirectEditNote('空段落の先頭でのみ、Backspaceで見出し末尾へ戻れます。');
        } else {
            recoverFlowDirectEditProxy(proxy, '空段落を安全に削除できませんでした。Flow原稿画面で編集してください。');
        }
        return false;
    }

    endHistoryGroup();
    _flowDirectEditSession = transaction.nextSession;
    selectFlowDirectEditing(transaction.operation.groupId, transaction.selection.focusPoint);
    _flowDirectEditMounting = true;
    proxy.value = transaction.nextSession.expectedText;
    proxy.dataset.flowBlockId = transaction.nextSession.blockId;
    proxy.setSelectionRange(
        transaction.nextSession.selectionStart,
        transaction.nextSession.selectionEnd,
        transaction.nextSession.selectionDirection,
    );
    _flowDirectEditMounting = false;
    _flowDirectEditApplying = true;
    proxy.dataset.flowReflowPending = 'true';
    proxy._flowDirectPageElement?.classList.add('flow-direct-edit-reflow-pending');
    try {
        applyFlowAuthoringEdit(transaction.operation, { immediate: true });
    } finally {
        _flowDirectEditApplying = false;
    }
    setFlowDirectEditNote('空段落を削除し、見出し末尾へ戻りました。後続ページを再配置しています。');
    return true;
}

function isFlowDirectParagraphImmediatelyAfterHeading(group, session) {
    if (session?.blockType !== 'paragraph') return false;
    const section = group?.flow?.document?.sections?.find((entry) => entry?.id === session.sectionId);
    const blockIndex = section?.blocks?.findIndex((entry) => entry?.id === session.blockId) ?? -1;
    return blockIndex > 0 && section.blocks[blockIndex - 1]?.type === 'heading';
}

function removeFlowEmptyLine(proxy, direction) {
    const session = _flowDirectEditSession;
    if (!session || _flowDirectEditApplying || _flowAuthoringComposing || proxy.selectionStart !== proxy.selectionEnd) return false;
    const group = getFlowGroupById(session.groupId);
    const section = group?.flow.document.sections.find(s=>s.id===session.sectionId);
    const index = section?.blocks.findIndex(b=>b.id===session.blockId);
    const current = section?.blocks[index];
    if (!current || proxy.value !== session.expectedText) return false;
    const neighbor = section.blocks[index+direction];
    let removed, survivor;
    if (proxy.value === '') {
        // At the start/end of a title region, use its other adjacent text block.
        survivor = [neighbor, section.blocks[index-direction]].find(candidate =>
            canRemoveEmptyFlowTextBlock(current,candidate));
        if (survivor) removed=current;
    }
    if (!removed && canRemoveEmptyFlowTextBlock(neighbor,current)) { removed=neighbor; survivor=current; }
    if (!removed) return false;
    const text = survivor.texts[session.languageKey] || '';
    const offset = survivor===current ? proxy.selectionStart : section.blocks.indexOf(survivor)<index ? text.length : 0;
    const point = {sectionId:section.id,blockId:survivor.id,blockType:survivor.type,languageKey:session.languageKey,
        utf16Offset:offset,graphemeOffset:mapFlowTextUtf16OffsetToGrapheme(text,offset,session.languageKey).graphemeOffset,affinity:'forward'};
    const editorFocus = captureFlowDirectEditFocusSnapshot();
    endHistoryGroup();
    _flowDirectEditSession = Object.freeze({...session,blockId:survivor.id,blockType:survivor.type,expectedText:text,
        selectionStart:offset,selectionEnd:offset,selectionDirection:'none',sourcePoint:point});
    selectFlowDirectEditing(group.id,point);
    _flowDirectEditMounting=true;
    proxy.value=text; proxy.dataset.flowBlockId=survivor.id; proxy.setSelectionRange(offset,offset);
    _flowDirectEditMounting=false;
    proxy.dataset.flowReflowPending='true';
    _flowDirectEditApplying=true;
    try { applyFlowAuthoringEdit({type:'removeEmptyParagraph',groupId:group.id,sectionId:section.id,
        blockId:removed.id,neighborId:survivor.id},{immediate:true,editorFocus}); }
    finally { _flowDirectEditApplying=false; }
    setFlowDirectEditNote('空行を削除しました。');
    return true;
}

function applyFlowDirectBackspace(proxy) {
    if (isTranslatedFlowDirectSession()) { setFlowDirectEditNote(t('flow_direct_translation_hint')); return false; }
    if (removeFlowEmptyLine(proxy,-1)) return true;
    _flowDirectPreferredInlinePosition = null;
    const group = _flowDirectEditSession
        ? getFlowGroupById(_flowDirectEditSession.groupId)
        : null;
    if (group && isFlowDirectParagraphImmediatelyAfterHeading(group, _flowDirectEditSession)) {
        return removeFlowDirectEmptyParagraphAfterHeading(proxy);
    }
    return mergeFlowDirectParagraphBackward(proxy);
}

function mergeFlowDirectParagraphBackward(proxy) {
    if (proxy !== _flowDirectEditProxy || !_flowDirectEditSession || _flowDirectEditApplying) return false;
    const group = getFlowGroupById(_flowDirectEditSession.groupId);
    if (!group) return false;
    let transaction;
    try {
        transaction = createFlowDirectParagraphMergeBackwardTransaction(group, _flowDirectEditSession, {
            selectionStart: proxy.selectionStart,
            selectionEnd: proxy.selectionEnd,
        });
    } catch (error) {
        if (!(error instanceof FlowDirectEditError)) throw error;
        if (error.code === 'FLOW_DIRECT_MERGE_TITLE_BOUNDARY') {
            setFlowDirectEditNote('扉と本文、または別の扉区間の境界です。扉設定を解除してから結合してください。');
        } else if (error.code === 'FLOW_DIRECT_MERGE_METADATA_CONFLICT') {
            setFlowDirectEditNote('段落の設定が異なるため、設定を保持したまま結合できません。');
        } else if (error.code === 'FLOW_DIRECT_PARAGRAPH_REQUIRED') {
            setFlowDirectEditNote('見出しはBackspaceで前の段落へ結合できません。');
        } else if (error.code === 'FLOW_DIRECT_COLLAPSED_CARET_REQUIRED') {
            setFlowDirectEditNote('選択範囲を含む段落結合は未対応です。選択を解除してください。');
        } else if (error.code === 'FLOW_DIRECT_PARAGRAPH_START_REQUIRED') {
            setFlowDirectEditNote('段落の先頭でのみ、Backspaceによる前段落との結合ができます。');
        } else if (error.code === 'FLOW_DIRECT_PREVIOUS_PARAGRAPH_REQUIRED') {
            setFlowDirectEditNote('直前が段落ではないため結合しませんでした。見出しや改ページは保持されます。');
        } else if (error.code === 'FLOW_DIRECT_MERGE_TRANSLATION_DATA_PRESENT') {
            setFlowDirectEditNote('この段落には翻訳本文があるため、データ保護のため結合しませんでした。');
        } else {
            recoverFlowDirectEditProxy(proxy, '段落を安全に結合できませんでした。Flow原稿画面で編集してください。');
        }
        return false;
    }

    endHistoryGroup();
    _flowDirectEditSession = transaction.nextSession;
    selectFlowDirectEditing(transaction.operation.groupId, transaction.selection.focusPoint);
    _flowDirectEditMounting = true;
    proxy.value = transaction.nextSession.expectedText;
    proxy.dataset.flowBlockId = transaction.nextSession.blockId;
    proxy.setSelectionRange(
        transaction.nextSession.selectionStart,
        transaction.nextSession.selectionEnd,
        transaction.nextSession.selectionDirection,
    );
    _flowDirectEditMounting = false;
    _flowDirectEditApplying = true;
    proxy.dataset.flowReflowPending = 'true';
    proxy._flowDirectPageElement?.classList.add('flow-direct-edit-reflow-pending');
    try {
        applyFlowAuthoringEdit(transaction.operation, { immediate: true });
    } finally {
        _flowDirectEditApplying = false;
    }
    setFlowDirectEditNote('前の段落へ結合しました。後続ページを再配置しています。');
    return true;
}

function mergeFlowDirectParagraphForward(proxy) {
    if (isTranslatedFlowDirectSession()) { setFlowDirectEditNote(t('flow_direct_translation_hint')); return false; }
    if (removeFlowEmptyLine(proxy,1)) return true;
    _flowDirectPreferredInlinePosition = null;
    if (proxy !== _flowDirectEditProxy || !_flowDirectEditSession || _flowDirectEditApplying) return false;
    const group = getFlowGroupById(_flowDirectEditSession.groupId);
    if (!group) return false;
    let transaction;
    try {
        transaction = createFlowDirectParagraphMergeForwardTransaction(group, _flowDirectEditSession, {
            selectionStart: proxy.selectionStart,
            selectionEnd: proxy.selectionEnd,
        });
    } catch (error) {
        if (!(error instanceof FlowDirectEditError)) throw error;
        if (error.code === 'FLOW_DIRECT_MERGE_TITLE_BOUNDARY') {
            setFlowDirectEditNote('扉と本文、または別の扉区間の境界です。扉設定を解除してから結合してください。');
        } else if (error.code === 'FLOW_DIRECT_MERGE_METADATA_CONFLICT') {
            setFlowDirectEditNote('段落の設定が異なるため、設定を保持したまま結合できません。');
        } else if (error.code === 'FLOW_DIRECT_PARAGRAPH_REQUIRED') {
            setFlowDirectEditNote('見出しはDeleteで次の段落へ結合できません。');
        } else if (error.code === 'FLOW_DIRECT_COLLAPSED_CARET_REQUIRED') {
            setFlowDirectEditNote('選択範囲を含む段落結合は未対応です。選択を解除してください。');
        } else if (error.code === 'FLOW_DIRECT_PARAGRAPH_END_REQUIRED') {
            setFlowDirectEditNote('段落の末尾でのみ、Deleteによる次段落との結合ができます。');
        } else if (error.code === 'FLOW_DIRECT_NEXT_PARAGRAPH_REQUIRED') {
            setFlowDirectEditNote('直後が段落ではないため結合しませんでした。見出しや改ページは保持されます。');
        } else if (error.code === 'FLOW_DIRECT_MERGE_TRANSLATION_DATA_PRESENT') {
            setFlowDirectEditNote('次の段落には翻訳本文があるため、データ保護のため結合しませんでした。');
        } else {
            recoverFlowDirectEditProxy(proxy, '段落を安全に結合できませんでした。Flow原稿画面で編集してください。');
        }
        return false;
    }

    endHistoryGroup();
    _flowDirectEditSession = transaction.nextSession;
    selectFlowDirectEditing(transaction.operation.groupId, transaction.selection.focusPoint);
    _flowDirectEditMounting = true;
    proxy.value = transaction.nextSession.expectedText;
    proxy.dataset.flowBlockId = transaction.nextSession.blockId;
    proxy.setSelectionRange(
        transaction.nextSession.selectionStart,
        transaction.nextSession.selectionEnd,
        transaction.nextSession.selectionDirection,
    );
    _flowDirectEditMounting = false;
    _flowDirectEditApplying = true;
    proxy.dataset.flowReflowPending = 'true';
    proxy._flowDirectPageElement?.classList.add('flow-direct-edit-reflow-pending');
    try {
        applyFlowAuthoringEdit(transaction.operation, { immediate: true });
    } finally {
        _flowDirectEditApplying = false;
    }
    setFlowDirectEditNote('次の段落を結合しました。後続ページを再配置しています。');
    return true;
}

function insertFlowDirectLineBreak(proxy) {
    if (_flowTextSelection) return;
    proxy.setRangeText('\n', proxy.selectionStart, proxy.selectionEnd, 'end');
    commitFlowDirectEdit(proxy);
}

function deleteFlowSelectedText() {
    const proxy = _flowDirectEditProxy, session = _flowDirectEditSession;
    if (!proxy || !session || !_flowTextSelection || _flowAuthoringComposing || _flowDirectEditApplying) return;
    const group = getFlowGroupById(session.groupId);
    const selection = validateFlowTextSelection(group, _flowTextSelection);
    if (!selection) { setFlowDirectEditNote('原稿が変わりました。削除する範囲を選択し直してください。'); return; }
    const operation = {type:'deleteTextSelection',groupId:group.id,selection};
    let next;
    try { next = applyFlowAuthoringOperation(state.blocks, operation); }
    catch { setFlowDirectEditNote('見出し・改ページ・異なる扉設定をまたぐ範囲は削除できません。本文内の範囲を選択してください。'); return; }
    const point = selection.start;
    const target = next.find(g=>g.id===group.id).flow.document.sections.find(s=>s.id===point.sectionId).blocks.find(b=>b.id===point.blockId);
    const editorFocus = captureFlowDirectEditFocusSnapshot();
    endHistoryGroup();
    _flowTextSelection = null;
    _flowDirectEditSession = Object.freeze({...session,sectionId:point.sectionId,blockId:point.blockId,
        blockType:target.type,expectedText:target.texts[selection.languageKey],sourcePoint:point,
        selectionStart:point.utf16Offset,selectionEnd:point.utf16Offset,selectionDirection:'none'});
    selectFlowDirectEditing(group.id,point);
    _flowDirectEditMounting = true;
    proxy.readOnly = false;
    proxy.value = _flowDirectEditSession.expectedText;
    proxy.dataset.flowBlockId = point.blockId;
    proxy.setSelectionRange(point.utf16Offset,point.utf16Offset);
    _flowDirectEditMounting = false;
    proxy.dataset.flowReflowPending = 'true';
    _flowDirectEditApplying = true;
    try { applyFlowAuthoringEdit(operation,{immediate:true,editorFocus}); }
    finally { _flowDirectEditApplying = false; }
    setFlowDirectEditNote('選択した本文を削除しました。翻訳は保持され、再確認の対象になります。');
}

function handleFlowDirectBeforeInput(event) {
    if (_flowTextSelection) {
        event.preventDefault();
        if (['deleteContentBackward','deleteContentForward'].includes(event.inputType)) deleteFlowSelectedText();
        return;
    }
    if (event.target !== _flowDirectEditProxy) return;
    if (event.isComposing || _flowAuthoringComposing) return;
    if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
        event.preventDefault();
        if (event.inputType === 'historyUndo') performProjectUndo();
        else performProjectRedo();
        return;
    }
    if (event.inputType === 'insertPageBreak') {
        event.preventDefault();
        insertFlowDirectPageBreak(event.target);
        return;
    }
    if (event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak') {
        event.preventDefault();
        applyFlowDirectEnter(event.target);
        return;
    }
    if (
        event.inputType === 'deleteContentBackward'
        && event.target.selectionStart === 0
        && event.target.selectionEnd === 0
    ) {
        event.preventDefault();
        applyFlowDirectBackspace(event.target);
        return;
    }
    if (
        event.inputType === 'deleteContentForward'
        && event.target.selectionStart === event.target.selectionEnd
        && event.target.selectionEnd === String(event.target.value || '').length
    ) {
        event.preventDefault();
        mergeFlowDirectParagraphForward(event.target);
        return;
    }
    if (
        /[\r\u2028\u2029]/u.test(String(event.data || ''))
    ) {
        event.preventDefault();
        setFlowDirectEditNote('この改行文字は対応していません。通常の改行を使ってください。');
    }
}

function handleFlowDirectInput(event) {
    const proxy = event.target;
    if (proxy !== _flowDirectEditProxy || _flowAuthoringComposing) return;
    commitFlowDirectEdit(proxy);
}

function handleFlowDirectCompositionStart(event) {
    if (event.target !== _flowDirectEditProxy) return;
    const resumePendingReflow = event.target.dataset.flowReflowPending === 'true'
        || !!_flowAuthoringReflowTimer
        || !!_editorFlowProjectionController;
    event.target.dataset.flowCompositionResumeReflow = resumePendingReflow ? 'true' : 'false';
    _flowAuthoringComposing = true;
    _flowDirectCompositionText = '';
    _flowDirectCompositionRange = Object.freeze({
        start: event.target.selectionStart,
        end: event.target.selectionEnd,
    });
    event.target.dataset.composing = 'true';
    if (_flowAuthoringReflowTimer) clearTimeout(_flowAuthoringReflowTimer);
    _flowAuthoringReflowTimer = null;
    _editorFlowProjectionController?.abort();
    _editorFlowProjectionController = null;
    _editorFlowProjectionRequestKey = '';
    _editorFlowProjectionRequestId += 1;
    renderFlowDirectEditIndicators(event.target);
    syncFlowDirectFormatControls();
}

function handleFlowDirectCompositionUpdate(event) {
    if (event.target !== _flowDirectEditProxy) return;
    _flowDirectCompositionText = String(event.data || '');
    renderFlowDirectEditIndicators(event.target);
}

function handleFlowDirectCompositionEnd(event) {
    if (event.target !== _flowDirectEditProxy) return;
    const resumePendingReflow = event.target.dataset.flowCompositionResumeReflow === 'true';
    delete event.target.dataset.flowCompositionResumeReflow;
    _flowAuthoringComposing = false;
    _flowDirectCompositionText = '';
    _flowDirectCompositionRange = null;
    event.target.dataset.composing = 'false';
    commitFlowDirectEdit(event.target);
    syncFlowDirectFormatControls();
    if (
        resumePendingReflow
        && event.target === _flowDirectEditProxy
        && _flowDirectEditSession
        && !_flowAuthoringReflowTimer
        && !_editorFlowProjectionController
    ) {
        scheduleFlowAuthoringReflow(_flowDirectEditSession.groupId, { immediate: true });
    }
}

function exitFlowDirectEdit(groupId) {
    const activeBlock = getActiveBlock();
    endHistoryGroup();
    clearFlowDirectEditRuntime();
    selectFlowGeneratedPage(groupId);
    const projection = getEditorPageProjection();
    if (activeBlock?.id === groupId && projection) renderEditorFlowGeneratedPage(activeBlock, projection);
    syncThumbSelectionDom();
}

function mountFlowDirectEditProxy(activeBlock, page, pageElement, session) {
    objectToolbar.clearSelection();
    _flowTextSelection = validateFlowTextSelection(activeBlock, _flowTextSelection);
    clearFlowDirectEditRuntime({ resetComposition: false, preserveSelection: true, preservePointer: true });
    _flowDirectEditSession = session;
    const proxy = document.createElement('textarea');
    proxy.className = 'flow-direct-input-proxy';
    proxy.dataset.testid = 'flow-direct-input';
    proxy.dataset.flowGroupId = session.groupId;
    proxy.dataset.flowSectionId = session.sectionId;
    proxy.dataset.flowBlockId = session.blockId;
    proxy.dataset.flowWritingMode = session.writingMode;
    proxy.lang = session.languageKey;
    proxy.setAttribute('aria-label', `${session.blockType === 'heading' ? '見出し' : '段落'}を生成ページ上で直接編集`);
    proxy.setAttribute('autocomplete', 'off');
    proxy.setAttribute('autocorrect', 'on');
    proxy.setAttribute('autocapitalize', 'sentences');
    proxy.setAttribute('spellcheck', 'true');
    proxy.wrap = 'off';
    proxy.value = session.expectedText;
    proxy.readOnly = !!_flowTextSelection;
    if (_flowTextSelection) proxy.setAttribute('aria-label', 'Flow本文の複数段落選択。コピー・削除に対応');
    proxy._flowDirectPageEntry = page;
    proxy._flowDirectPageElement = pageElement;
    _flowDirectEditProxy = proxy;
    pageElement.classList.add('flow-direct-edit-active');
    pageElement.appendChild(proxy);

    proxy.addEventListener('copy', event => {
        if (!_flowTextSelection) return;
        event.preventDefault();
        const selection = validateFlowTextSelection(getFlowGroupById(session.groupId), _flowTextSelection);
        if (selection) event.clipboardData?.setData('text/plain', selection.text);
    });
    proxy.addEventListener('cut', event => { if (_flowTextSelection) event.preventDefault(); });
    proxy.addEventListener('beforeinput', handleFlowDirectBeforeInput);
    proxy.addEventListener('input', handleFlowDirectInput);
    proxy.addEventListener('compositionstart', handleFlowDirectCompositionStart);
    proxy.addEventListener('compositionupdate', handleFlowDirectCompositionUpdate);
    proxy.addEventListener('compositionend', handleFlowDirectCompositionEnd);
    proxy.addEventListener('select', () => updateFlowDirectSelectionFromProxy(proxy));
    proxy.addEventListener('keyup', (event) => {
        if (!event.isComposing) updateFlowDirectSelectionFromProxy(proxy);
    });
    proxy.addEventListener('keydown', (event) => {
        if (event.isComposing || event.keyCode === 229 || _flowAuthoringComposing) return;
        if (handleFlowDirectNavigation(event, proxy)) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            exitFlowDirectEdit(activeBlock.id);
            return;
        }
        if (_flowTextSelection) {
            if (event.key === 'Delete' || event.key === 'Backspace') {
                event.preventDefault(); event.stopPropagation(); deleteFlowSelectedText(); return;
            }
            if (event.key !== 'Tab' && (!(event.ctrlKey || event.metaKey) || !['c', 'C', 'v', 'V'].includes(event.key))) {
                event.preventDefault();
                event.stopPropagation();
            }
            return;
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey) {
                insertFlowDirectPageBreak(proxy);
                return;
            }
            if (event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
                insertFlowDirectLineBreak(proxy);
                return;
            }
            if (event.ctrlKey || event.metaKey || event.altKey) {
                setFlowDirectEditNote('修飾キー付きEnterは未対応です。現在はFlow原稿画面で編集してください。');
                return;
            }
            applyFlowDirectEnter(proxy);
            return;
        }
        if (
            event.key === 'Backspace'
            && !event.shiftKey
            && !event.ctrlKey
            && !event.metaKey
            && !event.altKey
            && proxy.selectionStart === 0
            && proxy.selectionEnd === 0
        ) {
            event.preventDefault();
            applyFlowDirectBackspace(proxy);
            return;
        }
        if (
            event.key === 'Delete'
            && !event.shiftKey
            && !event.ctrlKey
            && !event.metaKey
            && !event.altKey
            && proxy.selectionStart === proxy.selectionEnd
            && proxy.selectionEnd === String(proxy.value || '').length
        ) {
            event.preventDefault();
            mergeFlowDirectParagraphForward(proxy);
        }
    });
    proxy.addEventListener('paste', (event) => {
        if (_flowTextSelection) { event.preventDefault(); return; }
        const text = event.clipboardData?.getData?.('text/plain') || '';
        if (/[\r\n\u2028\u2029]/u.test(text)) {
            event.preventDefault();
            proxy.setRangeText(text.replace(/\r\n?|[\u2028\u2029]/gu, '\n'),
                proxy.selectionStart, proxy.selectionEnd, 'end');
            commitFlowDirectEdit(proxy);
        }
    });

    _flowDirectEditMounting = true;
    proxy.focus({ preventScroll: true });
    proxy.setSelectionRange(session.selectionStart, session.selectionEnd, session.selectionDirection);
    _flowDirectEditMounting = false;
    renderFlowDirectEditIndicators(proxy);
    setFlowDirectEditNote('Flow生成ページを直接編集中（原稿へ保存・Escで閲覧に戻る）');
    syncFlowDirectFormatControls();
}

function tryCreateFlowDirectEditSession(activeBlock, page, sourcePoint) {
    try {
        const session = createFlowDirectEditSession(activeBlock, {
            pageLanguageKey: page.languageKey,
            writingMode: page.writingMode,
            isSourceFallback: page.isSourceFallback,
            allowMissingTranslation: page.languageKey === page.requestedLanguageKey,
            sourcePoint,
        });
        return restoreFlowDirectSelection(session, sourcePoint);
    } catch (error) {
        if (error instanceof FlowDirectEditError) {
            return null;
        }
        throw error;
    }
}

function restoreMappedFlowSourceCaret(groupId, sourcePoint) {
    _flowPendingSourceCaret = Object.freeze({ groupId, sourcePoint });
    requestAnimationFrame(() => {
        const pending = _flowPendingSourceCaret;
        if (!pending || pending.groupId !== groupId || pending.sourcePoint !== sourcePoint) return;
        _flowPendingSourceCaret = null;
        const root = getFlowAuthoringSurface();
        if (
            !root
            || root.hidden || document.getElementById('flow-authoring-surface')?.hidden
            || root.dataset.flowGroupId !== groupId
            || root.dataset.languageKey !== sourcePoint.languageKey
        ) return;
        const input = [...root.querySelectorAll('[data-flow-field="block-text"]')].find((element) => {
            const target = getFlowAuthoringTarget(element);
            return target.sectionId === sourcePoint.sectionId && target.blockId === sourcePoint.blockId;
        });
        const utf16Offset = Number(sourcePoint.utf16Offset);
        if (
            !input
            || !Number.isInteger(utf16Offset)
            || utf16Offset < 0
            || utf16Offset > String(input.value || '').length
            || typeof input.setSelectionRange !== 'function'
        ) return;
        input.focus({ preventScroll: true });
        input.setSelectionRange(utf16Offset, utf16Offset, 'none');
        scrollFlowSourceCaretIntoView(root, input, utf16Offset);
        root.dataset.sourceMappedBlockId = sourcePoint.blockId;
        root.dataset.sourceMappedGraphemeOffset = String(sourcePoint.graphemeOffset);
        root.dataset.sourceMappedUtf16Offset = String(sourcePoint.utf16Offset);
        const pageLockNote = document.getElementById('page-lock-note');
        if (pageLockNote) {
            const label = sourcePoint.blockType === 'heading' ? '見出し' : '段落';
            pageLockNote.textContent = `生成ページから${label}の該当位置へ移動しました（読取マッピング）`;
            pageLockNote.style.display = 'block';
        }
    });
}

function handleFlowGeneratedPageSourceClick(event, activeBlock, page, pageElement) {
    if (event.button !== 0 || page.isSourceFallback) return;
    let sourcePoint;
    try {
        sourcePoint = mapFlowClientPointToSource(
            pageElement,
            page.page,
            event.clientX,
            event.clientY,
            { writingMode: page.writingMode },
        );
    } catch (error) {
        console.warn('[Flow source mapping] Generated page click could not be mapped:', error);
        return;
    }
    if (!sourcePoint) return;
    event.preventDefault();
    event.stopPropagation();
    endHistoryGroup();
    const directSession = tryCreateFlowDirectEditSession(activeBlock, page, sourcePoint);
    if (directSession) {
        setSelectedFlowRuntimePageIndex(activeBlock.id, page.flowPageIndex, page.flowPageCount);
        selectFlowDirectEditing(activeBlock.id, directSession.sourcePoint);
        mountFlowDirectEditProxy(activeBlock, page, pageElement, directSession);
        syncThumbSelectionDom();
        return;
    }
    selectFlowSource(activeBlock.id, sourcePoint);
    restoreMappedFlowSourceCaret(activeBlock.id, sourcePoint);
    refresh();
}

function moveFlowDirectProxyToPage(pageIndex, reveal = true) {
    const proxy = _flowDirectEditProxy;
    if (!proxy || !_flowCanvasView) return;
    ensureFlowCanvasPage(pageIndex, reveal);
    const pages = getEditorPageProjection()?.pages.filter(entry => entry.kind === 'flow'
        && entry.groupId === _flowDirectEditSession.groupId) || [];
    let inputPageIndex = pageIndex;
    if (proxy.selectionStart !== proxy.selectionEnd) {
        const startPoint = createFlowDirectSourcePoint(_flowDirectEditSession, proxy.value, proxy.selectionStart, 'forward');
        inputPageIndex = findFlowSourcePointInPages(pages, startPoint)?.pageIndex ?? pageIndex;
    }
    const pageElement = ensureFlowCanvasPage(inputPageIndex, false);
    setSelectedFlowRuntimePageIndex(_flowDirectEditSession.groupId, pageIndex, pages.length);
    if (!pageElement || pageElement === proxy._flowDirectPageElement) {
        renderFlowDirectEditIndicators(proxy);
        return;
    }
    const start = proxy.selectionStart;
    const end = proxy.selectionEnd;
    const direction = proxy.selectionDirection;
    proxy._flowDirectPageElement?.classList.remove('flow-direct-edit-active');
    proxy._flowDirectPageElement = pageElement;
    proxy._flowDirectPageEntry = pageElement._flowPageEntry;
    pageElement.classList.add('flow-direct-edit-active');
    pageElement.appendChild(proxy);
    proxy.focus({ preventScroll: true });
    proxy.setSelectionRange(start, end, direction);
    ensureFlowCanvasPage(pageIndex, false);
    renderFlowDirectEditIndicators(proxy);
}

function setFlowCrossBlockSelection(group, anchor, focus, reveal = false) {
    const selection = createFlowTextSelection(group, anchor, focus);
    const pages = getEditorPageProjection()?.pages.filter(p => p.kind === 'flow' && p.groupId === group.id);
    const location = pages && findFlowSourcePointInPages(pages, focus);
    if (!selection || !location) return false;
    const page = pages[location.pageIndex];
    const session = tryCreateFlowDirectEditSession(group, page, focus);
    if (!session) return false;
    _flowTextSelection = selection.collapsed ? null : selection;
    selectFlowDirectEditing(group.id, focus);
    const surface = ensureFlowCanvasPage(location.pageIndex, reveal);
    mountFlowDirectEditProxy(group, page, surface, session);
    setSelectedFlowRuntimePageIndex(group.id, location.pageIndex, pages.length);
    if (_flowTextSelection) setFlowDirectEditNote('選択した本文はコピー、Delete・Backspaceで削除できます。');
    syncFlowDirectFormatControls();
    syncThumbSelectionDom();
    syncPageNavigationSlider();
    return true;
}

function handleFlowDirectNavigation(event, proxy) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)
        || event.altKey || ((event.ctrlKey || event.metaKey) && !['Home', 'End'].includes(event.key))) return false;
    event.preventDefault();
    if (proxy !== _flowDirectEditProxy || !_flowDirectEditSession || !_flowCanvasView) return true;
    const group = getFlowGroupById(_flowDirectEditSession.groupId);
    if (!group) return true;
    // Fonts and fixed-page autosave can invalidate the projection without a text edit.
    // Recover through the deduplicated request, even if an older request left us pending.
    const projection = getEditorPageProjection();
    if (!projection) {
        requestEditorFlowProjection(group);
        return true;
    }
    if (proxy.dataset.flowReflowPending === 'true') return true;
    updateFlowDirectSelectionFromProxy(proxy, { navigate: false });
    const session = _flowDirectEditSession;
    const vertical = session.writingMode === 'vertical-rl';
    const backward = vertical ? ['ArrowUp', 'ArrowRight'].includes(event.key)
        : ['ArrowLeft', 'ArrowUp'].includes(event.key);
    let point;
    let pageIndex = getSelectedFlowRuntimePageIndex(session.groupId);
    if (!event.shiftKey && _flowTextSelection && event.key.startsWith('Arrow')) {
        point = backward ? _flowTextSelection.start : _flowTextSelection.end;
        return setFlowCrossBlockSelection(group, point, point, true);
    } else if (!event.shiftKey && proxy.selectionStart !== proxy.selectionEnd && event.key.startsWith('Arrow')) {
        point = createFlowDirectSourcePoint(session, session.expectedText,
            backward ? proxy.selectionStart : proxy.selectionEnd, backward ? 'backward' : 'forward');
        _flowDirectPreferredInlinePosition = null;
    } else if (event.ctrlKey || event.metaKey) {
        const blocks = group.flow.document.sections.flatMap(section => section.blocks
            .filter(block => ['heading', 'paragraph'].includes(block.type)).map(block => ({ section, block })));
        const target = event.key === 'Home' ? blocks[0] : blocks.at(-1);
        if (!target) return true;
        const text = target.block.texts[session.languageKey] || '';
        point = createFlowDirectSourcePoint({ ...session, sectionId: target.section.id,
            blockId: target.block.id, blockType: target.block.type }, text,
            event.key === 'Home' ? 0 : text.length, event.key === 'Home' ? 'forward' : 'backward');
        _flowDirectPreferredInlinePosition = null;
    } else {
        const resolve = () => resolveFlowDirectNavigation({
            stops: measureFlowDirectNavigationStops(getMountedActiveFlowPages().map(entry => ({
                pageElement: entry.pageElement, page: entry.page.page, pageIndex: entry.pageIndex,
            })), { writingMode: session.writingMode }),
            sourcePoint: session.sourcePoint, pageIndex, key: event.key, writingMode: session.writingMode,
            preferredInlinePosition: _flowDirectPreferredInlinePosition,
        });
        let result = resolve();
        if (result?.edge && !result.moved) {
            ensureFlowCanvasPage(pageIndex + (result.edge === 'end' ? 1 : -1), false);
            result = resolve();
        }
        if (!result?.moved) return true;
        point = result.sourcePoint;
        pageIndex = result.pageIndex;
        _flowDirectPreferredInlinePosition = result.preferredInlinePosition;
    }
    if (event.shiftKey && (_flowTextSelection || point.blockId !== session.blockId || point.sectionId !== session.sectionId)) {
        const anchor = _flowTextSelection?.anchor || createFlowDirectSourcePoint(session, session.expectedText,
            proxy.selectionDirection === 'backward' ? proxy.selectionEnd : proxy.selectionStart);
        setFlowCrossBlockSelection(group, anchor, point, true);
        return true;
    }
    if (_flowTextSelection) return setFlowCrossBlockSelection(group, point, point, true);
    const pages = projection.pages.filter(page => page.kind === 'flow' && page.groupId === session.groupId);
    const location = findFlowSourcePointInPages(pages, point);
    if (!location) return true;
    pageIndex = location.pageIndex;
    if (point.blockId !== session.blockId || point.sectionId !== session.sectionId) {
        const nextSession = tryCreateFlowDirectEditSession(getFlowGroupById(session.groupId), pages[pageIndex], point);
        if (!nextSession) return true;
        selectFlowDirectEditing(session.groupId, point);
        const surface = ensureFlowCanvasPage(pageIndex);
        mountFlowDirectEditProxy(getActiveBlock(), pages[pageIndex], surface, nextSession);
    } else {
        const anchor = event.shiftKey ? (proxy.selectionDirection === 'backward'
            ? proxy.selectionEnd : proxy.selectionStart) : point.utf16Offset;
        _flowDirectEditSession = Object.freeze({ ...session, sourcePoint: point });
        proxy.setSelectionRange(Math.min(anchor, point.utf16Offset), Math.max(anchor, point.utf16Offset),
            point.utf16Offset < anchor ? 'backward' : 'none');
        updateFlowDirectSelectionFromProxy(proxy, { navigate: false });
        moveFlowDirectProxyToPage(pageIndex);
    }
    setSelectedFlowRuntimePageIndex(session.groupId, pageIndex, pages.length);
    syncThumbSelectionDom();
    syncPageNavigationSlider();
    return true;
}

function handleFlowPagePointerDown(event, activeBlock, page, pageElement) {
    if (event.button !== 0 || event.pointerType === 'touch' || _flowAuthoringComposing) return;
    const previous = _flowDirectEditSession;
    const oldProxy = _flowDirectEditProxy;
    const previousAnchor = _flowTextSelection?.anchor || (previous && createFlowDirectSourcePoint(previous,
        previous.expectedText, oldProxy.selectionDirection === 'backward' ? oldProxy.selectionEnd : oldProxy.selectionStart));
    _flowDirectPointerCleanup?.();
    _flowTextSelection = null;
    handleFlowGeneratedPageSourceClick(event, activeBlock, page, pageElement);
    const session = _flowDirectEditSession;
    if (!_flowDirectEditProxy || !session || session.groupId !== activeBlock.id) return;
    _flowDirectPreferredInlinePosition = null;
    const anchor = event.shiftKey && previous?.groupId === session.groupId ? previousAnchor : session.sourcePoint;
    const applyPoint = (point, pageIndex) => {
        if (!point) return;
        if (_flowTextSelection || point.blockId !== anchor.blockId || point.sectionId !== anchor.sectionId) {
            setFlowCrossBlockSelection(activeBlock, anchor, point);
        } else {
            const proxy = _flowDirectEditProxy;
            _flowDirectEditSession = Object.freeze({ ..._flowDirectEditSession, sourcePoint: point });
            proxy.setSelectionRange(Math.min(anchor.utf16Offset, point.utf16Offset), Math.max(anchor.utf16Offset, point.utf16Offset),
                point.utf16Offset < anchor.utf16Offset ? 'backward' : 'none');
            updateFlowDirectSelectionFromProxy(proxy, { navigate: false });
            moveFlowDirectProxyToPage(pageIndex, false);
        }
    };
    if (event.shiftKey) applyPoint(session.sourcePoint, page.flowPageIndex);
    let lastPointer = null;
    let scrollFrame = 0;
    const onMove = move => {
        lastPointer = { clientX: move.clientX, clientY: move.clientY, buttons: move.buttons };
        if (!(move.buttons & 1) || _flowDirectEditSession?.groupId !== session.groupId) return;
        const surface = document.elementFromPoint(move.clientX, move.clientY)?.closest('.flow-editor-page-surface');
        const entry = surface?._flowPageEntry;
        if (!entry || entry.groupId !== session.groupId || entry.isSourceFallback || entry.languageKey !== session.languageKey) return;
        const point = mapFlowClientPointToSource(surface, entry.page, move.clientX, move.clientY,
            { writingMode: session.writingMode });
        if (!point) return;
        move.preventDefault();
        applyPoint(point, entry.flowPageIndex);
    };
    const scrollSelection = () => {
        const viewport = _flowCanvasView?.viewport;
        if (lastPointer && viewport && (lastPointer.buttons & 1)) {
            const bounds = viewport.getBoundingClientRect();
            const { clientX: x, clientY: y } = lastPointer;
            let speed = y >= bounds.top && y <= bounds.bottom
                ? (x < bounds.left + 36 ? -10 : x > bounds.right - 36 ? 10 : 0) : 0;
            if (speed) {
                const pages = getEditorPageProjection()?.pages.filter(p => p.kind === 'flow' && p.groupId === session.groupId) || [];
                const endIndex = (speed > 0) !== (viewport.dataset.direction === 'rtl') ? pages.length - 1 : 0;
                const boundary = getMountedActiveFlowPages().find(entry => entry.page.flowPageIndex === endIndex);
                const edge = boundary?.pageElement.getBoundingClientRect();
                if (edge && (speed > 0 ? edge.right <= bounds.right : edge.left >= bounds.left)) speed = 0;
            }
            if (speed) {
                viewport.scrollLeft += speed;
                onMove({ clientX: Math.max(bounds.left + 2, Math.min(bounds.right - 2, x)), clientY: y,
                    buttons: 1, preventDefault() {} });
                lastPointer = { clientX: x, clientY: y, buttons: 1 };
            }
        }
        scrollFrame = requestAnimationFrame(scrollSelection);
    };
    const cleanup = () => {
        cancelAnimationFrame(scrollFrame);
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', cleanup);
        document.removeEventListener('pointercancel', cleanup);
        _flowDirectPointerCleanup = null;
    };
    _flowDirectPointerCleanup = cleanup;
    scrollFrame = requestAnimationFrame(scrollSelection);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', cleanup);
    document.addEventListener('pointercancel', cleanup);
}

function ensureFlowCanvasView() {
    if (_flowCompare?.enabled) {
        _flowCanvasView = _flowCompare.getView(state.activeLang || state.defaultLang || 'ja');
        return _flowCanvasView;
    }
    if (!_flowNormalCanvasView) _flowNormalCanvasView = createEditorFlowCanvas();
    _flowCanvasView = _flowNormalCanvasView;
    return _flowCanvasView;
}

function createEditorFlowCanvas(language = null) {
    const view = createFlowCanvasView({
        container: document.getElementById('canvas-view'),
        getPinnedPageIndex: () => {
            if (view !== _flowCanvasView) return null;
            const pinned = _flowDirectEditProxy?._flowDirectPageEntry;
            return pinned?.index ?? getActiveProjectionPageIndex(getEditorCanvasProjection());
        },
        getDirection: () => getEditorLangDirection(language || state.activeLang || state.defaultLang || 'ja'),
        getJoinedPageIndices: pages => {
            const joins = getEditorCanvasSpreadJoins(pages);
            if (hasFlowGroups(state) || state.uiPrefs?.spreadView) {
                const book=normalizeBookSettings(state.book,state.bookMode,pages.length);
                const first=book.mode==='none'?0:1,last=book.mode==='none'?pages.length:pages.length-1;
                for(let i=first;i+1<last;i+=2)joins.push(i+1);
            }
            return joins;
        },
        onBoundaryMenu:(event,page,position)=>openThumbnailContextMenu(event,{dataset:{blockIndex:String(page.blockIndex),flowPageIndex:String(page.flowPageIndex||0)}},position),
        renderFixedPage: (element, page) => {
            const preview = document.createElement('div');
            preview.className = 'editor-fixed-page-preview';
            element.appendChild(preview);
            renderFixedPagePreview(preview, state.sections[page.fixedPageIndex] || page.section, language || state.activeLang || state.defaultLang || 'ja', page.fixedPageIndex);
        },
        onBeforeRemove: entry => {
            if (entry.pageElement.contains(document.getElementById('canvas-stage'))) parkFixedCanvasStage();
        },
        getFlowGroupLabel: page => 'Flow ' + (state.blocks.filter(b=>b.kind==='flow').findIndex(b=>b.id===page.groupId)+1),
        getPageLabel: page => {
            const label = getPageDisplayLabel(page.index, getEditorCanvasProjection()?.totalPageCount || 1,
                state.book, state.bookMode);
            const kind = page.kind === 'flow' ? 'editor_canvas_flow' : page.section?.spreadImage?.groupId
                ? 'editor_canvas_spread' : page.section?.type === 'text' ? 'editor_canvas_fixed' : 'editor_canvas_image';
            return `${label} · ${t(kind)}${page.isSourceFallback ? ` · ${t('editor_canvas_fallback')}` : ''}`;
        },
        onGeometryChange: () => { if (view === _flowCanvasView) { attachFixedCanvasStage(); renderFlowDirectEditIndicators(); } _flowCompare?.highlight(); },
        onReadingScroll: () => _flowCompare?.follow(view),
        onScrollPage: index => {
            if (view !== _flowCanvasView) return;
            const active = getActiveBlock();
            if (active?.kind !== 'flow') return;
            setSelectedFlowRuntimePageIndex(active.id, index);
            syncThumbSelectionDom();
            syncPageNavigationSlider();
            syncEditorPageCounters();
        },
        onPageCreate: ({ pageElement, page }) => {
            if (page.kind === 'fixed') {
                pageElement.setAttribute('aria-label', `${t('editor_canvas_select')} ${getPageDisplayLabel(page.index,
                    getEditorCanvasProjection()?.totalPageCount || 1, state.book, state.bookMode)}`);
                pageElement.tabIndex = 0;
                const activate = event => {
                    if (_flowAuthoringComposing) return;
                    const otherPane = _flowCompare?.enabled && view !== _flowCanvasView;
                    if (otherPane && !_flowCompare.activateView(view, language)) return;
                    if (!otherPane && page.blockIndex === state.activeBlockIdx) return;
                    event.stopPropagation();
                    endHistoryGroup();
                    activateProjectionPage(page);
                };
                pageElement.addEventListener('click', activate);
                pageElement.addEventListener('keydown', event => {
                    if (event.target !== pageElement || !['Enter', ' '].includes(event.key)) return;
                    event.preventDefault(); activate(event);
                });
                return;
            }
            const activeBlock = getFlowGroupById(page.groupId);
            const resolveSurface = event => {
                if (_flowAuthoringComposing) return null;
                if (_flowCompare?.enabled && view !== _flowCanvasView) {
                    if (!_flowCompare.activateView(view, language)) return null;
                }
                if (getActiveBlock()?.id !== page.groupId) {
                    event.stopPropagation();
                    endHistoryGroup();
                    activateProjectionPage(page);
                    return _flowCanvasView.getPageElement(page.index);
                }
                return pageElement;
            };
            flowObjectToolbar.mount(pageElement,page,event=>{
                const surface=resolveSurface(event);if(!surface)return false;
                setSelectedFlowRuntimePageIndex(page.groupId,page.flowPageIndex);return true;
            });
            annotateTranslationPage(pageElement,page,activeBlock);
            pageElement.dataset.flowSourceMapping = page.isSourceFallback ? 'source-fallback' : 'ready';
            const editable = !page.isSourceFallback && ['horizontal-tb', 'vertical-rl'].includes(page.writingMode);
            pageElement.dataset.flowDirectCapability = editable ? 'editable' : 'unavailable';
            pageElement.setAttribute('aria-label', getUILang()==='en'?`Flow page ${page.flowPageIndex+1}. Click text to edit`:`Flow生成ページ ${page.flowPageIndex + 1}。本文をクリックして編集`);
            pageElement.addEventListener('pointerdown', event => {
                const surface = resolveSurface(event);
                if (surface) handleFlowPagePointerDown(event, getFlowGroupById(page.groupId), page, surface);
            });
            // Touch remains available for horizontal scrolling; a tap opens editing.
            pageElement.addEventListener('click', event => {
                if (event.pointerType === 'touch') {
                    const surface = resolveSurface(event);
                    if (surface) handleFlowGeneratedPageSourceClick(event, getFlowGroupById(page.groupId), page, surface);
                }
                event.stopPropagation();
            });
            pageElement.addEventListener('dblclick', event => {
                event.preventDefault();
                const proxy = _flowDirectEditProxy;
                const session = _flowDirectEditSession;
                if (!proxy || !session || _flowAuthoringComposing) return;
                const offset = proxy.selectionStart;
                const words = [...new Intl.Segmenter(session.languageKey, { granularity: 'word' }).segment(proxy.value)];
                const word = words.find(item => offset >= item.index && offset < item.index + item.segment.length);
                if (word) {
                    proxy.setSelectionRange(word.index, word.index + word.segment.length);
                    updateFlowDirectSelectionFromProxy(proxy);
                }
            });
        },
    });
    return view;
}

function renderEditorFlowGeneratedPage(activeBlock, projection) {
    const render = document.getElementById('content-render');
    if (!render || activeBlock?.kind !== 'flow') return;
    if (_flowDirectEditProxy && _flowDirectEditSession?.groupId === activeBlock.id) {
        updateFlowDirectSelectionFromProxy(_flowDirectEditProxy, { allowPending: true, navigate: false });
    }
    const groupPages = projection.pages.filter((page) => (
        page.kind === 'flow' && page.groupId === activeBlock.id
    ));
    if (!groupPages.length) {
        clearFlowDirectEditRuntime();
        hideFlowCanvas();
        render.innerHTML = `
            <div id="flow-readonly-placeholder" data-flow-preview-state="error">
                <span class="material-icons">error_outline</span>
                <strong>Flowページを表示できません</strong>
                <span>原稿のページ生成結果が空です。</span>
            </div>`;
        return;
    }
    let selectedIndex = setSelectedFlowRuntimePageIndex(
        activeBlock.id,
        getSelectedFlowRuntimePageIndex(activeBlock.id),
        groupPages.length,
    );
    if (isFlowDirectEditing(activeBlock.id)) {
        try {
            const location = findFlowSourcePointInPages(
                groupPages,
                getFlowEditorSelection(activeBlock.id),
            );
            if (location) {
                selectedIndex = setSelectedFlowRuntimePageIndex(
                    activeBlock.id,
                    location.pageIndex,
                    groupPages.length,
                );
            }
        } catch (_) {
            // A history restore clamps the source point before the next render.
        }
    }
    const page = groupPages[selectedIndex];
    const pageLabel = getPageDisplayLabel(
        page.index,
        projection.totalPageCount,
        state.book,
        state.bookMode,
    );
    render.classList.add('flow-editor-preview-active');
    clearFlowDirectEditRuntime({ resetComposition: false, preserveSelection: true });
    render.replaceChildren();
    const canvas = ensureFlowCanvasView();
    document.getElementById('canvas-stage').hidden = true;
    document.getElementById('canvas-view').classList.add('flow-canvas-active', 'editor-unified-canvas');
    _flowCanvasContextKey = `${activeBlock.id}:${page.languageKey}`;
    canvas.viewport.setAttribute('aria-label', t('editor_canvas_label'));
    canvas.update(projection.pages, page.index, `${state.projectId || 'local'}:${projection.languageKey}`);
    _flowCompare?.update(canvas, projection);
    canvasScale = canvas.getScale();
    syncCanvasZoomUI();
    const pageElement = canvas.getPageElement(page.index);
    const supportedDirectWritingMode = page.writingMode === 'horizontal-tb'
        || page.writingMode === 'vertical-rl';
    const directCapability = page.isSourceFallback
        || !supportedDirectWritingMode
        ? 'unavailable'
        : 'editable';
    pageElement.dataset.flowDirectCapability = directCapability;
    if (!page.isSourceFallback) {
        const pageActionLabel = directCapability === 'editable'
            ? '本文をクリックすると直接編集を開始します'
            : '本文をクリックすると対応する原稿位置へ移動します';
        pageElement.setAttribute('aria-label', `Flow生成ページ。${pageActionLabel}`);
    }
    if (isFlowDirectEditing(activeBlock.id)) {
        const directSession = tryCreateFlowDirectEditSession(
            activeBlock,
            page,
            getFlowEditorSelection(activeBlock.id),
        );
        if (directSession) {
            mountFlowDirectEditProxy(activeBlock, page, pageElement, directSession);
            moveFlowDirectProxyToPage(selectedIndex, false);
        }
        else selectFlowGeneratedPage(activeBlock.id);
    }
    render.dataset.flowPreviewState = 'ready';
    render.dataset.flowPageCount = String(groupPages.length);
    render.dataset.publicationPageCount = String(projection.totalPageCount);
    const pageLockNote = document.getElementById('page-lock-note');
    if (pageLockNote) {
        pageLockNote._flowStatus = { index: selectedIndex, count: groupPages.length, pageLabel,
            sourceLanguage: page.isSourceFallback ? page.languageKey : '',
            mapping: page.isSourceFallback ? '' : isFlowDirectEditing(activeBlock.id) && _flowDirectEditProxy
                ? 'editing' : directCapability === 'editable' ? 'editable' : 'source' };
        pageLockNote.textContent = formatFlowPageStatus(pageLockNote._flowStatus, getUILang());
        pageLockNote.style.display = 'block';
    }
    syncPageNavigationSlider();
    syncEditorPageCounters();
}

function getFlowAuthoringSurface() {
    return _flowManuscriptCompare?.activeRoot() || document.getElementById('flow-authoring-surface');
}

function setFlowAuthoringSurfaceVisible(visible) {
    const surface = document.getElementById('flow-authoring-surface');
    const stage = document.getElementById('canvas-stage');
    if (surface) surface.hidden = !visible;
    if (visible) _flowCanvasView?.setVisible(false);
    if (stage) stage.hidden = !!visible || !!(_flowCanvasView && !_flowCanvasView.viewport.hidden);
    document.getElementById('canvas-view')?.classList.toggle('flow-authoring-active', !!visible);
    syncMobileCanvasZoomBar();
}

function getFlowGroupById(groupId) {
    return (state.blocks || []).find((block) => block?.kind === 'flow' && block.id === groupId) || null;
}

function getFlowAuthoringLanguage(group) {
    return resolveFlowAuthoringLanguage(
        group,
        state.activeLang || state.defaultLang || '',
        state.languages || [],
    );
}

function getFlowAuthoringWritingMode(group, languageKey) {
    const savedMode = group?.flow?.layout?.typographyByLanguage?.[languageKey]?.writingMode;
    if (typeof savedMode === 'string' && isFlowWritingModeSupported(languageKey, savedMode)) return savedMode;
    const configuredMode = getWritingModeFromConfigs(languageKey, state.languageConfigs);
    if (isFlowWritingModeSupported(languageKey, configuredMode)) return configuredMode;
    return 'horizontal-tb';
}

function syncFlowAuthoringWritingModeControl(activeBlock, isFlowAuthoring = true) {
    const field = document.getElementById('flow-authoring-writing-mode-field');
    const select = document.getElementById('flow-authoring-writing-mode');
    const hint = document.getElementById('flow-authoring-writing-mode-hint');
    if (!field || !select || !hint) return;

    const sourceLanguage = String(activeBlock?.flow?.document?.sourceLanguage || '');
    const languageKey = activeBlock?.kind === 'flow' ? getFlowAuthoringLanguage(activeBlock) : '';
    const sourceAuthoring = !!isFlowAuthoring
        && activeBlock?.kind === 'flow'
        && isFlowSourceSelected(activeBlock.id)
        && !!sourceLanguage
        && languageKey === sourceLanguage;
    field.hidden = !sourceAuthoring;
    if (!sourceAuthoring) {
        select.onchange = null;
        delete select.dataset.flowGroupId;
        delete select.dataset.flowLanguageKey;
        return;
    }

    const supportedModes = FLOW_AUTHORING_WRITING_MODES.filter((mode) => (
        isFlowWritingModeSupported(languageKey, mode)
    ));
    [...select.options].forEach((option) => {
        option.disabled = !supportedModes.includes(option.value);
    });
    const currentMode = getFlowAuthoringWritingMode(activeBlock, languageKey);
    select.value = supportedModes.includes(currentMode) ? currentMode : (supportedModes[0] || 'horizontal-tb');
    select.disabled = _flowAuthoringComposing || supportedModes.length <= 1;
    select.dataset.flowGroupId = activeBlock.id;
    select.dataset.flowLanguageKey = languageKey;
    select.onchange = handleFlowAuthoringWritingModeChange;

    const hintKey = supportedModes.length <= 1
        ? 'flow_writing_mode_horizontal_only'
        : 'flow_writing_mode_hint';
    hint.dataset.i18n = hintKey;
    hint.textContent = t(hintKey);
}

function handleFlowAuthoringWritingModeChange(event) {
    const select = event?.target;
    if (!select) return;
    const groupId = String(select.dataset.flowGroupId || '');
    const languageKey = String(select.dataset.flowLanguageKey || '');
    const group = getFlowGroupById(groupId);
    const activeBlock = getActiveBlock();
    const sourceLanguage = String(group?.flow?.document?.sourceLanguage || '');
    const validSourceContext = group
        && activeBlock?.id === groupId
        && isFlowSourceSelected(groupId)
        && languageKey === sourceLanguage
        && getFlowAuthoringLanguage(group) === sourceLanguage;
    if (!validSourceContext || _flowAuthoringComposing) {
        syncFlowAuthoringWritingModeControl(
            activeBlock,
            activeBlock?.kind === 'flow' && isFlowSourceSelected(activeBlock.id),
        );
        return;
    }

    const writingMode = String(select.value || '');
    if (!isFlowWritingModeSupported(languageKey, writingMode)) {
        syncFlowAuthoringWritingModeControl(group, true);
        const hint = document.getElementById('flow-authoring-writing-mode-hint');
        if (hint) {
            hint.dataset.i18n = 'flow_writing_mode_unsupported';
            hint.textContent = t('flow_writing_mode_unsupported');
        }
        return;
    }
    if (getFlowAuthoringWritingMode(group, languageKey) === writingMode) return;

    const result = ensureFlowLanguageTypography(state.blocks || [], {
        groupId,
        languageKey,
        writingMode,
    });
    if (!result.changed) return;

    endHistoryGroup();
    pushState();
    updateHistoryButtons();
    clearFlowDirectEditRuntime();
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'blocks', value: result.blocks } });
    _flowAuthoringSourceRevision += 1;
    const updatedGroup = getFlowGroupById(groupId);
    if (updatedGroup) {
        renderFlowAuthoringSurface(updatedGroup, null);
        syncFlowAuthoringWritingModeControl(updatedGroup, true);
    }
    scheduleFlowAuthoringReflow(groupId, { immediate: true });
    triggerAutoSave();
}

function getFlowAuthoringGroupProjection(projection, groupId) {
    return projection?.flowGroups?.find((entry) => entry.groupId === groupId) || null;
}

function getFlowAuthoringLanguageFeedback(group, languageKey, options = {}) {
    const canReuse = options.reuse === true
        && _flowAuthoringLanguageFeedback?.groupId === group.id
        && _flowAuthoringLanguageFeedback?.languageKey === languageKey;
    if (canReuse) return _flowAuthoringLanguageFeedback;
    const feedback = Object.freeze({
        groupId: group.id,
        languageKey,
        languageProgress: getFlowLanguageProgress(group, languageKey),
        translationStatus: deriveFlowTranslationStatus(group, languageKey),
    });
    _flowAuthoringLanguageFeedback = feedback;
    return feedback;
}

function getFlowTranslationProviderOptions() {
    return listTranslationProviders().map((provider) => ({
        ...provider,
        available: provider.id !== BROWSER_TRANSLATOR_PROVIDER_ID
            || isBrowserTranslatorSupported(globalThis),
    }));
}

function normalizeFlowTranslationProviderSelection() {
    const providers = getFlowTranslationProviderOptions();
    const current = providers.find((provider) => (
        provider.id === _flowTranslationRuntime.providerId && provider.available !== false
    ));
    if (current) return current;
    const fallback = providers.find((provider) => provider.available !== false) || providers[0] || null;
    _flowTranslationRuntime.providerId = fallback?.id || '';
    return fallback;
}

function getFlowTranslationAutomation(group, languageKey) {
    const sourceLanguage = String(group?.flow?.document?.sourceLanguage || '');
    if (!group || !languageKey || languageKey === sourceLanguage) return null;
    const provider = normalizeFlowTranslationProviderSelection();
    const providerId = provider?.id || '';
    const models = _flowTranslationRuntime.modelsByProvider[providerId] || [];
    const modelState = _flowTranslationRuntime.modelStateByProvider[providerId] || 'idle';
    let modelId = _flowTranslationRuntime.modelIdByProvider[providerId] || '';
    if (!models.some((model) => model.id === modelId)) {
        modelId = models[0]?.id || '';
        _flowTranslationRuntime.modelIdByProvider[providerId] = modelId;
    }

    const job = _flowTranslationJob;
    const isCurrentJob = job?.groupId === group.id && job?.languageKey === languageKey;
    const anotherJobRunning = job?.state === 'running' && !isCurrentJob;
    let targetCount = isCurrentJob && job.state === 'running'
        ? Math.max(0, Number(job.total) || 0)
        : 0;
    let requestMessage = '';
    if (!(isCurrentJob && job.state === 'running')) {
        try {
            targetCount = createFlowTranslationRequest(group, {
                targetLang: languageKey,
                modelId,
            }).units.length;
        } catch (error) {
            requestMessage = error?.message || String(error);
        }
    }

    const jobState = isCurrentJob ? job.state : (anotherJobRunning ? 'running' : 'idle');
    const message = isCurrentJob
        ? job.message
        : anotherJobRunning
            ? '別のFlow原稿を翻訳中です。完了または中止してから実行してください。'
            : requestMessage || _flowTranslationRuntime.modelMessageByProvider[providerId] || '';
    return {
        providers: getFlowTranslationProviderOptions(),
        providerId,
        models,
        modelId,
        modelState,
        targetCount,
        jobState,
        message,
        canStart: provider?.available !== false
            && modelState === 'ready'
            && !!modelId
            && targetCount > 0
            && job?.state !== 'running',
    };
}

function refreshCanvasTranslationPanel() {
    const panel = document.getElementById('flow-canvas-translation-panel');
    if (!panel || panel.hidden) return;
    const group = getActiveBlock(), language = state.activeLang;
    if (group?.id !== panel.dataset.flowGroupId || language !== panel.dataset.languageKey) { panel.hidden = true; return; }
    const body = panel.querySelector('.flow-canvas-translation-body');
    renderFlowTranslationAutomationPanel(body, getFlowTranslationAutomation(group, language));
}

function openCanvasTranslationPanel(language) {
    const group = getActiveBlock(); if (group?.kind !== 'flow' || _flowAuthoringComposing) return;
    clearFlowDirectEditRuntime(); endHistoryGroup(); state.activeLang = language;
    selectFlowGeneratedPage(group.id); refresh();
    let panel = document.getElementById('flow-canvas-translation-panel');
    if (!panel) {
        panel = document.createElement('section'); panel.id = 'flow-canvas-translation-panel';
        panel.setAttribute('role','region'); panel.setAttribute('aria-label','自動翻訳');
        const close = document.createElement('button'); close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label','閉じる');
        close.onclick = () => { panel.hidden = true; };
        const body = document.createElement('div'); body.className = 'flow-canvas-translation-body';
        body.addEventListener('change',handleFlowAuthoringChange); body.addEventListener('click',handleFlowAuthoringAction);
        panel.append(close,body); document.getElementById('canvas-view').append(panel);
        panel.addEventListener('keydown',event=>{if(event.key==='Escape') {event.stopPropagation();panel.hidden=true;}});
    }
    panel.dataset.flowGroupId = group.id; panel.dataset.languageKey = language; panel.hidden = false;
    refreshCanvasTranslationPanel();
}

function refreshFlowTranslationAutomationSurface() {
    refreshCanvasTranslationPanel();
    const group = getActiveBlock();
    if (group?.kind !== 'flow' || !isFlowSourceSelected(group.id)) return;
    renderFlowAuthoringSurface(group, getEditorPageProjection());
}

function updateCurrentFlowTranslationAutomation() {
    refreshCanvasTranslationPanel();
    const root = getFlowAuthoringSurface();
    const group = getActiveBlock();
    if (!root || group?.kind !== 'flow') return;
    updateFlowTranslationAutomationView(
        root,
        getFlowTranslationAutomation(group, getFlowAuthoringLanguage(group)),
    );
}

async function loadFlowTranslationProviderModels(providerId, options = {}) {
    const providerKey = String(providerId || _flowTranslationRuntime.providerId || '');
    if (!providerKey) return [];
    if (
        options.force !== true
        && _flowTranslationRuntime.modelStateByProvider[providerKey] === 'ready'
        && _flowTranslationRuntime.modelsByProvider[providerKey]?.length
    ) {
        return _flowTranslationRuntime.modelsByProvider[providerKey];
    }

    _flowTranslationRuntime.modelStateByProvider[providerKey] = 'loading';
    _flowTranslationRuntime.modelMessageByProvider[providerKey] = '利用可能なモデルを取得しています…';
    refreshFlowTranslationAutomationSurface();
    try {
        const models = await listTranslationProviderModels(providerKey);
        _flowTranslationRuntime.modelsByProvider[providerKey] = models;
        _flowTranslationRuntime.modelStateByProvider[providerKey] = 'ready';
        const selected = _flowTranslationRuntime.modelIdByProvider[providerKey];
        if (!models.some((model) => model.id === selected)) {
            _flowTranslationRuntime.modelIdByProvider[providerKey] = models[0]?.id || '';
        }
        _flowTranslationRuntime.modelMessageByProvider[providerKey] = models.length
            ? `${models.length}件のモデルを取得しました。`
            : '利用可能なモデルがありません。';
        return models;
    } catch (error) {
        _flowTranslationRuntime.modelsByProvider[providerKey] = [];
        _flowTranslationRuntime.modelStateByProvider[providerKey] = 'error';
        _flowTranslationRuntime.modelMessageByProvider[providerKey] = error?.message || String(error);
        return [];
    } finally {
        refreshFlowTranslationAutomationSurface();
    }
}

function getFlowTranslationProgressMessage(progress = {}) {
    if (progress.phase === 'preparing') return '翻訳モデルを準備しています…';
    if (progress.phase === 'downloading') {
        return `翻訳モデルを準備しています… ${Math.round((Number(progress.loaded) || 0) * 100)}%`;
    }
    if (progress.phase === 'translating') {
        return `翻訳中… ${Number(progress.current) || 0} / ${Number(progress.total) || 0}`;
    }
    return '翻訳結果を確認しています…';
}

function cancelFlowTranslationJob() {
    if (_flowTranslationJob?.state !== 'running') return;
    _flowTranslationJob.message = '翻訳を中止しています…';
    _flowTranslationJob.controller?.abort?.();
    updateCurrentFlowTranslationAutomation();
}

function installFlowTranslationVerificationProvider(options = {}) {
    const providerId = 'flow-verification-provider';
    const delayMs = Math.max(0, Math.min(5000, Number(options.delayMs) || 25));
    const expansionFactor = Math.max(1, Math.min(4, Number(options.expansionFactor) || 1));
    const requestedFailUnitIndex = Number(options.failUnitIndex);
    const failUnitIndex = Number.isInteger(requestedFailUnitIndex) && requestedFailUnitIndex >= 0
        ? requestedFailUnitIndex
        : -1;
    registerTranslationProvider(providerId, {
        id: providerId,
        label: 'Flow verification provider',
        local: true,
        modelMode: 'fixed',
        defaultModelId: 'verification-model',
        defaultModelLabel: 'Verification model',
        async translate(request, context = {}) {
            context.onProgress?.({
                phase: 'translating',
                current: 0,
                total: request.units.length,
            });
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            if (context.signal?.aborted) return { units: [], cancelled: true };
            const units = request.units.map((unit, index) => {
                context.onProgress?.({
                    phase: 'translating',
                    current: index + 1,
                    total: request.units.length,
                });
                if (index === failUnitIndex) {
                    return {
                        unitId: unit.unitId,
                        text: '',
                        status: 'error',
                        error: 'Verification provider failed this unit.',
                    };
                }
                return {
                    unitId: unit.unitId,
                    text: unit.text
                        ? `[${request.targetLang}] ${unit.text.repeat(expansionFactor)}`
                        : '',
                    status: 'needs-review',
                };
            });
            return { units, cancelled: false };
        },
    });
    _flowTranslationRuntime.providerId = providerId;
    _flowTranslationRuntime.modelsByProvider[providerId] = [{
        id: 'verification-model',
        label: 'Verification model',
    }];
    _flowTranslationRuntime.modelIdByProvider[providerId] = 'verification-model';
    _flowTranslationRuntime.modelStateByProvider[providerId] = 'ready';
    _flowTranslationRuntime.modelMessageByProvider[providerId] = '';
    _flowTranslationJob = null;
    refreshFlowTranslationAutomationSurface();
    return providerId;
}

async function startFlowTranslationJob(groupId) {
    if (_flowTranslationJob?.state === 'running') return;
    const group = getFlowGroupById(groupId);
    if (!group) return;
    const languageKey = getFlowAuthoringLanguage(group);
    const sourceLanguage = group.flow?.document?.sourceLanguage;
    if (!languageKey || languageKey === sourceLanguage) return;

    const provider = normalizeFlowTranslationProviderSelection();
    const providerId = provider?.id || '';
    if (!providerId || provider?.available === false) return;
    if (_flowTranslationRuntime.modelStateByProvider[providerId] !== 'ready') {
        await loadFlowTranslationProviderModels(providerId);
    }
    const modelId = _flowTranslationRuntime.modelIdByProvider[providerId] || '';
    let request;
    try {
        request = createFlowTranslationRequest(getFlowGroupById(groupId), {
            targetLang: languageKey,
            modelId,
        });
    } catch (error) {
        _flowTranslationJob = {
            id: ++_flowTranslationJobSequence,
            groupId,
            languageKey,
            state: 'error',
            message: error?.message || String(error),
            controller: null,
        };
        updateCurrentFlowTranslationAutomation();
        return;
    }
    if (!request.units.length) {
        _flowTranslationJob = {
            id: ++_flowTranslationJobSequence,
            groupId,
            languageKey,
            state: 'success',
            message: '自動翻訳が必要な未翻訳・原文更新箇所はありません。',
            controller: null,
        };
        updateCurrentFlowTranslationAutomation();
        return;
    }

    const controller = new AbortController();
    const jobId = ++_flowTranslationJobSequence;
    _flowTranslationJob = {
        id: jobId,
        groupId,
        languageKey,
        total: request.units.length,
        state: 'running',
        message: `翻訳を開始しています… 0 / ${request.units.length}`,
        controller,
    };
    updateCurrentFlowTranslationAutomation();

    try {
        const response = await runTranslationProvider(request, {
            providerId,
            signal: controller.signal,
            onProgress(progress) {
                if (_flowTranslationJob?.id !== jobId) return;
                _flowTranslationJob.message = getFlowTranslationProgressMessage(progress);
                updateCurrentFlowTranslationAutomation();
            },
        });
        if (_flowTranslationJob?.id !== jobId) return;
        if (response.cancelled) {
            _flowTranslationJob = {
                ..._flowTranslationJob,
                state: 'cancelled',
                message: '翻訳を中止しました。原稿は変更されていません。',
                controller: null,
            };
            updateCurrentFlowTranslationAutomation();
            return;
        }

        const currentGroup = getFlowGroupById(groupId);
        const plan = createFlowTranslationApplyPlan(currentGroup, request, response);
        if (!plan.ready) {
            const failure = getFlowTranslationApplyFailurePresentation(plan, {
                totalCount: request.units.length,
            });
            _flowTranslationJob = {
                ..._flowTranslationJob,
                state: 'error',
                message: failure.message,
                failureKind: failure.kind,
                issues: plan.issues,
                controller: null,
            };
            updateCurrentFlowTranslationAutomation();
            return;
        }

        const existingWritingMode = currentGroup.flow?.layout?.typographyByLanguage?.[languageKey]?.writingMode;
        const authoringBlocks = ensureFlowLanguageTypography(state.blocks || [], {
            groupId,
            languageKey,
            writingMode: existingWritingMode
                || getWritingModeFromConfigs(languageKey, state.languageConfigs),
        }).blocks;
        const nextBlocks = applyFlowTranslationPlan(authoringBlocks, {
            groupId,
            targetLang: languageKey,
            plan,
        });
        endHistoryGroup();
        pushState();
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'blocks', value: nextBlocks } });
        updateHistoryButtons();
        _flowAuthoringSourceRevision += 1;
        _flowAuthoringLanguageFeedback = null;
        _flowTranslationJob = {
            ..._flowTranslationJob,
            state: 'success',
            message: `${plan.edits.length}件を一括適用しました。内容を確認してください。`,
            controller: null,
        };
        const updatedGroup = getFlowGroupById(groupId);
        if (updatedGroup && getActiveBlock()?.id === groupId) renderFlowAuthoringSurface(updatedGroup, null);
        scheduleFlowAuthoringReflow(groupId, { immediate: true });
        triggerAutoSave();
    } catch (error) {
        if (_flowTranslationJob?.id !== jobId) return;
        _flowTranslationJob = {
            ..._flowTranslationJob,
            state: controller.signal.aborted ? 'cancelled' : 'error',
            message: controller.signal.aborted
                ? '翻訳を中止しました。原稿は変更されていません。'
                : `翻訳に失敗しました。原稿は変更されていません。${error?.message ? ` ${error.message}` : ''}`,
            controller: null,
        };
        updateCurrentFlowTranslationAutomation();
    }
}

function updateActiveFlowAuthoringStatus(projection, options = {}) {
    const root = getFlowAuthoringSurface();
    const activeBlock = getActiveBlock();
    if (!root || activeBlock?.kind !== 'flow' || !isFlowSourceSelected(activeBlock.id)) return;
    const groupProjection = getFlowAuthoringGroupProjection(projection, activeBlock.id);
    const languageKey = getFlowAuthoringLanguage(activeBlock);
    const { languageProgress, translationStatus } = getFlowAuthoringLanguageFeedback(
        activeBlock,
        languageKey,
        { reuse: !projection && options.state !== 'error' },
    );
    const panelPageCount = document.getElementById('flow-authoring-page-count');
    if (panelPageCount) {
        if (!projection) {
            panelPageCount.textContent = '更新中';
        } else if (groupProjection?.isSourceFallback) {
            panelPageCount.textContent = translationStatus.body.counts.stale > 0
                ? '原文プレビュー（要更新）'
                : '原文プレビュー（未翻訳）';
        } else if (translationStatus.body.counts.untracked > 0) {
            panelPageCount.textContent = `${groupProjection?.pageCount || 0}ページ（状態未登録）`;
        } else if (translationStatus.hasOutlineIssues) {
            panelPageCount.textContent = `${groupProjection?.pageCount || 0}ページ（章名要確認）`;
        } else {
            panelPageCount.textContent = groupProjection?.pageCount ? `${groupProjection.pageCount}ページ` : '更新中';
        }
    }
    updateFlowAuthoringViewStatus(root, {
        state: options.state || (projection ? 'idle' : 'working'),
        pageCount: groupProjection?.pageCount || Number(root.dataset.pageCount) || 0,
        sourceRevision: _flowAuthoringSourceRevision,
        renderedRevision: projection ? _flowAuthoringRenderedRevision : _flowAuthoringRenderedRevision,
        changeSet: groupProjection?.changeSet,
        isSourceFallback: groupProjection?.isSourceFallback === true,
        languageProgress,
        translationStatus,
        message: options.message,
    });
    updateFlowTranslationAutomationView(
        root,
        getFlowTranslationAutomation(activeBlock, languageKey),
    );
    if (projection) {
        syncPageNavigationSlider();
        syncEditorPageCounters();
    }
}

function renderFlowAuthoringSurface(activeBlock, projection = getEditorPageProjection()) {
    const host = document.getElementById('flow-authoring-surface');
    if (!host || activeBlock?.kind !== 'flow') return;
    if (!_flowManuscriptCompare) _flowManuscriptCompare = createFlowManuscriptCompare({
        host, model:()=>state, canSwitch:()=>!_flowAuthoringComposing,
        activate:language=>{if (state.activeLang !== language) { endHistoryGroup(); state.activeLang=language; renderLangTabs(); }},
        rerender:()=>renderFlowAuthoringSurface(getActiveBlock()),
    });
    _flowManuscriptCompare.render(activeBlock,(root,language)=>renderSingleFlowManuscript(root,getFlowGroupById(activeBlock.id),projection,language));
}

function renderSingleFlowManuscript(root, activeBlock, projection, languageKey) {
    delete root.dataset.sourceMappedBlockId;
    delete root.dataset.sourceMappedGraphemeOffset;
    delete root.dataset.sourceMappedUtf16Offset;
    const { languageProgress, translationStatus } = getFlowAuthoringLanguageFeedback(activeBlock, languageKey);
    const translationAutomation = getFlowTranslationAutomation(activeBlock, languageKey);
    const groupProjection = getFlowAuthoringGroupProjection(projection, activeBlock.id);
    const scrollTop = root.scrollTop;
    renderFlowAuthoringView(root, {
        group: activeBlock,
        languageKey,
        pageCount: groupProjection?.pageCount || 0,
        translationStatus,
        translationAutomation,
        onInput: event=>{handleFlowAuthoringInput(event); _flowManuscriptCompare?.refreshOther(root);},
        onChange: handleFlowAuthoringChange,
        onAction: handleFlowAuthoringAction,
        onFocus: handleFlowAuthoringFocus,
        onBlur: () => endHistoryGroup(),
        onCompositionStart: handleFlowAuthoringCompositionStart,
        onCompositionEnd: handleFlowAuthoringCompositionEnd,
    });
    root.scrollTop = scrollTop;
    updateFlowAuthoringViewStatus(root, {
        state: projection ? 'idle' : 'working',
        pageCount: groupProjection?.pageCount || 0,
        sourceRevision: _flowAuthoringSourceRevision,
        renderedRevision: _flowAuthoringRenderedRevision,
        changeSet: groupProjection?.changeSet,
        isSourceFallback: groupProjection?.isSourceFallback === true,
        languageProgress,
        translationStatus,
    });
}

function getFlowAuthoringTarget(target) {
    const root = target?.closest?.('.flow-authoring-editor, #flow-authoring-surface, #flow-canvas-translation-panel');
    const blockElement = target?.closest?.('[data-testid="flow-block"]');
    const sectionElement = target?.closest?.('[data-testid="flow-section"]');
    return {
        root,
        groupId: String(target?.dataset?.flowGroupId || blockElement?.dataset?.flowGroupId || root?.dataset?.flowGroupId || ''),
        sectionId: String(target?.dataset?.flowSectionId || blockElement?.dataset?.flowSectionId || sectionElement?.dataset?.flowSectionId || ''),
        blockId: String(target?.dataset?.flowBlockId || blockElement?.dataset?.flowBlockId || ''),
        blockElement,
    };
}

function findFlowAuthoringValue(target, field, languageKey) {
    const group = getFlowGroupById(target.groupId);
    const section = group?.flow?.document?.sections?.find((entry) => entry?.id === target.sectionId);
    if (field === 'section-title') return section?.title?.[languageKey] || '';
    const block = section?.blocks?.find((entry) => entry?.id === target.blockId);
    if (field === 'block-text') return block?.texts?.[languageKey] || '';
    if (field === 'heading-level') return block?.level;
    return undefined;
}

function scheduleFlowAuthoringReflow(groupId, options = {}) {
    if (_flowAuthoringReflowTimer) clearTimeout(_flowAuthoringReflowTimer);
    _editorFlowProjectionController?.abort();
    _editorFlowProjectionController = null;
    _editorFlowProjectionRequestKey = '';
    _editorFlowProjectionRequestId += 1;
    invalidateFlowRuntimeAuthoring(groupId);
    updateActiveFlowAuthoringStatus(null, { state: 'working' });
    if (_flowAuthoringComposing) return;
    _flowAuthoringReflowTimer = setTimeout(() => {
        _flowAuthoringReflowTimer = null;
        const group = getFlowGroupById(groupId);
        if (group) requestEditorFlowProjection(group);
    }, options.immediate ? 0 : 140);
}

function applyFlowAuthoringEdit(operation, options = {}) {
    const historyKey = String(options.historyKey || '');
    if (
        _flowTranslationJob?.groupId === operation.groupId
        && _flowTranslationJob.state !== 'running'
    ) {
        _flowTranslationJob = null;
    }
    let authoringBlocks = state.blocks || [];
    const group = getFlowGroupById(operation.groupId);
    const languageKey = String(operation.languageKey || '');
    if (
        group
        && languageKey
        && languageKey !== group.flow?.document?.sourceLanguage
        && (operation.type === 'setText' || operation.type === 'setSectionTitle')
    ) {
        const existingWritingMode = group.flow?.layout?.typographyByLanguage?.[languageKey]?.writingMode;
        authoringBlocks = ensureFlowLanguageTypography(authoringBlocks, {
            groupId: operation.groupId,
            languageKey,
            writingMode: existingWritingMode
                || getWritingModeFromConfigs(languageKey, state.languageConfigs),
        }).blocks;
    }
    const nextBlocks = applyFlowAuthoringOperation(authoringBlocks, operation);
    if (options.recordHistory !== false) {
        pushState({
            ...(historyKey ? { groupKey: historyKey, mergeWindowMs: 900 } : {}),
            ...(options.editorFocus !== undefined ? { editorFocus: options.editorFocus } : {}),
        });
        updateHistoryButtons();
    }
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'blocks', value: nextBlocks } });
    _flowAuthoringSourceRevision += 1;
    if (options.rerender === true) {
        const activeGroup = getFlowGroupById(operation.groupId);
        if (activeGroup) renderFlowAuthoringSurface(activeGroup, null);
    }
    if (!_flowAuthoringComposing) {
        scheduleFlowAuthoringReflow(operation.groupId, { immediate: options.immediate === true });
        triggerAutoSave();
    }
    return nextBlocks;
}

function getFlowAuthoringSectionFromBlocks(blocks, groupId, sectionId) {
    const group = (blocks || []).find((block) => block?.kind === 'flow' && block.id === groupId);
    return group?.flow?.document?.sections?.find((section) => section?.id === sectionId) || null;
}

function restoreFlowAuthoringBlockFocus(blockId, sectionId, selection) {
    requestAnimationFrame(() => {
        const root = getFlowAuthoringSurface();
        const blockElement = [...(root?.querySelectorAll?.('[data-testid="flow-block"]') || [])]
            .find((entry) => entry.dataset.flowBlockId === blockId);
        const focusTarget = blockElement?.querySelector('.flow-authoring-input')
            || blockElement?.querySelector('[data-flow-action]')
            || [...(root?.querySelectorAll?.('[data-testid="flow-section"]') || [])]
                .find((entry) => entry.dataset.flowSectionId === sectionId)
                ?.querySelector('[data-flow-field="section-title"], [data-flow-action="insert"]');
        focusTarget?.focus?.({ preventScroll: true });
        if(selection && focusTarget?.setSelectionRange)focusTarget.setSelectionRange(selection.start,selection.end);
    });
}

function captureFlowAuthoringFocusSnapshot() {
    const activeElement = document.activeElement;
    if (!activeElement?.closest?.('#flow-authoring-surface')) return null;
    const target = getFlowAuthoringTarget(activeElement);
    return {
        mode: 'source',
        languageKey: target.root?.dataset.languageKey,
        groupId: target.groupId,
        sectionId: target.sectionId,
        blockId: target.blockId,
        field: String(activeElement.dataset?.flowField || ''),
        selectionStart: Number.isInteger(activeElement.selectionStart) ? activeElement.selectionStart : null,
        selectionEnd: Number.isInteger(activeElement.selectionEnd) ? activeElement.selectionEnd : null,
        selectionDirection: activeElement.selectionDirection || 'none',
    };
}

function captureFlowDirectEditFocusSnapshot() {
    const proxy = _flowDirectEditProxy;
    const session = _flowDirectEditSession;
    if (!proxy?.isConnected || !session || !isFlowDirectEditing(session.groupId)) return null;
    return {
        mode: 'direct',
        groupId: session.groupId,
        sectionId: session.sectionId,
        blockId: session.blockId,
        languageKey: session.languageKey,
        selectionStart: Number.isInteger(proxy.selectionStart) ? proxy.selectionStart : session.selectionStart,
        selectionEnd: Number.isInteger(proxy.selectionEnd) ? proxy.selectionEnd : session.selectionEnd,
        selectionDirection: proxy.selectionDirection || session.selectionDirection || 'none',
    };
}

function restoreFlowDirectEditFocusSnapshot(snapshot) {
    _flowDirectPreferredInlinePosition = null;
    if (snapshot?.mode !== 'direct') return false;
    const group = getFlowGroupById(snapshot.groupId);
    const languageKey = String(snapshot.languageKey || '');
    const section = group?.flow?.document?.sections?.find((entry) => entry?.id === snapshot.sectionId);
    const block = section?.blocks?.find((entry) => entry?.id === snapshot.blockId);
    if (
        !group
        || getFlowAuthoringLanguage(group) !== languageKey
        || (languageKey !== group.flow.document.sourceLanguage && !Object.hasOwn(block?.texts || {}, languageKey))
        || (block?.type !== 'heading' && block?.type !== 'paragraph')
    ) {
        if (group) selectFlowGeneratedPage(group.id);
        return false;
    }
    const text = String(block.texts?.[languageKey] || '');
    const start = Math.max(0, Math.min(Number(snapshot.selectionStart) || 0, text.length));
    const end = Math.max(start, Math.min(Number(snapshot.selectionEnd) || start, text.length));
    const direction = snapshot.selectionDirection === 'backward' ? 'backward' : 'none';
    const focusOffset = direction === 'backward' ? start : end;
    const mapped = mapFlowTextUtf16OffsetToGrapheme(
        text,
        focusOffset,
        languageKey,
        direction === 'backward' ? 'backward' : 'forward',
    );
    selectFlowDirectEditing(group.id, {
        sectionId: section.id,
        blockId: block.id,
        languageKey,
        graphemeOffset: mapped.graphemeOffset,
        utf16Offset: mapped.utf16Offset,
        affinity: direction === 'backward' ? 'backward' : 'forward',
        selectionStart: start,
        selectionEnd: end,
        selectionDirection: direction,
    });
    return true;
}

function captureFlowEditorFocusSnapshot() {
    return captureFlowDirectEditFocusSnapshot() || captureFlowAuthoringFocusSnapshot();
}

function restoreFlowAuthoringFocusSnapshot(snapshot) {
    if (!snapshot) return;
    requestAnimationFrame(() => {
        const root = [...document.querySelectorAll('.flow-authoring-editor')].find(el => !el.hidden && el.dataset.languageKey === snapshot.languageKey) || getFlowAuthoringSurface();
        const candidates = [...(root?.querySelectorAll?.(`[data-flow-field="${snapshot.field}"]`) || [])];
        const focusTarget = candidates.find((entry) => {
            const target = getFlowAuthoringTarget(entry);
            return target.groupId === snapshot.groupId
                && target.sectionId === snapshot.sectionId
                && target.blockId === snapshot.blockId;
        });
        if (!focusTarget) {
            restoreFlowAuthoringBlockFocus(snapshot.blockId, snapshot.sectionId);
            return;
        }
        focusTarget.focus({ preventScroll: true });
        if (snapshot.selectionStart !== null && typeof focusTarget.setSelectionRange === 'function') {
            const max = String(focusTarget.value || '').length;
            focusTarget.setSelectionRange(
                Math.min(snapshot.selectionStart, max),
                Math.min(snapshot.selectionEnd ?? snapshot.selectionStart, max),
                snapshot.selectionDirection,
            );
        }
    });
}

function getFlowAnnotationTarget(element) {
    const source = element?.closest?.('[data-testid="flow-block"]');
    if(source){
        const input=source.querySelector('[data-flow-field="block-text"]');
        const root=source.closest('.flow-authoring-editor, #flow-authoring-surface');
        if(!input || !root)return null;
        return {groupId:root.dataset.flowGroupId,sectionId:source.dataset.flowSectionId,blockId:source.dataset.flowBlockId,
            languageKey:root.dataset.languageKey,start:input.selectionStart,end:input.selectionEnd,sourceMode:true,input,editorFocus:captureFlowEditorFocusSnapshot()};
    }
    const session=_flowDirectEditSession,proxy=_flowDirectEditProxy;
    if(!session || !proxy || _flowTextSelection || proxy.dataset.flowReflowPending==='true')return null;
    const pageElement=element?.closest?.('.flow-editor-page-surface');
    if(pageElement){
        const entry=getEditorPageProjection()?.pages[Number(pageElement.dataset.publicationIndex)];
        const fragmentElement=element.closest('.flow-dom-block');
        const fragment=entry?.page?.fragments[Number(fragmentElement?.dataset.flowFragmentIndex)];
        if(entry?.groupId!==session.groupId || (fragment && fragment.blockId!==session.blockId))return null;
    }
    return {...session,start:proxy.selectionStart,end:proxy.selectionEnd,sourceMode:false,editorFocus:captureFlowEditorFocusSnapshot()};
}

function showFlowAnnotationDialog(target, initialFocus = 'reading') {
    if(!target || _flowAuthoringComposing)return;
    const group=getFlowGroupById(target.groupId);
    const block=group?.flow.document.sections.find(s=>s.id===target.sectionId)?.blocks.find(b=>b.id===target.blockId);
    if(!block || typeof block.texts?.[target.languageKey]!=='string')return;
    const editorFocus=target.editorFocus || captureFlowEditorFocusSnapshot();
    const expectedAnnotations=JSON.stringify(block.annotations?.[target.languageKey] || []);
    const expectedText=block.texts[target.languageKey];
    const opened=openAnnotationDialog({source:group.flow.document,...target,initialFocus,range:{start:target.start,end:target.end},onApply:next=>{
        const annotations=next.sections.find(s=>s.id===target.sectionId).blocks.find(b=>b.id===target.blockId).annotations?.[target.languageKey] || [];
        if(JSON.stringify(annotations)===expectedAnnotations)return;
        endHistoryGroup();
        applyFlowAuthoringEdit({type:'setAnnotations',groupId:target.groupId,sectionId:target.sectionId,blockId:target.blockId,
            languageKey:target.languageKey,expectedText,expectedAnnotations,annotations},
            {immediate:true,rerender:target.sourceMode,editorFocus});
    },onClose:()=>{
        if(target.sourceMode)restoreFlowAuthoringBlockFocus(target.blockId,target.sectionId,target);
        else _flowDirectEditProxy?.focus({preventScroll:true});
    }});
    if(!opened)setFlowAuthoringInteractionNote('本文から対象の文字を選択してください。設定済みのルビ・圏点は親文字にカーソルを置いて編集できます。');
}

document.addEventListener('mousedown',event=>{if(event.target.closest('[data-flow-annotation-button]'))event.preventDefault();});
document.addEventListener('click',event=>{
    const button=event.target.closest('[data-flow-annotation-button]');
    if(button && !button.disabled)showFlowAnnotationDialog(getFlowAnnotationTarget(button),button.dataset.flowAnnotationFocus);
});
document.addEventListener('contextmenu',event=>{
    if(!event.target.closest('.flow-authoring-input, .flow-editor-page-surface'))return;
    const target=getFlowAnnotationTarget(event.target);
    if(!target)return;
    event.preventDefault();
    document.querySelector('[data-flow-annotation-menu]')?.remove();
    const menu=document.createElement('div');menu.dataset.flowAnnotationMenu='';menu.className='flow-annotation-menu';menu.setAttribute('role','menu');
    const button=document.createElement('button');button.textContent='ルビ・圏点…';button.setAttribute('role','menuitem');menu.append(button);
    document.body.append(menu);menu.style.left=Math.min(event.clientX,innerWidth-menu.offsetWidth-8)+'px';menu.style.top=Math.min(event.clientY,innerHeight-menu.offsetHeight-8)+'px';
    const close=()=>{menu.remove();document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',escape,true);};
    const outside=e=>{if(!menu.contains(e.target))close();};const escape=e=>{if(e.key==='Escape')close();};
    button.onclick=()=>{close();showFlowAnnotationDialog(target);};document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',escape,true);button.focus();
});

function handleFlowAuthoringInput(event) {
    if (event.isComposing || event.target?._composing) return;
    const field = event.target?.dataset?.flowField;
    if (field !== 'block-text' && field !== 'section-title') return;
    const target = getFlowAuthoringTarget(event.target);
    const group = getFlowGroupById(target.groupId);
    const languageKey = String(target.root?.dataset?.languageKey || getFlowAuthoringLanguage(group));
    if (!group || !languageKey) return;
    const value = event.target.value;
    if (findFlowAuthoringValue(target, field, languageKey) === value) {
        const block=group.flow.document.sections.flatMap(section=>section.blocks).find(block=>block.id===target.blockId);
        if(block)refreshFlowRichInput(event.target,block,languageKey);
        return;
    }
    try {
    event.target.classList?.remove('is-translation-missing');
    if (field === 'section-title') {
        const outlineButton = [...(target.root?.querySelectorAll?.('.flow-authoring-outline [data-flow-section-id]') || [])]
            .find((entry) => entry.dataset.flowSectionId === target.sectionId);
        if (outlineButton) outlineButton.textContent = value || '名称未設定';
    }
    selectFlowSource(target.groupId, { sectionId: target.sectionId, blockId: target.blockId });
    applyFlowAuthoringEdit({
        type: field === 'section-title' ? 'setSectionTitle' : 'setText',
        groupId: target.groupId,
        sectionId: target.sectionId,
        blockId: target.blockId,
        languageKey,
        text: value,
    }, {
        historyKey: `flow:${target.groupId}:${target.sectionId}:${target.blockId || 'title'}:${languageKey}`,
    });
    } catch {
        event.target.value = findFlowAuthoringValue(target,field,languageKey) || '';
        setFlowDirectEditNote('ルビ・圏点の途中では改行できません。対象の注釈を解除または変更してください。');
    }
    const current = getFlowGroupById(target.groupId)?.flow.document.sections.flatMap(s=>s.blocks).find(b=>b.id===target.blockId);
    if(current) refreshFlowRichInput(event.target,current,languageKey);
}

function handleFlowAuthoringChange(event) {
    const field = event.target?.dataset?.flowField;
    if (field === 'translation-provider') {
        const providerId = String(event.target.value || '');
        const provider = getFlowTranslationProviderOptions().find((entry) => (
            entry.id === providerId && entry.available !== false
        ));
        if (!provider || _flowTranslationJob?.state === 'running') return;
        _flowTranslationRuntime.providerId = providerId;
        _flowTranslationJob = null;
        refreshFlowTranslationAutomationSurface();
        if (_flowTranslationRuntime.modelStateByProvider[providerId] !== 'ready') {
            void loadFlowTranslationProviderModels(providerId);
        }
        return;
    }
    if (field === 'translation-model') {
        if (_flowTranslationJob?.state === 'running') return;
        const providerId = _flowTranslationRuntime.providerId;
        const modelId = String(event.target.value || '');
        const models = _flowTranslationRuntime.modelsByProvider[providerId] || [];
        if (models.some((model) => model.id === modelId)) {
            _flowTranslationRuntime.modelIdByProvider[providerId] = modelId;
            _flowTranslationJob = null;
            updateCurrentFlowTranslationAutomation();
        }
        return;
    }
    if (field !== 'heading-level') return;
    const target = getFlowAuthoringTarget(event.target);
    const group = getFlowGroupById(target.groupId);
    if (!group || getFlowAuthoringLanguage(group) !== group.flow?.document?.sourceLanguage) return;
    const level = Number(event.target.value);
    if (findFlowAuthoringValue(target, 'heading-level', group.flow.document.sourceLanguage) === level) return;
    endHistoryGroup();
    applyFlowAuthoringEdit({
        type: 'setHeadingLevel',
        groupId: target.groupId,
        sectionId: target.sectionId,
        blockId: target.blockId,
        level,
    }, { immediate: true });
}

function handleFlowAuthoringAction(event) {
    const button = event.target?.closest?.('[data-flow-action]');
    if (!button) return;
    const action = button.dataset.flowAction;
    const target = getFlowAuthoringTarget(button);
    if (action === 'jump-section') {
        const section = [...(getFlowAuthoringSurface()?.querySelectorAll?.('[data-testid="flow-section"]') || [])]
            .find((entry) => entry.dataset.flowSectionId === button.dataset.flowSectionId);
        section?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
        return;
    }
    const group = getFlowGroupById(target.groupId);
    if (!group) return;
    const languageKey = getFlowAuthoringLanguage(group);
    if (action === 'refresh-translation-models') {
        if (languageKey === group.flow?.document?.sourceLanguage || _flowTranslationJob?.state === 'running') return;
        event.preventDefault();
        _flowTranslationJob = null;
        void loadFlowTranslationProviderModels(_flowTranslationRuntime.providerId, { force: true });
        return;
    }
    if (action === 'start-translation') {
        if (languageKey === group.flow?.document?.sourceLanguage) return;
        event.preventDefault();
        void startFlowTranslationJob(group.id);
        return;
    }
    if (action === 'cancel-translation') {
        event.preventDefault();
        cancelFlowTranslationJob();
        return;
    }
    if (action === 'confirm-translation') {
        if (languageKey === group.flow?.document?.sourceLanguage) return;
        event.preventDefault();
        endHistoryGroup();
        applyFlowAuthoringEdit({
            type: 'confirmTranslation',
            groupId: target.groupId,
            languageKey,
        }, { rerender: true, immediate: true });
        return;
    }
    if (languageKey !== group.flow?.document?.sourceLanguage) return;
    if (!target.groupId || !target.sectionId) return;
    event.preventDefault();
    endHistoryGroup();
    if (action === 'insert') {
        const nextBlocks = applyFlowAuthoringEdit({
            type: 'insertBlock',
            groupId: target.groupId,
            sectionId: target.sectionId,
            afterBlockId: target.blockId || null,
            blockType: button.dataset.flowBlockType,
            languageKey: getFlowGroupById(target.groupId)?.flow?.document?.sourceLanguage || 'ja',
        }, { rerender: true, immediate: true });
        const nextSection = getFlowAuthoringSectionFromBlocks(nextBlocks, target.groupId, target.sectionId);
        const afterIndex = target.blockId
            ? nextSection?.blocks?.findIndex((block) => block?.id === target.blockId)
            : (nextSection?.blocks?.length ?? 1) - 2;
        const insertedBlock = nextSection?.blocks?.[Math.max(0, Number(afterIndex) + 1)];
        restoreFlowAuthoringBlockFocus(insertedBlock?.id || '', target.sectionId);
        return;
    }
    if (action === 'remove') {
        const previousSection = getFlowAuthoringSectionFromBlocks(state.blocks, target.groupId, target.sectionId);
        const previousIndex = previousSection?.blocks?.findIndex((block) => block?.id === target.blockId) ?? -1;
        const nextBlocks = applyFlowAuthoringEdit({
            type: 'removeBlock',
            groupId: target.groupId,
            sectionId: target.sectionId,
            blockId: target.blockId,
        }, { rerender: true, immediate: true });
        const nextSection = getFlowAuthoringSectionFromBlocks(nextBlocks, target.groupId, target.sectionId);
        const focusBlock = nextSection?.blocks?.[Math.min(Math.max(previousIndex, 0), Math.max(0, nextSection.blocks.length - 1))];
        restoreFlowAuthoringBlockFocus(focusBlock?.id || '', target.sectionId);
        return;
    }
    if (action === 'move') {
        applyFlowAuthoringEdit({
            type: 'moveBlock',
            groupId: target.groupId,
            sectionId: target.sectionId,
            blockId: target.blockId,
            delta: Number(button.dataset.flowDelta),
        }, { rerender: true, immediate: true });
        restoreFlowAuthoringBlockFocus(target.blockId, target.sectionId);
    }
}

function handleFlowAuthoringFocus(event) {
    const target = getFlowAuthoringTarget(event.target);
    if (!target.groupId) return;
    selectFlowSource(target.groupId, { sectionId: target.sectionId, blockId: target.blockId, languageKey:target.root?.dataset.languageKey });
    syncFlowPageSourceControls();
}

function handleFlowAuthoringCompositionStart() {
    _flowAuthoringComposing = true;
    const root = getFlowAuthoringSurface();
    if (root) root.dataset.composing = 'true';
    const activeBlock = getActiveBlock();
    syncFlowAuthoringWritingModeControl(activeBlock, activeBlock?.kind === 'flow' && isFlowSourceSelected(activeBlock.id));
    if (_flowAuthoringReflowTimer) clearTimeout(_flowAuthoringReflowTimer);
    _flowAuthoringReflowTimer = null;
}

function handleFlowAuthoringCompositionEnd(event) {
    _flowAuthoringComposing = false;
    handleFlowAuthoringInput({target:event.target});
    _flowManuscriptCompare?.refreshOther(getFlowAuthoringTarget(event.target).root);
    const root = getFlowAuthoringSurface();
    if (root) root.dataset.composing = 'false';
    const target = getFlowAuthoringTarget(event.target);
    const activeBlock = getActiveBlock();
    syncFlowAuthoringWritingModeControl(activeBlock, activeBlock?.kind === 'flow' && isFlowSourceSelected(activeBlock.id));
    if (target.groupId) scheduleFlowAuthoringReflow(target.groupId, { immediate: true });
    triggerAutoSave();
}

function clampEditorFlowProjectionSelection(activeBlock, projection) {
    if (activeBlock?.kind !== 'flow') return;
    const pageCount = projection.pages.filter((page) => (
        page.kind === 'flow' && page.groupId === activeBlock.id
    )).length;
    setSelectedFlowRuntimePageIndex(
        activeBlock.id,
        getSelectedFlowRuntimePageIndex(activeBlock.id),
        pageCount,
    );
}

function getFlowProjectionErrorMessage(error) {
    if (error?.code === 'FLOW_LANGUAGE_TYPOGRAPHY_MISSING') {
        return t('language_missing_settings');
    }
    if (error?.code === 'MAX_PAGES_EXCEEDED') {
        return 'ページ数が安全上限を超えました。';
    }
    return error?.message || 'Flowページの生成に失敗しました。';
}

function getEditorFlowProjectionLanguage(projectionTarget) {
    const sourceLanguage = projectionTarget?.flow?.document?.sourceLanguage || state.defaultLang || 'ja';
    return projectionTarget?.kind === 'flow'
        ? getFlowAuthoringLanguage(projectionTarget)
        : state.activeLang || state.defaultLang || sourceLanguage;
}

function pauseFlowDirectEditForProjection(activeBlock) {
    const proxy = _flowDirectEditProxy;
    if (!proxy || _flowDirectEditSession?.groupId !== activeBlock?.id || _flowAuthoringComposing) return;
    updateFlowDirectSelectionFromProxy(proxy, { allowPending: true, navigate: false });
    proxy.dataset.flowReflowPending = 'true';
    proxy._flowDirectPageElement?.classList.add('flow-direct-edit-reflow-pending');
    syncFlowDirectFormatControls();
}

function requestEditorFlowProjection(activeBlock) {
    if (activeBlock?.kind !== 'flow') return;
    if (_flowAuthoringComposing) {
        if (_flowDirectEditSession?.groupId === activeBlock.id && _flowDirectEditProxy) {
            _flowDirectEditProxy.dataset.flowCompositionResumeReflow = 'true';
        }
        return;
    }
    const languageKey = getEditorFlowProjectionLanguage(activeBlock);
    const requestKey = createFlowRuntimeProjectionSignature(state, languageKey, state.sections || [], document, editorFlowScope());
    const cached = getCachedFlowRuntimePageProjection(state, languageKey, state.sections || [], document, editorFlowScope());
    if (cached) {
        _editorFlowProjectionController?.abort();
        _editorFlowProjectionController = null;
        _editorFlowProjectionRequestKey = '';
        _editorFlowProjectionRequestId += 1;
        const currentBlock = getActiveBlock();
        clampEditorFlowProjectionSelection(currentBlock, cached);
        if (currentBlock?.kind === 'flow') {
            renderThumbs();
            _flowAuthoringRenderedRevision = _flowAuthoringSourceRevision;
            if (isFlowSourceSelected(currentBlock.id)) updateActiveFlowAuthoringStatus(cached);
            else renderEditorFlowGeneratedPage(currentBlock, cached);
        } else if (!state.sections?.[state.activeIdx]) {
            const flowBlockIndex = (state.blocks || []).findIndex((block) => block?.id === activeBlock.id);
            if (flowBlockIndex >= 0) changeBlock(flowBlockIndex, refreshForThumbSelection);
        } else {
            renderThumbs();
            syncPageNavigationSlider();
            syncEditorPageCounters();
            renderUnifiedFixedCanvas();
        }
        return;
    }
    pauseFlowDirectEditForProjection(activeBlock);
    if (_editorFlowProjectionRequestKey === requestKey && _editorFlowProjectionController) return;

    _editorFlowProjectionController?.abort();
    const controller = new AbortController();
    const requestId = _editorFlowProjectionRequestId + 1;
    _editorFlowProjectionRequestId = requestId;
    _editorFlowProjectionRequestKey = requestKey;
    _editorFlowProjectionController = controller;
    const render = document.getElementById('content-render');
    if (render) render.dataset.flowPreviewState = 'working';
    updateActiveFlowAuthoringStatus(null, { state: 'working' });

    void createFlowRuntimePageProjection(state, {
        ownerDocument: document,
        sessionScope: editorFlowScope(),
        fixedPages: state.sections || [],
        languageKey,
        revision: requestId,
        signal: controller.signal,
        onProgress(progress) {
            if (requestId !== _editorFlowProjectionRequestId || controller.signal.aborted) return;
            const status = document.querySelector('#flow-readonly-placeholder [data-flow-progress]');
            if (status) status.textContent = `ページ生成中… ${progress.generatedPageCount}ページ`;
        },
    }).then((projection) => {
        if (
            controller.signal.aborted
            || requestId !== _editorFlowProjectionRequestId
            || requestKey !== createFlowRuntimeProjectionSignature(state, languageKey, state.sections || [], document, editorFlowScope())
            || languageKey !== getEditorFlowProjectionLanguage(getActiveBlock())
        ) return;
        _editorFlowProjectionController = null;
        _editorFlowProjectionRequestKey = '';
        _flowAuthoringRenderedRevision = _flowAuthoringSourceRevision;
        const currentBlock = getActiveBlock();
        clampEditorFlowProjectionSelection(currentBlock, projection);
        renderThumbs();
        if (currentBlock?.kind === 'flow') {
            if (isFlowSourceSelected(currentBlock.id)) updateActiveFlowAuthoringStatus(projection);
            else renderEditorFlowGeneratedPage(currentBlock, projection);
        } else if (!state.sections?.[state.activeIdx]) {
            const flowBlockIndex = (state.blocks || []).findIndex((block) => block?.id === activeBlock.id);
            if (flowBlockIndex >= 0) changeBlock(flowBlockIndex, refreshForThumbSelection);
        } else {
            syncPageNavigationSlider();
            syncEditorPageCounters();
            renderUnifiedFixedCanvas();
        }
        flowSearch.update();refreshEditorLanguagePresentation();
    }).catch((error) => {
        if (error?.name === 'AbortError' || controller.signal.aborted) return;
        console.error('[Flow pages] Editor preview failed:', error);
        if (
            requestId !== _editorFlowProjectionRequestId
            || languageKey !== getEditorFlowProjectionLanguage(getActiveBlock())
        ) return;
        _editorFlowProjectionController = null;
        _editorFlowProjectionRequestKey = '';
        const currentBlock = getActiveBlock();
        if (currentBlock?.kind !== 'flow') return;
        if (isFlowSourceSelected(currentBlock.id)) {
            updateActiveFlowAuthoringStatus(null, {
                state: 'error',
                message: getFlowProjectionErrorMessage(error),
            });
            return;
        }
        clearFlowDirectEditRuntime();
        hideFlowCanvas();
        selectFlowGeneratedPage(currentBlock.id);
        const currentRender = document.getElementById('content-render');
        if (!currentRender) return;
        currentRender.innerHTML = `
            <div id="flow-readonly-placeholder" data-flow-preview-state="error">
                <span class="material-icons">error_outline</span>
                <strong>Flowページを表示できません</strong>
                <span>${escapeStudioHtml(getFlowProjectionErrorMessage(error))}</span>
            </div>`;
        currentRender.dataset.flowPreviewState = 'error';
        const pageLockNote = document.getElementById('page-lock-note');
        if (pageLockNote) {
            pageLockNote.textContent = `Flowページを表示できません: ${getFlowProjectionErrorMessage(error)}`;
            pageLockNote.style.display = 'block';
        }
    });
}

function handleEditorFlowRuntimeInvalidated() {
    if (getCurrentRoom() !== 'editor' || !hasFlowGroups(state)) return;
    _editorFlowProjectionController?.abort();
    _editorFlowProjectionController = null;
    _editorFlowProjectionRequestKey = '';
    _editorFlowProjectionRequestId += 1;
    const activeBlock = getActiveBlock();
    if (_flowAuthoringComposing) {
        if (_flowDirectEditProxy) _flowDirectEditProxy.dataset.flowCompositionResumeReflow = 'true';
        return;
    }
    if (activeBlock?.kind === 'flow' && isFlowSourceSelected(activeBlock.id)) {
        updateActiveFlowAuthoringStatus(null, { state: 'working' });
        if (!_flowAuthoringComposing) requestEditorFlowProjection(activeBlock);
        return;
    }
    refresh();
}
document.addEventListener(FLOW_RUNTIME_INVALIDATED_EVENT, handleEditorFlowRuntimeInvalidated);

function getEditorPresentationState() {
    const projection = getEditorPageProjection();
    const projectionIndex = getActiveProjectionPageIndex(projection);
    if (projection && projectionIndex >= 0) {
        const total = projection.totalPageCount;
        return {
            projection,
            activeIndex: projectionIndex,
            total,
            label: getPageDisplayLabel(projectionIndex, total, state.book, state.bookMode),
            readableTotal: getReadablePageCount(total, state.book, state.bookMode) || total,
        };
    }
    const total = (state.sections || []).length;
    const activeIndex = Math.min(Math.max(state.activeIdx ?? 0, 0), Math.max(0, total - 1));
    return {
        projection: null,
        activeIndex,
        total,
        label: getPageDisplayLabel(activeIndex, total, state.book, state.bookMode),
        readableTotal: getReadablePageCount(total, state.book, state.bookMode) || total,
    };
}

function syncEditorPageCounters() {
    const presentation = getEditorPresentationState();
    const counterText = `${presentation.label || '—'} / ${presentation.readableTotal || presentation.total || '—'}`;
    const canvasPageLabel = document.getElementById('canvas-page-label');
    if (canvasPageLabel) {
        const langCode = (state.activeLang || 'ja').toUpperCase();
        canvasPageLabel.textContent = `${counterText} ${langCode}`;
    }
    const stripCounter = document.getElementById('page-strip-counter');
    if (stripCounter) stripCounter.textContent = counterText;
    const mobileCounter = document.getElementById('page-strip-counter-mobile');
    if (mobileCounter) mobileCounter.textContent = counterText;

    const prevBtn = document.getElementById('btn-page-prev');
    const nextBtn = document.getElementById('btn-page-next');
    const pageDir = getEditorLangDirection(state.activeLang || state.defaultLang || 'ja');
    const activeIndex = presentation.activeIndex;
    const total = presentation.total;
    if (prevBtn) prevBtn.disabled = pageDir === 'rtl' ? activeIndex >= total - 1 : activeIndex <= 0;
    if (nextBtn) nextBtn.disabled = pageDir === 'rtl' ? activeIndex <= 0 : activeIndex >= total - 1;
}

function getEditorImageFrameMetrics(bgUrl, frameWidth = EDITOR_FRAME_WIDTH, frameHeight = EDITOR_FRAME_HEIGHT, percentBaseWidth = EDITOR_FRAME_WIDTH, percentBaseHeight = EDITOR_FRAME_HEIGHT) {
    const aspect = editorImageAspectCache.get(bgUrl);
    if (!aspect || !Number.isFinite(aspect) || aspect <= 0) {
        return {
            widthPercent: (frameWidth / percentBaseWidth) * 100,
            heightPercent: (frameHeight / percentBaseHeight) * 100
        };
    }

    const frameAspect = frameWidth / frameHeight;
    if (aspect > frameAspect) {
        return {
            widthPercent: (frameHeight * aspect / percentBaseWidth) * 100,
            heightPercent: (frameHeight / percentBaseHeight) * 100
        };
    }

    return {
        widthPercent: (frameWidth / percentBaseWidth) * 100,
        heightPercent: (frameWidth / aspect / percentBaseHeight) * 100
    };
}

function resetImageSnapState() {
    imageSnapState = { ...EMPTY_IMAGE_SNAP_STATE };
}

function getImageSnapMetrics(bgUrl, pos) {
    const frameMetrics = getEditorImageFrameMetrics(bgUrl);
    const width = EDITOR_FRAME_WIDTH * (frameMetrics.widthPercent / 100);
    const height = EDITOR_FRAME_HEIGHT * (frameMetrics.heightPercent / 100);
    const scale = Math.max(0.1, Number.isFinite(Number(pos?.scale)) ? Number(pos.scale) : 1);
    const rotation = Number.isFinite(Number(pos?.rotation)) ? Number(pos.rotation) : 0;
    const rad = (rotation * Math.PI) / 180;
    const halfW = (width * scale) / 2;
    const halfH = (height * scale) / 2;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const extentX = Math.abs(halfW * cos) + Math.abs(halfH * sin);
    const extentY = Math.abs(halfW * sin) + Math.abs(halfH * cos);

    return {
        extentX,
        extentY
    };
}

function applyImageSnapping(pos, bgUrl) {
    if (!isImageAdjusting || !pos) {
        resetImageSnapState();
        return;
    }

    const nextState = { ...EMPTY_IMAGE_SNAP_STATE };
    const { extentX, extentY } = getImageSnapMetrics(bgUrl, pos);
    let x = Number.isFinite(Number(pos.x)) ? Number(pos.x) : 0;
    let y = Number.isFinite(Number(pos.y)) ? Number(pos.y) : 0;

    if (Math.abs(x) <= IMAGE_SNAP_THRESHOLD) {
        x = 0;
        nextState.centerX = true;
    } else {
        const snapLeftX = -EDITOR_FRAME_WIDTH / 2 + extentX;
        const snapRightX = EDITOR_FRAME_WIDTH / 2 - extentX;
        if (Math.abs(x - snapLeftX) <= IMAGE_SNAP_THRESHOLD) {
            x = snapLeftX;
            nextState.edgeLeft = true;
        } else if (Math.abs(x - snapRightX) <= IMAGE_SNAP_THRESHOLD) {
            x = snapRightX;
            nextState.edgeRight = true;
        }
    }

    if (Math.abs(y) <= IMAGE_SNAP_THRESHOLD) {
        y = 0;
        nextState.centerY = true;
    } else {
        const snapTopY = -EDITOR_FRAME_HEIGHT / 2 + extentY;
        const snapBottomY = EDITOR_FRAME_HEIGHT / 2 - extentY;
        if (Math.abs(y - snapTopY) <= IMAGE_SNAP_THRESHOLD) {
            y = snapTopY;
            nextState.edgeTop = true;
        } else if (Math.abs(y - snapBottomY) <= IMAGE_SNAP_THRESHOLD) {
            y = snapBottomY;
            nextState.edgeBottom = true;
        }
    }

    if (Math.abs(x) <= 0.001) nextState.centerX = true;
    if (Math.abs(y) <= 0.001) nextState.centerY = true;

    pos.x = x;
    pos.y = y;
    imageSnapState = nextState;
}

function getImageAdjustRenderMetrics(bgUrl, pos, options = {}) {
    const frameWidth = Number(options.frameWidth) || EDITOR_FRAME_WIDTH;
    const frameHeight = Number(options.frameHeight) || EDITOR_FRAME_HEIGHT;
    const percentBaseWidth = Number(options.percentBaseWidth) || EDITOR_FRAME_WIDTH;
    const percentBaseHeight = Number(options.percentBaseHeight) || EDITOR_FRAME_HEIGHT;
    const offsetX = Number(options.offsetX) || 0;
    const frameMetrics = getEditorImageFrameMetrics(bgUrl, frameWidth, frameHeight, percentBaseWidth, percentBaseHeight);
    const scale = Math.max(0.1, Number(pos?.scale) || 1);
    const rotation = Number(pos?.rotation) || 0;
    const flipX = pos?.flipX ? ' scaleX(-1)' : '';
    return {
        frameMetrics,
        invScale: 1 / scale,
        targetTransform: `translate(calc(-50% + ${(Number(pos?.x) || 0) + offsetX}px), calc(-50% + ${Number(pos?.y) || 0}px)) scale(${scale}) rotate(${rotation}deg)${flipX}`
    };
}

function syncImageAdjustDom() {
    const s = state.sections?.[state.activeIdx];
    if (!s || s.type !== 'image') return false;
    const pos = getActiveImagePosition();
    if (!pos) return false;

    const target = document.getElementById('image-adjust-target');
    if (!target) return false;

    const bgUrl = getOptimizedImageUrl(s?.backgrounds?.[state.activeLang] || s?.backgrounds?.[state.defaultLang] || s?.background || '');
    const { frameMetrics, invScale, targetTransform } = getImageAdjustRenderMetrics(bgUrl, pos, getSpreadImageRenderOptions(s, state.activeIdx));

    target.style.width = `${frameMetrics.widthPercent}%`;
    target.style.height = `${frameMetrics.heightPercent}%`;
    target.style.transform = targetTransform;

    const overlay = document.getElementById('image-adjust-overlay');
    if (overlay) {
        overlay.style.setProperty('--inv-handle-scale', String(invScale));
    }

    const rotateSlider = document.getElementById('image-rotate-slider');
    if (rotateSlider) {
        const rotation = roundRotationHalfStep(Math.max(-180, Math.min(180, Number(pos.rotation) || 0)));
        rotateSlider.value = String(rotation);
    }
    const rotateShell = document.querySelector('.img-rotate-slider-shell');
    if (rotateShell) {
        const rotation = roundRotationHalfStep(Math.max(-180, Math.min(180, Number(pos.rotation) || 0)));
        const ratio = (180 - rotation) / 360;
        rotateShell.style.setProperty('--rotate-ratio', String(ratio));
        rotateShell.setAttribute('aria-valuenow', String(rotation));
    }
    syncImageRibbonContext({active: true, bubbleSelected: state.activeBubbleIdx !== null, adjusting: isImageAdjusting, position: pos});
    const rotateValue = document.getElementById('image-rotate-value');
    if (rotateValue) {
        const rotation = roundRotationHalfStep(Math.max(-180, Math.min(180, Number(pos.rotation) || 0)));
        rotateValue.textContent = `${rotation.toFixed(1)}°`;
    }

    const safeFrame = document.querySelector('#image-stage-overlay .image-safe-frame');
    if (safeFrame) {
        safeFrame.classList.toggle('active-left', !!imageSnapState.edgeLeft);
        safeFrame.classList.toggle('active-right', !!imageSnapState.edgeRight);
        safeFrame.classList.toggle('active-top', !!imageSnapState.edgeTop);
        safeFrame.classList.toggle('active-bottom', !!imageSnapState.edgeBottom);
    }

    const verticalGuide = document.querySelector('#image-stage-overlay .image-center-guide.vertical');
    if (verticalGuide) verticalGuide.classList.toggle('active', !!imageSnapState.centerX);
    const horizontalGuide = document.querySelector('#image-stage-overlay .image-center-guide.horizontal');
    if (horizontalGuide) horizontalGuide.classList.toggle('active', !!imageSnapState.centerY);

    const flipBtn = document.getElementById('image-flip-btn');
    if (flipBtn) flipBtn.classList.toggle('active', !!pos.flipX);

    return true;
}

let imageAdjustRaf = null;
let isAdjustingRotationSlider = false;
let imageAdjustThumbTimer = null;
function scheduleImageAdjustThumbUpdate() {
    if (imageAdjustThumbTimer) clearTimeout(imageAdjustThumbTimer);
    imageAdjustThumbTimer = setTimeout(() => {
        imageAdjustThumbTimer = null;
        renderThumbs();
    }, 80);
}

function scheduleImageAdjustDomUpdate() {
    if (imageAdjustRaf) return;
    imageAdjustRaf = requestAnimationFrame(() => {
        imageAdjustRaf = null;
        if (syncImageAdjustDom()) {
            const groupId = state.sections[state.activeIdx]?.spreadImage?.groupId;
            if (groupId) _flowCanvasView?.refreshFixedPreviews(page => page.section?.spreadImage?.groupId === groupId);
            scheduleImageAdjustThumbUpdate();
        } else {
            refresh();
        }
    });
}

window.handleEditorImageLoad = (e) => {
    const img = e?.target;
    const src = img?.getAttribute('src');
    const naturalWidth = Number(img?.naturalWidth);
    const naturalHeight = Number(img?.naturalHeight);
    if (!src || !Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight) || naturalWidth <= 0 || naturalHeight <= 0) {
        return;
    }

    const aspect = naturalWidth / naturalHeight;
    const prev = editorImageAspectCache.get(src);
    if (prev && Math.abs(prev - aspect) < 0.0001) return;

    editorImageAspectCache.set(src, aspect);
    refresh();
};

function getActiveBlock() {
    const blocks = state.blocks || [];
    if (Number.isInteger(state.activeBlockIdx) && blocks[state.activeBlockIdx]) {
        return blocks[state.activeBlockIdx];
    }
    const fallbackBlockIdx = getBlockIndexFromPageIndex(blocks, state.activeIdx);
    if (fallbackBlockIdx >= 0) {
        dispatch({ type: actionTypes.SET_ACTIVE_BLOCK_INDEX, payload: fallbackBlockIdx });
        return blocks[fallbackBlockIdx];
    }
    return null;
}

function getEditableActiveFixedSection(expectedType = null) {
    if (!canEditSharedStudio()) return null;
    const activeBlock = getActiveBlock();
    if (activeBlock?.kind !== 'page') return null;
    const pageIndex = getPageIndexFromBlockIndex(state.blocks || [], state.activeBlockIdx);
    if (pageIndex < 0 || pageIndex !== state.activeIdx) return null;
    const section = state.sections?.[pageIndex];
    if (!section || (expectedType && section.type !== expectedType)) return null;
    return section;
}

function canEditActiveFixedPage(expectedType = null) {
    return !!getEditableActiveFixedSection(expectedType);
}

function getFlowPreviewTargetBlock(activeBlock = getActiveBlock()) {
    if (activeBlock?.kind === 'flow') return activeBlock;
    const blocks = state.blocks || [];
    const activeIndex = Number.isInteger(state.activeBlockIdx) ? state.activeBlockIdx : -1;
    if (activeIndex >= 0) {
        for (let index = activeIndex + 1; index < blocks.length; index += 1) {
            if (blocks[index]?.kind === 'flow') return blocks[index];
        }
        for (let index = activeIndex - 1; index >= 0; index -= 1) {
            if (blocks[index]?.kind === 'flow') return blocks[index];
        }
    }
    return blocks.find((block) => block?.kind === 'flow') || null;
}


function syncBlocksFromState() {
    if (!canEditSharedStudio()) return;
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: {
        key: 'blocks',
        value: syncBlocksWithSections(state.blocks, state.sections, state.languages, { strictSpine: state.version === 6 }),
    } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'pages', value: blocksToPages(state.blocks) } });
    const activeBlock = getActiveBlock();
    const pageIdx = getPageIndexFromBlockIndex(state.blocks, state.activeBlockIdx);
    if (pageIdx >= 0) {
        dispatch({ type: actionTypes.SET_ACTIVE_INDEX, payload: pageIdx });
    }
    if (!activeBlock && state.blocks?.length) {
        dispatch({ type: actionTypes.SET_ACTIVE_BLOCK_INDEX, payload: 0 });
    }
}

function getProjectDisplayName() {
    return state.projectName || '新規プロジェクト';
}

function ensureProjectIdentity() {
    if (!state.projectId) {
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'projectId', value: createId('proj') } });
    }
    if (!state.workId) {
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'workId', value: createId('work') } });
    }

    if (!state.projectName) {
        const headerText = (document.getElementById('project-title')?.textContent || '').trim();
        const fallbackName = headerText && headerText !== '新規プロジェクト'
            ? headerText
            : (state.title || '新規プロジェクト');
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'projectName', value: fallbackName } });
    }
}

function formatHomeDate(value) {
    const date = value instanceof Date
        ? value
        : (typeof value?.toDate === 'function' ? value.toDate() : new Date(value || 0));
    if (Number.isNaN(date.getTime())) return '';
    const locale = getUILang() === 'en' ? 'en-US' : 'ja-JP';
    return date.toLocaleDateString(locale);
}

function formatProjectLanguages(languages) {
    const list = Array.isArray(languages) && languages.length > 0 ? languages : ['ja'];
    return list.map((code) => String(code).toUpperCase()).join(', ');
}

function getStudioLanguageBadgeModifier(code) {
    const normalized = String(code || '').trim().toLowerCase();
    if (normalized === 'ja') return 'ja';
    if (normalized === 'en' || normalized === 'en-us') return 'en-us';
    if (normalized === 'en-gb') return 'en-gb';
    if (normalized === 'zh-cn') return 'zh-cn';
    if (normalized === 'zh-tw') return 'zh-tw';
    return 'generic';
}

function renderStudioLanguageBadge(code, className = 'home-lang-badge') {
    const modifier = getStudioLanguageBadgeModifier(code);
    const label = String(code || '').toUpperCase();
    return `<span class="${className} home-lang-${modifier}" title="${escapeStudioHtml(label)}">${modifier === 'generic' ? escapeStudioHtml(label) : ''}</span>`;
}

function renderLanguageBadges(languages) {
    const list = Array.isArray(languages) && languages.length > 0 ? languages : ['ja'];
    return list.map((code) => renderStudioLanguageBadge(code)).join('');
}

function formatProjectBytes(bytes) {
    const size = Number(bytes || 0);
    if (!Number.isFinite(size) || size <= 0) return '';
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Home room — ダッシュボード（クラウド / ローカル一覧） ─────────────────
let publishingSpaceUI, homeWorkspace, spaceMembersSettings, studioInbox;
function syncStudioInbox() {
    if(!studioInbox)studioInbox=createStudioInbox({getUser:()=>firebaseAuth.currentUser,getLocale:getUILang});
    studioInbox.update();
    return studioInbox;
}
function syncSpaceMembersSettings() {
    const root = document.getElementById('home-space-members');
    if (!root) return;
    if (!spaceMembersSettings) spaceMembersSettings = createSpaceMembersSettings({ root, getLocale:getUILang,
        execute:createInvitationsClient({getUser:()=>firebaseAuth.currentUser}),personalExecute:createPersonalSharingClient({getUser:()=>firebaseAuth.currentUser}),
        beforeLeave:prepareSharedSpaceLeave,onEnded:async({spaceId,self})=>{if(self){finishSharedSpaceLeave(spaceId);getPublishingSpaceUI().select('unassigned');await getPublishingSpaceUI().refreshJoined();}else await checkSharedStudioAccess().catch(()=>{});} });
    const selected=getPublishingSpaceUI().joinedSelection();
    spaceMembersSettings.update({uid:state.uid,spaceId:getPublishingSpaceUI().selection(),manageMembers:!selected||selected.canManageMembers===true,joined:!!selected});
}

function getHomeWorkspace() {
    if (!homeWorkspace) homeWorkspace = createHomeWorkspace({root:document.getElementById('home-room'),getLocale:getUILang,onSelect:view=>{
        if(['shared','notifications'].includes(view))syncStudioInbox().show(view);
        if(['overview','recent'].includes(view))void refreshRecentWorks();
        if(['overview','projects','activity','settings'].includes(view))void getPublishingSpaceUI().retryIfFailed();
        if(['overview','recent','projects','activity','trash'].includes(view)&&state.uid&&!homeCloudProjectsRequest&&(!homeCloudProjectsCache||Date.now()-homeCloudProjectsCache.time>=30000))void renderHomeDashboard({refreshSpaces:false,forceRefresh:true});
    }});
    return homeWorkspace;
}
function getPublishingSpaceUI() {
    if (!publishingSpaceUI) publishingSpaceUI = createPublishingSpaceUI({
        root: document.getElementById('home-publishing-spaces'),
        switcherRoots: [document.getElementById('studio-space-switcher'), document.getElementById('mobile-space-switcher'), document.getElementById('home-space-launcher')],
        identityRoots: [document.getElementById('home-space-identity')],
        onSelect: () => { getHomeWorkspace().select('overview'); if (getCurrentRoom() !== 'home') window.switchRoom('home'); },
        requestJoined:createInvitationsClient({getUser:()=>firebaseAuth.currentUser}),
        request: requestPublishingSpaces, getUid: () => state.uid, getLocale: getUILang,
        onChange: () => { void renderHomeDashboard({ refreshSpaces: false }); },
    });
    return publishingSpaceUI;
}
async function chooseCloudDestination({allowLocal=false,purpose='save'}={}) {
    const uid=state.uid||'', user=firebaseAuth.currentUser, epoch=getProjectSessionEpoch();
    return chooseAuthoringDestination({allowLocal,purpose,uid,en:getUILang()==='en',
        defaultSpaceId:getPublishingSpaceUI().selection(),loadCatalogue:()=>requestPublishingSpaces(),
        isCurrent:()=>(state.uid||'')===uid&&firebaseAuth.currentUser===user&&getProjectSessionEpoch()===epoch,
        onLogin:()=>{if(!firebaseAuth.currentUser)void window.toggleAuth();}});
}
let cloudDestinationBusy=false, pendingCloudDestination=null;
async function saveCloudDestination(choice) {
    if(cloudDestinationBusy||!choice||choice.uid!==state.uid||firebaseAuth.currentUser?.uid!==choice.uid)return false;
    cloudDestinationBusy=true;
    if(!state.projectId){setLocalCloudTransitionPending(true);ensureProjectIdentity();}
    const user=firebaseAuth.currentUser, workId=state.workId, epoch=getProjectSessionEpoch();
    const current=()=>firebaseAuth.currentUser===user&&state.uid===choice.uid&&state.workId===workId&&getProjectSessionEpoch()===epoch;
    const projectId=state.projectId;
    pendingCloudDestination={...choice,projectId,workId};
    try {
        await persistProject();
        if(!current()||state.projectId!==projectId)return false;
        if(choice.spaceId){const data=await requestPublishingSpaces();if(!current())return false;
            const assigned=data.assignments[projectId]||null;
            if(assigned!==choice.spaceId)await requestPublishingSpaces({kind:'assign',projectId,spaceId:choice.spaceId,expectedSpaceId:assigned,baseRevision:data.revision});}
        if(!current())return false;
        pendingCloudDestination=null;setLocalCloudTransitionPending(false);
        await getPublishingSpaceUI().load({notify:true});
        refresh();await refreshFlowHorizonDryRunReadiness();return true;
    } catch(error) {
        if(current())alert((getUILang()==='en'?'Cloud saving or space assignment did not finish. Keep this manuscript open and retry cloud saving, or save a DSP file.\n':'クラウド保存またはスペースへの所属設定を完了できませんでした。原稿を開いたまま「クラウドに保存」から再試行するか、DSPファイルに保存してください。\n')+(error?.message||''));
        return false;
    } finally {cloudDestinationBusy=false;}
}
window.saveToCloud = async ({purpose='save'}={}) => {
    assertPersonalStudioOperation();
    if(pendingCloudDestination?.projectId===state.projectId&&pendingCloudDestination?.workId===state.workId){
        if(pendingCloudDestination.uid!==state.uid){alert(getUILang()==='en'?'Sign in with the account that started this cloud save, or save a DSP copy.':'クラウド保存を開始したアカウントでログインして再試行するか、DSPファイルに保存してください。');return false;}
        return saveCloudDestination(pendingCloudDestination);
    }
    if(state.projectId&&state.uid){try{await persistProject();return true;}catch(error){alert(error.message);return false;}}
    const choice=await chooseCloudDestination({purpose});
    return choice?saveCloudDestination(choice):false;
};
window.prepareHorizonCloudSource=()=>{
    if(state.projectId&&state.uid&&!isLocalDraft())return Promise.resolve(true);
    return window.saveToCloud({purpose:'horizon'});
};
window.newSpaceProject = async () => {
    const choice=await chooseCloudDestination({allowLocal:true});if(!choice)return;
    if(!await window.newProject())return;
    window.switchRoom('editor');
    if(choice.kind==='cloud')await saveCloudDestination(choice);
    return true;
};


function homeLocalSpaceLabel(project) {
    return localCopySpaceLabel(project, {
        uid: state.uid || '', catalogue: getPublishingSpaceUI().destinations(),
        cloudProjectIds: homeCloudProjectsCache?.uid === state.uid
            ? new Set(homeCloudProjectsCache.projects.map(p => p.id)) : null,
        online: navigator.onLine, locale: getUILang(),
    });
}

function refreshHomeLocalSpaceLabels(localGrid, projects) {
    if (!localGrid) return;
    const byId = new Map(projects.map(p => [p.id, p]));
    for (const card of localGrid.querySelectorAll('[data-home-source="local"]')) {
        const project = byId.get(card.dataset.id);
        const badge = card.querySelector('.home-local-space');
        if (project && badge) badge.textContent = homeLocalSpaceLabel(project);
    }
}

function renderHomeCard(project, source) {
    const projectName = resolveProjectName(project);
    const workTitle = resolveProjectDisplayTitle(project, { locale: getUILang() });
    const displayName = projectName || workTitle || t('works_untitled');
    const workTitleMeta = projectName
        ? (workTitle
            ? t('home_work_title', { title: workTitle })
            : t('home_work_title_unset'))
        : '';
    const thumb = project.listThumbnail || (
        source === 'cloud'
            ? getCoverImage(project.dsfPages, project.pages, project.blocks, project.sections)
            : (project.thumbnail || '')
    );
    const pageCount = source === 'cloud'
        ? (Number(project.pageCount) || getPageCount(project.pages, project.blocks, project.sections))
        : Math.max(1, Number(project.pageCount || 0));
    const updatedAt = formatHomeDate(project.lastUpdated || project.updatedAt) + (source==='local'&&project.updatedAt ? ' '+new Date(project.updatedAt).toLocaleTimeString(getUILang()==='en'?'en-US':'ja-JP',{hour:'2-digit',minute:'2-digit'}) : '');
    const sourceLabel = source === 'cloud' ? t('home_source_cloud') : t('home_source_local');
    const languageLabel = formatProjectLanguages(project.languages);
    const sizeLabel = formatProjectBytes(project.projectBytes);
    const languageBadges = renderLanguageBadges(project.languages);

    return `
        <div class="home-project-entry" data-project-entry="${escapeStudioHtml(project.id)}">
        <button class="home-project-card" data-home-source="${escapeStudioHtml(source)}" data-id="${escapeStudioHtml(project.id)}">
            <div class="home-project-thumb">
                ${thumb
                    ? `<img src="${escapeStudioHtml(thumb)}" alt="${escapeStudioHtml(displayName)}" loading="lazy" decoding="async">`
                    : `<div class="home-project-thumb-fallback"><span class="material-icons">folder</span></div>`}
            </div>
            <div class="home-project-info">
                <div class="home-project-title">${escapeStudioHtml(displayName)}</div>
                ${source === 'local' ? `<div class="home-local-space">${escapeStudioHtml(homeLocalSpaceLabel(project))}</div>` : ''}
                <span class="home-project-resume">${getUILang() === 'en' ? 'Continue editing' : '続きから編集'}</span>
                ${workTitleMeta ? `<div class="home-project-meta home-project-work-title">${escapeStudioHtml(workTitleMeta)}</div>` : ''}
                <div class="home-project-meta">${escapeStudioHtml(t('home_pages_count', { count: pageCount }))} · ${escapeStudioHtml(sourceLabel)}${updatedAt ? ` · ${escapeStudioHtml(updatedAt)}` : ''}</div>
                <div class="home-project-meta home-project-meta-secondary">
                    <span class="home-lang-badges">${languageBadges}</span>
                    <span>${escapeStudioHtml(languageLabel)}${sizeLabel ? ` · ${escapeStudioHtml(sizeLabel)}` : ''}</span>
                </div>
            </div>
        </button>
        ${source === 'cloud' ? projectActionsMarkup(project,getUILang()==='en',!!getPublishingSpaceUI().destinations()&&!getPublishingSpaceUI().destinations().assignments[project.id]) : ''}
        </div>
    `;
}

function isPublishedHomeWork(project) {
    return Array.isArray(project?.dsfPages) && project.dsfPages.length > 0;
}

function getHomeWorkStatus(project) {
    return String(project?.dsfStatus || project?.visibility || 'draft');
}

function getHomeWorkStatusLabel(status) {
    const map = {
        draft: t('home_status_draft'),
        public: t('home_status_public'),
        unlisted: t('home_status_unlisted'),
        private: t('home_status_private')
    };
    return map[status] || status;
}

function getHomeWorkDate(project) {
    return formatHomeDate(project?.dsfPublishedAt || project?.updatedAt || project?.lastUpdated);
}

function formatStudioPublicationDate(value) {
    return formatPublicationDate(value, getUILang() === 'en' ? 'en-US' : 'ja-JP');
}

function renderHomePublicationMeta(publication) {
    if (!publication || typeof publication !== 'object') return '';
    const listedUntil = formatStudioPublicationDate(publication.listedUntil) || t('publication_no_limit');
    const publicFrom = formatStudioPublicationDate(publication.publicFrom) || t('publication_immediate');
    const publicUntil = formatStudioPublicationDate(publication.publicUntil) || t('publication_no_limit');
    const publicPeriod = `${publicFrom} - ${publicUntil}`;
    return `
        <div class="home-work-publication">
            <span>${escapeStudioHtml(t('publication_listed_until'))}: ${escapeStudioHtml(listedUntil)}</span>
            <span>${escapeStudioHtml(t('publication_public_period'))}: ${escapeStudioHtml(publicPeriod)}</span>
        </div>
    `;
}

const HOME_REVIEW_CACHE_TTL_MS = 30_000;
const homeReviewSummaryCache = new Map();
const homeReviewSummaryRequests = new Map();

async function fetchHomeReviewSummary(workId) {
    if (!workId) return { reviewCount: 0, goodCount: 0, badCount: 0, unavailable: false };
    try {
        const reviewQuery = query(
            collection(db, 'reviews', workId, 'items'),
            where('status', '==', 'published'),
            limit(50)
        );
        const snap = await getDocs(reviewQuery);
        let reviewCount = 0;
        let goodCount = 0;
        let badCount = 0;
        snap.forEach((entry) => {
            const data = entry.data() || {};
            reviewCount += 1;
            goodCount += Math.max(0, Number(data.goodCount) || 0);
            badCount += Math.max(0, Number(data.badCount) || 0);
        });
        return { reviewCount, goodCount, badCount, unavailable: false };
    } catch (e) {
        console.warn('[Home] Failed to load review summary:', workId, e);
        return { reviewCount: 0, goodCount: 0, badCount: 0, unavailable: true };
    }
}

async function loadHomeReviewSummary(workId) {
    if (!workId) return { reviewCount: 0, goodCount: 0, badCount: 0, unavailable: false };

    const now = Date.now();
    const cached = homeReviewSummaryCache.get(workId);
    if (cached && cached.expiresAt > now) return cached.summary;

    const inFlight = homeReviewSummaryRequests.get(workId);
    if (inFlight) return inFlight;

    const request = withHomeDeadline(fetchHomeReviewSummary(workId)).catch(() => ({ reviewCount: 0, goodCount: 0, badCount: 0, unavailable: true })).then((summary) => {
        if (!summary.unavailable) {
            homeReviewSummaryCache.set(workId, {
                summary,
                expiresAt: Date.now() + HOME_REVIEW_CACHE_TTL_MS
            });
        }
        return summary;
    });
    homeReviewSummaryRequests.set(workId, request);

    try {
        return await request;
    } finally {
        if (homeReviewSummaryRequests.get(workId) === request) {
            homeReviewSummaryRequests.delete(workId);
        }
    }
}

async function loadHomeReviewSummaries(works) {
    const entries = await Promise.all(
        works.slice(0, 12).map(async (work) => {
            const workId = work.workId || work.id;
            return [workId, await loadHomeReviewSummary(workId)];
        })
    );
    return new Map(entries);
}

function renderHomeStatCard(icon, label, value, hint = '') {
    return `
        <article class="home-stat-card">
            <span class="material-icons" aria-hidden="true">${escapeStudioHtml(icon)}</span>
            <div>
                <strong>${escapeStudioHtml(value)}</strong>
                <span>${escapeStudioHtml(label)}</span>
                ${hint ? `<small>${escapeStudioHtml(hint)}</small>` : ''}
            </div>
        </article>
    `;
}

function renderHomeDashboardStats({ cloudProjects, localProjects, works, reviewTotals, reviewsLoading = false }) {
    const cloudCount = Array.isArray(cloudProjects) ? cloudProjects.length : 0;
    const publicCount = works.filter((work) => getHomeWorkStatus(work) === 'public').length;
    const visibleCount = works.filter((work) => ['public', 'unlisted'].includes(getHomeWorkStatus(work))).length;
    const draftCount = works.filter((work) => !['public', 'unlisted'].includes(getHomeWorkStatus(work))).length;
    return [
        renderHomeStatCard('library_books', t('home_stat_works'), String(works.length), t('home_stat_works_hint', { count: visibleCount })),
        renderHomeStatCard('public', t('home_stat_public'), String(publicCount), t('home_stat_public_hint', { count: draftCount })),
        renderHomeStatCard(
            'rate_review',
            t('home_stat_reviews'),
            reviewsLoading ? '…' : String(reviewTotals.reviewCount),
            reviewsLoading ? t('home_loading') : t('home_stat_reviews_hint', { count: reviewTotals.goodCount })
        ),
        renderHomeStatCard('folder', t('home_stat_projects'), String(cloudCount), t('home_stat_projects_hint', { count: localProjects.length }))
    ].join('');
}

function renderHomeWorkCard(work, reviewSummary) {
    const workId = work.workId || work.id;
    const status = getHomeWorkStatus(work);
    const explicitWorkTitle = resolveProjectDisplayTitle(work, { locale: getUILang() });
    const projectName = resolveProjectName(work);
    const title = explicitWorkTitle || projectName || work.id || t('works_untitled');
    const nameContext = explicitWorkTitle && projectName
        ? t('works_project_name', { name: projectName })
        : (!explicitWorkTitle && projectName ? t('works_title_fallback') : '');
    const thumb = getCoverImage(work.dsfPages, work.pages, work.blocks, work.sections);
    const pageCount = Array.isArray(work.dsfPages) && work.dsfPages.length
        ? work.dsfPages.length
        : getPageCount(work.pages, work.blocks, work.sections);
    const langs = Array.isArray(work.dsfLangs) && work.dsfLangs.length ? work.dsfLangs : work.languages;
    const languageBadges = renderLanguageBadges(langs);
    const date = getHomeWorkDate(work);
    const publicationMeta = renderHomePublicationMeta(work.publication);
    const reviewsLoading = reviewSummary?.loading === true;
    const reviewText = reviewsLoading
        ? t('home_loading')
        : reviewSummary?.unavailable
        ? t('home_reviews_unavailable')
        : t('home_work_reviews', {
            reviews: reviewSummary?.reviewCount || 0,
            good: reviewSummary?.goodCount || 0,
            bad: reviewSummary?.badCount || 0
        });

    return `
        <article class="home-work-card" data-work-id="${escapeStudioHtml(workId)}" data-release-id="${escapeStudioHtml(work.releaseId || '')}" data-project-id="${escapeStudioHtml(work.id)}">
            <div class="home-work-thumb">
                ${thumb
                    ? `<img src="${escapeStudioHtml(thumb)}" alt="${escapeStudioHtml(title)}" loading="lazy" decoding="async">`
                    : `<div class="home-work-thumb-fallback"><span class="material-icons">auto_stories</span></div>`}
            </div>
            <div class="home-work-main">
                <div class="home-work-topline">
                    <span class="home-work-status home-work-status-${escapeStudioHtml(status)}">${escapeStudioHtml(getHomeWorkStatusLabel(status))}</span>
                    <span class="home-lang-badges">${languageBadges}</span>
                </div>
                <h4>${escapeStudioHtml(title)}</h4>
                ${nameContext ? `<p class="home-work-name-context">${escapeStudioHtml(nameContext)}</p>` : ''}
                <p>${escapeStudioHtml(t('home_work_meta', { pages: pageCount, date: date || '—' }))}</p>
                ${publicationMeta}
                <div class="home-work-metrics">
                    <span><strong>${reviewsLoading ? '…' : escapeStudioHtml(String(reviewSummary?.reviewCount || 0))}</strong>${escapeStudioHtml(t('home_metric_reviews'))}</span>
                    <span><strong>${reviewsLoading ? '…' : escapeStudioHtml(String(reviewSummary?.goodCount || 0))}</strong>${escapeStudioHtml(t('home_metric_good'))}</span>
                    <span><strong>${reviewsLoading ? '…' : escapeStudioHtml(String(reviewSummary?.badCount || 0))}</strong>${escapeStudioHtml(t('home_metric_bad'))}</span>
                </div>
                <div class="home-work-review-note">${escapeStudioHtml(reviewText)}</div>
                <div class="home-work-actions">
                    <button type="button" class="home-work-action" data-home-open-project="${escapeStudioHtml(work.id)}">
                        <span class="material-icons">edit</span>${escapeStudioHtml(t('home_open_project'))}
                    </button>
                    <button type="button" class="home-work-action" data-home-copy-work="${escapeStudioHtml(workId)}">
                        <span class="material-icons">link</span>${escapeStudioHtml(t('home_copy_viewer'))}
                    </button>
                    <button type="button" class="home-work-action" onclick="switchRoom('works')">
                        <span class="material-icons">tune</span>${escapeStudioHtml(t('home_manage_work'))}
                    </button>
                </div>
            </div>
        </article>
    `;
}

function bindHomeWorkActions(workGrid, cloudProjects) {
    workGrid?.querySelectorAll('[data-home-open-project]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const pid = btn.dataset.homeOpenProject;
            const project = (cloudProjects || []).find((item) => item.id === pid);
            if (!project) return;
            if (!await onLoadProject(pid)) return;
            await cacheLocalRecentProject(JSON.parse(JSON.stringify(state)), window.localImageMap);
            refresh();
            window.switchRoom('editor');
        });
    });

    workGrid?.querySelectorAll('[data-home-copy-work]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const workId = btn.dataset.homeCopyWork;
            if (!workId) return;
            const releaseId = btn.closest('.home-work-card')?.dataset.releaseId || '';
            let url = '';
            try {
                url = buildPublicViewerUrl(window.location.origin, workId, releaseId);
            } catch (error) {
                console.warn('[Home] Viewer URL could not be created:', error?.code || error?.name || 'unknown');
                alert(t('home_copy_viewer_failed'));
                return;
            }
            try {
                await navigator.clipboard.writeText(url);
                alert(t('home_copied_viewer_url', { url }));
            } catch (_) {
                prompt(t('home_copy_viewer_prompt'), url);
            }
        });
    });
}

let deletingLocalCopy=false;
async function deleteHomeLocalCopy(project, {fromEditor=false}={}) {
    if(deletingLocalCopy)return;
    deletingLocalCopy=true;
    const en=getUILang()==='en';
    try {
        const current=(await listLocalRecentProjects()).find(p=>p.id===project.id);
        if(!current)throw Error('LOCAL_COPY_CHANGED');
        const name=current.projectName||current.title||(en?'Untitled project':'無題のプロジェクト');
        const epoch=getProjectSessionEpoch(),active=localRecentId(state)===current.id;
        if(active&&readSharedStudioAccess())throw Error('SHARED_STUDIO_ACTIVE');
        if(!await confirmLocalCopyDeletion({name,active,en}))return;
        const token=await removeLocalRecentProject(current.id,current.updatedAt,()=>epoch===getProjectSessionEpoch());
        if(active&&epoch===getProjectSessionEpoch()){
            const languageKey=state.defaultLang||'ja';
            initializeNewProject({languageKey,pageDirection:state.languageConfigs?.[languageKey]?.pageDirection||'rtl'},null,{autosave:false});
            window.localImageMap={};
        }
        if(fromEditor){window.closeProjectSettings();window.switchRoom('home');}
        const host=document.getElementById('home-local-copy-feedback');
        showLocalCopyUndo({host,name,en,restore:()=>restoreLocalRecentProject(token)});
        window.dispatchEvent(new Event('home-start-refresh'));
    } catch(error) {
        alert(en?'Could not delete this copy. It may be saving or have changed. Wait for saving to finish and try again.':'コピーを削除できませんでした。保存中、または内容が更新された可能性があります。保存が終わってからもう一度お試しください。');
        void renderHomeDashboard();
    } finally {deletingLocalCopy=false;}
}

function renderHomeLocalProjects(localGrid, localCount, localProjects) {
    if (localProjects.length === 0) {
        localGrid.innerHTML = `<div class="home-empty-state"><span class="material-icons">folder_open</span><p>${t('home_local_empty')}</p></div>`;
        if (localCount) localCount.textContent = '0';
    } else {
        localGrid.innerHTML = localProjects.map((project) => renderHomeCard(project, 'local')).join('');
        if (localCount) localCount.textContent = String(localProjects.length);
    }

    for(const entry of localGrid.querySelectorAll('.home-project-entry')){
        const project=localProjects.find(p=>p.id===entry.dataset.projectEntry);
        if(!project)continue;
        const button=localCopyDeleteButton(project,getUILang()==='en');
        button.onclick=()=>void deleteHomeLocalCopy(project);entry.append(button);
    }

    localGrid.querySelectorAll('.home-project-card').forEach((card) => {
        card.addEventListener('click', async () => {
            const copy=localProjects.find(p=>p.id===card.dataset.id);
            if(copy)await openRecentLocalCopy(copy);
        });
    });
}

const recentActivity=createRecentActivityClient({getUser:()=>firebaseAuth.currentUser});
function noteRecentCloudOpen(target){if(!state.uid||!navigator.onLine)return;void recentActivity.opened(target).catch(()=>{});}
let recentSharedIdentity=null;
subscribeSharedStudioAccess(access=>{
    if(!access){recentSharedIdentity=null;return;}
    if(access.status!=='ready')return;
    const key=JSON.stringify([state.uid,access.spaceId,access.workId]);
    if(key===recentSharedIdentity)return;recentSharedIdentity=key;
    noteRecentCloudOpen({spaceId:access.spaceId,workId:access.workId});
});
let protectedDialog=null,protectedListRevision=0;
let recentWorksUI=null,recentWorksEpoch=0,recentDirectory=null,recentDirectoryUid=null,recentDirectoryAt=0;
async function openRecentLocalCopy(copy) {
    try {
        await flushBeforeSafeResume();
        if(copy.projectId){const kept=await protectLocalRecentProject(copy.id);await openProtectedCopy(kept.id);return;}
        const loadedState=hydrateProjectFromPersistence(await loadLocalRecentProject(copy.id));
        resetFlowRuntimeForProjectChange();clearHistory();dispatch({type:actionTypes.LOAD_PROJECT,payload:loadedState});
        noteLocalDraftEdit();refresh();window.switchRoom('editor');
    }catch(e){alert(t('home_local_open_error',{message:e.message}));}
}
async function refreshRecentWorks({force=false,more=false,keepCloudRequest=false}={}) {
    void refreshProtectedCopies();
    const root=document.getElementById('home-recent-works');if(!root)return;
    const uid=state.uid||'',online=navigator.onLine,epoch=++recentWorksEpoch;
    const current=()=>epoch===recentWorksEpoch&&uid===(state.uid||'')&&online===navigator.onLine;
    if(!recentWorksUI)recentWorksUI=createRecentWorksUI({root,getLocale:getUILang,
        onCloud:async row=>{if(state.uid!==row.ownerUid)return;if(await onLoadProject(row.projectId))window.switchRoom('editor');},
        onLocal:openRecentLocalCopy,onDelete:deleteHomeLocalCopy,
        onRefresh:()=>void refreshRecentWorks({force:true}),onMore:()=>void refreshRecentWorks({more:true})});
    if(force&&!keepCloudRequest){homeCloudProjectsCache=null;homeCloudProjectsRequest=null;++homeCloudProjectsRequestToken;}
    if(!online||!uid||recentDirectoryUid!==uid||force||(!more&&Date.now()-recentDirectoryAt>30000)){
        recentDirectory=null;recentDirectoryUid=uid;recentDirectoryAt=Date.now();
        if(uid&&online){const directoryUid=uid;recentDirectory=createRecentDirectory({execute:createInvitationsClient({getUser:()=>firebaseAuth.currentUser}),isCurrent:()=>state.uid===directoryUid&&navigator.onLine});}
    }
    const directory=recentDirectory;
    let data={uid,online,owned:null,locals:[],catalogue:getPublishingSpaceUI().destinations(),directory:directory?.snapshot(),loading:true};
    const paint=()=>{if(current())recentWorksUI.render({...data,shared:data.directory?.works||[]});};paint();
    const tasks=[listLocalRecentProjects().then(locals=>{data.locals=locals;paint();}).catch(()=>{data.localFailed=true;paint();}),
        online&&uid?recentActivity.list({force}).then(history=>{data.history=history;paint();}).catch(()=>{data.historyFailed=true;paint();}):Promise.resolve(),
        online&&uid?fetchHomeCloudProjects().then(owned=>{data.owned=owned;data.catalogue=getPublishingSpaceUI().destinations();paint();}):Promise.resolve(),
        directory&&(more||(!directory.snapshot().started&&!directory.snapshot().unavailable))?directory.load().then(result=>{data.directory=result;paint();}):Promise.resolve()];
    await Promise.allSettled(tasks);data.loading=false;paint();
}

let homeDashboardRenderRevision = 0;
let homeCloudProjectsRequest = null;
let homeCloudProjectsRequestUid = '';
let homeCloudProjectsRequestToken = 0;
let homeCloudProjectsCache = null;
window.addEventListener('project-trash-updated', ({detail}) => {
    if (detail?.uid !== state.uid) return;
    homeCloudProjectsCache = null; homeCloudProjectsRequest = null;
    ++homeCloudProjectsRequestToken;
});

function fetchHomeCloudProjects() {
    const requestUid = state.uid || '';
    if (!requestUid) { homeCloudProjectsCache = null; return Promise.resolve([]); }
    if (homeCloudProjectsCache?.uid === requestUid && Date.now() - homeCloudProjectsCache.time < 30000) return Promise.resolve(homeCloudProjectsCache.projects);
    if (homeCloudProjectsRequest && homeCloudProjectsRequestUid === requestUid) {
        return homeCloudProjectsRequest;
    }

    homeCloudProjectsRequestUid = requestUid;
    const request = withHomeDeadline(fetchCloudProjects({includeTrash:true})).then(projects => {
        if (state.uid === requestUid && homeCloudProjectsRequestToken === requestToken) homeCloudProjectsCache = { uid: requestUid, time: Date.now(), projects };
        return projects;
    }).catch((e) => {
        console.warn('[Home] Failed to load cloud projects:', e);
        return null;
    });
    const requestToken = ++homeCloudProjectsRequestToken;
    const requestWithCleanup = request.finally(() => {
        if (homeCloudProjectsRequestToken === requestToken) {
            homeCloudProjectsRequest = null;
            homeCloudProjectsRequestUid = '';
        }
    });
    homeCloudProjectsRequest = requestWithCleanup;
    return requestWithCleanup;
}

async function renderHomeDashboard({ refreshSpaces = true, forceRefresh = false } = {}) {
    // Space navigation only changes the filter; keep the short-lived account cache.
    if (forceRefresh) { homeCloudProjectsCache = null; homeCloudProjectsRequest = null; ++homeCloudProjectsRequestToken; }
    const renderRevision = ++homeDashboardRenderRevision;
    const cloudGrid = document.getElementById('home-cloud-grid');
    const localGrid = document.getElementById('home-local-grid');
    const cloudCount = document.getElementById('home-cloud-count');
    const localCount = document.getElementById('home-local-count');
    const statsEl = document.getElementById('home-dashboard-stats');
    const workGrid = document.getElementById('home-work-grid');
    const workCount = document.getElementById('home-work-count');
    if (!cloudGrid || !localGrid) return;

    const trashRoot = document.getElementById('home-project-trash');
    if(trashRoot)trashRoot.textContent = getUILang()==='en'?'Loading Trash…':'ゴミ箱を読み込んでいます…';
    if (statsEl) statsEl.innerHTML = renderHomeStatCard('sync', t('home_loading'), '...', '');
    if (workGrid) workGrid.innerHTML = homeLoadingMarkup(t('home_loading'));
    if (workCount) workCount.textContent = '...';
    cloudGrid.innerHTML = homeLoadingMarkup(t('home_loading'));
    localGrid.innerHTML = homeLoadingMarkup(t('home_loading'));
    if (cloudCount) cloudCount.textContent = '...';
    if (localCount) localCount.textContent = '...';

    const dashboardUid = state.uid;
    const spaceUI = getPublishingSpaceUI();
    if (refreshSpaces && navigator.onLine) void spaceUI.load({ notify: true });
    else spaceUI.render();
    getHomeWorkspace().render({spaceKind:spaceUI.viewKind?.()||'all'});
    syncSpaceMembersSettings();
    syncStudioInbox();
    const joined=spaceUI.joinedSelection?.();
    document.getElementById('home-room')?.classList.toggle('home-joined-space',!!joined);
    const cloudProjectsPromise = !navigator.onLine ? null : fetchHomeCloudProjects();
    void refreshRecentWorks({force:forceRefresh,keepCloudRequest:true});
    let localProjects = [], statsInput = null;
    void cloudProjectsPromise?.then(() => {
        if (renderRevision !== homeDashboardRenderRevision || state.uid !== dashboardUid) return;
        refreshHomeLocalSpaceLabels(localGrid, localProjects);
    });
    void withHomeDeadline(listLocalRecentProjects(), 5000).then(projects => {
        if (renderRevision !== homeDashboardRenderRevision || state.uid !== dashboardUid) return;
        localProjects = projects;
        renderHomeLocalProjects(localGrid, localCount, localProjects);
        if (statsEl && statsInput) statsEl.innerHTML = renderHomeDashboardStats(statsInput = { ...statsInput, localProjects });
    }).catch(e => {
        if (renderRevision !== homeDashboardRenderRevision || state.uid !== dashboardUid) return;
        console.warn('[Home] Failed to load local recent projects:', e);
        localGrid.innerHTML = `<div class="home-empty-state"><p>${getUILang() === 'en' ? 'Browser working copies could not be loaded.' : 'このブラウザの作業コピーを読み込めませんでした。'}</p><button class="home-action-btn" data-home-retry>${getUILang() === 'en' ? 'Retry' : '再試行'}</button></div>`;
        if (localCount) localCount.textContent = '!';
        localGrid.querySelector('[data-home-retry]')?.addEventListener('click', () => void renderHomeDashboard({ refreshSpaces: false }));
    });

    if(!navigator.onLine){
        if(trashRoot)trashRoot.textContent=getUILang()==='en'?'Connect to load Trash.':'ゴミ箱は接続後に利用できます。';
        if(statsEl)statsEl.replaceChildren();
        if(cloudCount)cloudCount.textContent='—';
        if(workCount)workCount.textContent='—';
        const message=getUILang()==='en'?'Cloud works and publishing spaces are available when connected. Open a saved DSP or a working copy on this device.':'クラウド作品・出版スペースは接続後に利用できます。保存したDSPや、この端末の作業コピーから制作を続けられます。';
        for(const grid of [cloudGrid,workGrid]){if(!grid)continue;grid.replaceChildren();const p=document.createElement('p');p.className='home-empty-state';p.textContent=message;grid.append(p);}
        return;
    }
    if(joined){
        if(trashRoot)trashRoot.textContent=getUILang()==='en'?'The owner manages these manuscripts.':'このスペースの原稿は所有者が管理します。';
        const en=getUILang()==='en';
        const scope=document.getElementById('home-cloud-scope');if(scope)scope.textContent=(en?'Shared works / ':'共有作品 / ')+spaceUI.label();
        const heading=document.querySelector('[data-home-cloud-heading]');if(heading)heading.textContent=en?'Shared works':'共有作品';
        const hint=document.querySelector('.home-overview-hint');if(hint)hint.textContent=en?'Only works you have access to are shown.':'あなたに共有されている作品だけを表示します。';
        if(statsEl)statsEl.replaceChildren();if(workCount)workCount.textContent='—';
        if(workGrid)workGrid.textContent=en?'Publication management is handled by the owner.':'公開状況の管理は所有者が行います。';
        await renderJoinedSpaceWorks({root:cloudGrid,count:cloudCount,spaceId:joined.id,
            execute:createInvitationsClient({getUser:()=>firebaseAuth.currentUser}),getLocale:getUILang,
            isCurrent:()=>renderRevision===homeDashboardRenderRevision&&state.uid===dashboardUid&&spaceUI.joinedSelection?.()?.id===joined.id});
        return;
    }
    const allCloudProjects = await cloudProjectsPromise;
    if (renderRevision !== homeDashboardRenderRevision || state.uid !== dashboardUid) return;
    const modifiedTime = project => {
        const value = project.lastUpdated || project.updatedAt;
        return Number(value?.toMillis?.() || (value?.seconds ? value.seconds * 1000 : 0) || (typeof value === 'number' ? value : Date.parse(value)) || 0);
    };
    const spaceUnavailable=!!state.uid&&Array.isArray(allCloudProjects)&&spaceUI.viewKind?.()!=='all'&&spaceUI.catalogueReady?.()===false;
    const spaceProjects = spaceUnavailable?null:Array.isArray(allCloudProjects) ? [...spaceUI.filter(allCloudProjects)].sort((a,b)=>modifiedTime(b)-modifiedTime(a)) : allCloudProjects;
    const cloudProjects = Array.isArray(spaceProjects) ? spaceProjects.filter(p=>!p.projectTrash) : spaceProjects;
    renderProjectTrash({root:trashRoot,projects:state.uid?spaceProjects:null,en:getUILang()==='en',
        spaceLabel:pid=>{const d=spaceUI.destinations();if(!d)return getUILang()==='en'?'Not confirmed':'未確認';const id=d.assignments[pid];return id?(d.spaces.find(s=>s.id===id)?.name||(getUILang()==='en'?'Unknown space':'不明なスペース')):(getUILang()==='en'?'My Space':'マイスペース');},
        onRestore:async pid=>{await restoreCloudProject(pid,dashboardUid);if(state.uid===dashboardUid)await renderHomeDashboard({forceRefresh:true});},
        onPublication:()=>getHomeWorkspace().select('activity'),onRetry:()=>void renderHomeDashboard({forceRefresh:true})});
    const scopeLabel = document.getElementById('home-cloud-scope');
    if (scopeLabel) scopeLabel.textContent = spaceUI.destination() + ' / ' + spaceUI.label();

    const works = Array.isArray(spaceProjects)
        ? spaceProjects.filter(isPublishedHomeWork).sort((a, b) => {
            const aTime = Number(a?.dsfPublishedAt?.toMillis?.() || a?.updatedAt?.toMillis?.() || 0);
            const bTime = Number(b?.dsfPublishedAt?.toMillis?.() || b?.updatedAt?.toMillis?.() || 0);
            return bTime - aTime;
        })
        : [];
    const pendingReviewSummaries = new Map(
        works.slice(0, 6).map((work) => [work.workId || work.id, { loading: true }])
    );
    const emptyReviewTotals = { reviewCount: 0, goodCount: 0, badCount: 0 };

    if (statsEl) {
        statsEl.innerHTML = renderHomeDashboardStats(statsInput = {
            cloudProjects: Array.isArray(cloudProjects) ? cloudProjects : [],
            localProjects,
            works,
            reviewTotals: emptyReviewTotals,
            reviewsLoading: works.length > 0
        });
    }
    if (workCount) workCount.textContent = String(works.length);
    if (workGrid) {
        if (!state.uid) {
            workGrid.innerHTML = `<div class="home-empty-state"><span class="material-icons">lock</span><p>${t('home_cloud_login')}</p></div>`;
        } else if (cloudProjects === null) {
            workGrid.innerHTML = `<div class="home-empty-state"><span class="material-icons">cloud_off</span><p>${t('home_cloud_error')}</p></div>`;
        } else if (!works.length) {
            workGrid.innerHTML = `
                <div class="home-empty-state">
                    <span class="material-icons">rocket_launch</span>
                    <p>${t('home_works_empty')}</p>
                    <button class="home-action-btn" data-home-nav="projects"><span class="material-icons">library_books</span>${getUILang() === 'en' ? 'Choose a work' : '作品を選ぶ'}</button>
                </div>`;
        } else {
            workGrid.innerHTML = works.slice(0, 6).map((work) => renderHomeWorkCard(work, pendingReviewSummaries.get(work.workId || work.id))).join('');
        }
    }

    if (cloudProjects === null) {
        cloudGrid.innerHTML = `<div class="home-empty-state"><span class="material-icons">cloud_off</span><p>${t('home_cloud_error')}</p></div>`;
        if (cloudCount) cloudCount.textContent = '!';
    } else if (!state.uid) {
        cloudGrid.innerHTML = `<div class="home-empty-state"><span class="material-icons">lock</span><p>${t('home_cloud_login')}</p></div>`;
        if (cloudCount) cloudCount.textContent = '0';
    } else if (cloudProjects.length === 0) {
        cloudGrid.innerHTML = `<div class="home-empty-state"><span class="material-icons">cloud_done</span><p>${spaceUI.selection() ? (getUILang() === 'en' ? 'No manuscripts in this publishing space yet.' : 'この出版スペースにはまだ原稿がありません。') : t('home_cloud_empty')}</p><button class="home-action-btn primary" onclick="newSpaceProject()">${getUILang() === 'en' ? 'Create your first work' : '最初の作品を作成'}</button></div>`;
        if (cloudCount) cloudCount.textContent = '0';
    } else {
        cloudGrid.innerHTML = cloudProjects.map((project) => renderHomeCard(project, 'cloud')).join('');
        if (cloudCount) cloudCount.textContent = String(cloudProjects.length);
    }

    if(spaceUnavailable){
        cloudGrid.innerHTML='<div class="home-empty-state"><p>'+(getUILang()==='en'?'Your save locations could not be confirmed yet. Retry to load this space.':'保存先をまだ確認できていません。再試行して、このスペースの作品を読み込んでください。')+'</p></div>';
    }
    if (cloudProjects === null) for (const grid of [cloudGrid, workGrid]) {
        const retry = document.createElement('button');
        retry.className = 'home-action-btn'; retry.textContent = getUILang() === 'en' ? 'Retry' : '再試行';
        retry.dataset.homeRetry = '';
        retry.addEventListener('click', () => void renderHomeDashboard({ refreshSpaces: spaceUnavailable, forceRefresh: true }));
        grid?.querySelector('.home-empty-state')?.append(retry);
    }

    cloudGrid.querySelectorAll('.home-project-card').forEach((card) => {
        card.addEventListener('click', async () => {
            const pid = card.dataset.id;
            if (!pid) return;
            if (!await onLoadProject(pid)) return;
            cacheLocalRecentProject(JSON.parse(JSON.stringify(state)), window.localImageMap).catch(() => {});
            window.switchRoom('editor');
        });
    });

    bindProjectActions(cloudGrid,async(action,pid)=>{
        const project=(cloudProjects||[]).find(p=>p.id===pid);if(!project)return;
        const displayName=project.projectName||project.title||pid,en=getUILang()==='en';
        if(action==='edit'){if(await onLoadProject(pid))window.switchRoom('editor');return;}
        if(action==='preview'){
            try{await refreshCloudProjectListing(pid);await renderHomeDashboard({forceRefresh:true});}
            catch(e){alert(e.message==='PREVIEW_OPEN_AND_SAVE'?(en?'Open this project and save it to refresh its thumbnail.':'このプロジェクトは編集画面で開いて保存すると一覧画像が更新されます。'):(en?'Could not update the thumbnail. Please retry.':'一覧画像を更新できませんでした。再試行してください。'));}return;
        }
        if(action==='delete'){
            if(!await confirmProjectTrash(displayName,en))return;
            try{await deleteCloudProject(pid,dashboardUid);if(state.uid===dashboardUid)await renderHomeDashboard({forceRefresh:true});}
            catch(err){alert(projectTrashError(err,en));}return;
        }
        const destinations=spaceUI.destinations();
        if(!destinations){alert(en?'Publishing spaces could not be loaded. Refresh the list.':'出版スペースを取得できませんでした。一覧を更新してください。');return;}
        const owner=state.uid;
        if(action==='share'){if(destinations.assignments[pid])return;openPersonalSharingDialog({projectId:pid,name:displayName,getLocale:getUILang,isCurrent:()=>state.uid===owner,execute:createPersonalSharingClient({getUser:()=>firebaseAuth.currentUser})});return;}
        if(action==='copy')openProjectCopyDialog({name:displayName,spaces:destinations.spaces,defaultSpaceId:destinations.assignments[pid]||null,getLocale:getUILang,
            createJob:()=>{if(state.uid!==owner)throw new Error('AUTH_CHANGED');return newCloudProjectCopyJob(pid);},
            onCreated:async result=>{if(state.uid!==owner)return;await renderHomeDashboard({forceRefresh:true});spaceUI.select(result.spaceId||'unassigned');}});
        if(action==='move')openProjectSpaceDialog({name:displayName,spaces:destinations.spaces,currentSpaceId:destinations.assignments[pid],en,
            onSave:async spaceId=>{if(state.uid!==owner||!await spaceUI.assign(pid,spaceId,destinations.assignments[pid]||null))throw new Error('SPACE_CONFLICT');}});
    });
    spaceUI.bind(cloudGrid);
    bindHomeWorkActions(workGrid, spaceProjects);
    syncStudioShell();

    if (!works.length) return;

    const reviewSummaries = await loadHomeReviewSummaries(works);
    if (renderRevision !== homeDashboardRenderRevision) return;

    const reviewTotals = works.reduce((acc, work) => {
        const summary = reviewSummaries.get(work.workId || work.id) || {};
        acc.reviewCount += Number(summary.reviewCount) || 0;
        acc.goodCount += Number(summary.goodCount) || 0;
        acc.badCount += Number(summary.badCount) || 0;
        return acc;
    }, { reviewCount: 0, goodCount: 0, badCount: 0 });

    if (statsEl) {
        statsEl.innerHTML = renderHomeDashboardStats(statsInput = {
            cloudProjects: Array.isArray(cloudProjects) ? cloudProjects : [],
            localProjects,
            works,
            reviewTotals
        });
    }
    if (workGrid) {
        workGrid.innerHTML = works.slice(0, 6).map((work) => (
            renderHomeWorkCard(work, reviewSummaries.get(work.workId || work.id))
        )).join('');
        bindHomeWorkActions(workGrid, cloudProjects);
    }
}

// ── Studio 認証 UI — GIS ボタン + フォールバック Google ──
//    実体のサインインは gis-auth.js。ここはマークアップとスロット束ね。

function isVerifiedFlowPortableDownloadControl(control) {
    return hasFlowGroups(state)
        && control?.hasAttribute('data-flow-portable-download')
        && control.dataset.flowPortableState === 'ready'
        && document.body?.dataset?.room === 'press';
}

function isFlowHorizonPublishControl(control) {
    return hasFlowGroups(state)
        && control?.id === 'press-publish-cloud-btn'
        && document.body?.dataset?.room === 'press';
}

function isReadyFlowHorizonPublishControl(control) {
    return isFlowHorizonPublishControl(control)
        && control?.dataset?.flowHorizonState === 'ready';
}

function getFlowHorizonPublishControlTitle(control) {
    const stateName = control?.dataset?.flowHorizonState;
    if (stateName === 'saved') return 'この配信内容はHorizonへ非公開draftとして保存済みです';
    if (stateName === 'working') return 'Horizonへ配信ファイルと非公開draftを保存しています';
    if (stateName === 'ready') return '検証済み配信ファイルをアップロードし、非公開draftとして保存します';
    return 'Horizon配信準備の検証完了後に有効になります';
}

function updateAuthUI() {
    const effectiveUser = state.user || firebaseAuth.currentUser || null;
    if (effectiveUser?.uid && state.uid !== effectiveUser.uid) {
        state.user = effectiveUser;
        state.uid = effectiveUser.uid;
    }
    const signedIn = !!(state.uid || effectiveUser?.uid);
    const saveStatus = document.getElementById('save-status');
    const authSlotNav = document.getElementById('studio-auth-slot-nav');
    const authSlotMobile = document.getElementById('studio-auth-slot-mobile');

    if (authSlotNav) renderStudioAuthSlot(authSlotNav, effectiveUser, { mobile: false, slotName: 'nav' });
    if (authSlotMobile) renderStudioAuthSlot(authSlotMobile, effectiveUser, { mobile: true, slotName: 'mobile' });

    syncAuthSaveStatus(saveStatus, {uid: effectiveUser?.uid || state.uid || '', local:!state.projectId, en: getUILang() === 'en'});
    document.body.classList.toggle('auth-guest', !signedIn);
    document.querySelectorAll('[data-auth-required]').forEach((el) => {
        if(el.id==='press-publish-cloud-btn'&&(!state.projectId||!signedIn)){el.disabled=false;el.title=getUILang()==='en'?'Choose a cloud space to continue':'クラウド保存先を選んで進む';return;}
        const flowPortableReady = isVerifiedFlowPortableDownloadControl(el);
        const flowHorizonControl = isFlowHorizonPublishControl(el);
        const flowHorizonReady = isReadyFlowHorizonPublishControl(el);
        const flowPublicationBlocked = el.hasAttribute('data-flow-publication-required')
            && hasFlowGroups(state)
            && !flowPortableReady
            && !flowHorizonReady;
        el.disabled = !signedIn || flowPublicationBlocked;
        el.title = !signedIn
            ? t('login_required')
            : (flowPublicationBlocked
                ? (flowHorizonControl
                    ? getFlowHorizonPublishControlTitle(el)
                    : 'FlowのローカルZIP検証完了後に有効になります')
                : (flowHorizonControl
                    ? getFlowHorizonPublishControlTitle(el)
                    : (flowPortableReady ? '検証済みFlow portable .dsfをローカルへ保存します' : '')));
    });
    document.querySelectorAll('[data-flow-publication-required]:not([data-auth-required])').forEach((el) => {
        const flowPortableReady = isVerifiedFlowPortableDownloadControl(el);
        const blocked = hasFlowGroups(state) && !flowPortableReady;
        el.disabled = blocked;
        el.title = blocked
            ? 'FlowのローカルZIP検証完了後に有効になります'
            : (flowPortableReady ? '検証済みFlow portable .dsfをローカルへ保存します' : '');
    });
    syncStudioShell();
}

function applyStudioAuthUser(user) {
    const nextUser=user||null;
    if(state.uid!==(nextUser?.uid||null)||state.user!==nextUser){
        dispatch({type:actionTypes.SET_AUTH_STATE,payload:{uid:nextUser?.uid||null,user:nextUser}});
        window.dispatchEvent(new Event('shared-recovery-account'));
    }
    syncStudioInbox();
    updateAuthUI();
    if (document.body?.dataset?.room === 'press' && hasFlowGroups(state)) {
        void refreshFlowHorizonDryRunReadiness();
    }
}

let studioAuthGlobalBound = false;
let studioAccount = null;

function escapeStudioHtml(value) {
    if (value == null) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function getStudioPlanDisplayName(account) {
    const tier = normalizePlanTier(account?.plan?.effectiveTier || account?.plan?.tier || 'free');
    const labels = {
        free: 'FREE',
        plus: 'PLUS',
        pro: 'PRO',
        business: 'BUSINESS',
    };
    return labels[tier] || tier.toUpperCase();
}

function getActiveLanguageWorkTitle() {
    const lang = state.activeLang || state.defaultLang || 'ja';
    const localizedTitle = state.meta?.[lang]?.title;
    if (localizedTitle) return localizedTitle;
    return lang === (state.defaultLang || 'ja') ? (state.title || '') : '';
}

function closeAllStudioAuthDropdowns() {
    document.querySelectorAll('.studio-auth-slot [data-auth-dropdown].open').forEach((dropdown) => {
        dropdown.classList.remove('open');
    });
    document.querySelectorAll('.studio-auth-slot [data-auth-trigger][aria-expanded="true"]').forEach((trigger) => {
        trigger.setAttribute('aria-expanded', 'false');
    });
}

function bindStudioAuthGlobalHandlers() {
    if (studioAuthGlobalBound) return;
    studioAuthGlobalBound = true;
    document.addEventListener('click', (event) => {
        if (event.target.closest('.studio-auth-slot')) return;
        closeAllStudioAuthDropdowns();
    });
}

function getStudioThemeButtonsMarkup() {
    const currentThemeMode = getThemeMode();
    return `
        <div class="auth-panel-section">
            <div class="auth-panel-label">${escapeStudioHtml(t('themeLabel'))}</div>
            <div class="theme-mode-switcher js-theme-switcher" role="group" aria-label="${escapeStudioHtml(t('themeLabel'))}">
                <button type="button" class="theme-mode-btn ${currentThemeMode === 'device' ? 'active' : ''}" data-theme-mode="device">${escapeStudioHtml(t('modeDevice'))}</button>
                <button type="button" class="theme-mode-btn ${currentThemeMode === 'light' ? 'active' : ''}" data-theme-mode="light">${escapeStudioHtml(t('modeLight'))}</button>
                <button type="button" class="theme-mode-btn ${currentThemeMode === 'dark' ? 'active' : ''}" data-theme-mode="dark">${escapeStudioHtml(t('modeDark'))}</button>
            </div>
        </div>
    `;
}

function getStudioAccountLinksMarkup(user) {
    return `
        <div class="auth-panel-links">
            ${user ? `<a href="/mypage.html" class="auth-panel-link"><span class="material-icons">manage_accounts</span><span>${escapeStudioHtml(t('myPage'))}</span></a>` : ''}
            <button type="button" class="auth-panel-link"><span class="material-icons">visibility_off</span><span>${escapeStudioHtml(t('restrictedMode'))}</span></button>
            <button type="button" class="auth-panel-link"><span class="material-icons">public</span><span>${escapeStudioHtml(t('location'))}</span></button>
            <button type="button" class="auth-panel-link"><span class="material-icons">settings</span><span>${escapeStudioHtml(t('settings'))}</span></button>
            <button type="button" class="auth-panel-link" data-open-studio-help><span class="material-icons">help_outline</span><span>${escapeStudioHtml(t('help'))}</span></button>
            <button type="button" class="auth-panel-link"><span class="material-icons">feedback</span><span>${escapeStudioHtml(t('feedback'))}</span></button>
        </div>
    `;
}

function getStudioAuthMarkup(user, { mobile = false, slotName = 'nav' } = {}) {
    const displayName = escapeStudioHtml(user?.displayName || user?.email || t('guest_label'));
    const planName = user ? escapeStudioHtml(getStudioPlanDisplayName(studioAccount)) : '';
    const photoUrl = escapeStudioHtml(user?.photoURL || '');
    const initials = escapeStudioHtml((user?.displayName || user?.email || 'U').trim().charAt(0).toUpperCase() || 'U');
    const avatarLabel = user ? displayName : escapeStudioHtml(t('btn_signin'));
    const avatarInner = photoUrl
        ? `<img src="${photoUrl}" alt="${displayName}" referrerpolicy="no-referrer">`
        : user
            ? `<span class="auth-initials">${initials}</span>`
            : `<span class="material-icons" aria-hidden="true">account_circle</span>`;
    const gisButtonId = `gis-btn-studio-${slotName}`;
    const fallbackClass = mobile ? 'mobile-auth-btn studio-signin-fallback' : 'btn-tool studio-signin-fallback';
    const signedOutSection = user ? '' : `
        <div class="auth-panel-section studio-auth-signin-section">
            <div id="${gisButtonId}" class="studio-gis-slot"></div>
            <button type="button" class="${fallbackClass}" data-auth-signin-fallback>${escapeStudioHtml(mobile ? t('btn_auth_mobile') : t('btn_signin'))}</button>
        </div>
    `;

    return `
        <div class="auth-user studio-auth-user ${mobile ? 'is-mobile' : 'is-desktop'}">
            <button type="button" class="auth-avatar-btn studio-auth-trigger" data-auth-trigger aria-label="${avatarLabel}" aria-expanded="false">
                ${avatarInner}
            </button>
            <div class="auth-dropdown auth-panel studio-auth-dropdown" data-auth-dropdown>
                <div class="auth-dropdown-name">
                    <span class="auth-dropdown-display-name">${displayName}</span>
                    ${user ? `<span class="auth-dropdown-plan">${planName}</span>` : ''}
                </div>
                <div class="auth-panel-section"><div class="auth-panel-label">${getUILang()==='en'?'Language':'表示言語'}</div><div class="ui-lang-switcher" role="group" aria-label="${getUILang()==='en'?'Language':'表示言語'}">${['ja','en'].map(key=>`<button type="button" class="ui-lang-btn ${getUILang()===key?'active':''}" data-lang="${key}" data-ui-language="${key}" aria-pressed="${getUILang()===key}">${key==='ja'?'日本語':'English'}</button>`).join('')}</div></div>
                ${getStudioThemeButtonsMarkup()}
                ${studioWebMCPMarkup()}
                ${signedOutSection}
                ${getStudioAccountLinksMarkup(user)}
                ${user ? `<button type="button" class="btn-signout" data-auth-signout>${escapeStudioHtml(t('btn_signout'))}</button>` : ''}
            </div>
        </div>
    `;
}

function updateStudioThemeSwitchers() {
    const currentThemeMode = getThemeMode();
    document.querySelectorAll('.studio-auth-slot .js-theme-switcher .theme-mode-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.themeMode === currentThemeMode);
    });
}

async function hydrateStudioAccount(user) {
    if(!navigator.onLine)return null;
    if (!user?.uid) {
        studioAccount = null;
        updateAuthUI();
        return null;
    }
    try {
        const account = await ensureUserBootstrap(user);
        if (firebaseAuth.currentUser?.uid !== user.uid) return null;
        studioAccount = account || null;
        updateAuthUI();
        return account;
    } catch (e) {
        console.warn('[Auth] user bootstrap failed:', e);
        return null;
    }
}

function mountStudioGisButton(container, { mobile = false } = {}) {
    if (state.uid) return;
    const gisTarget = container.querySelector('.studio-gis-slot')?.id;
    if (!gisTarget) return;
    const device = getDeviceKey();
    const renderGisHere = mobile ? device === 'mobile' : device === 'desktop';
    if (!renderGisHere) return;
    renderGISButton(gisTarget, {
        authInstance: firebaseAuth,
        buttonOptions: {
            theme: 'outline',
            size: 'medium',
            type: 'standard',
            shape: 'rectangular',
            text: 'signin_with',
            logo_alignment: 'left',
        }
    }).catch((error) => console.warn(`[Auth] GIS ${mobile ? 'mobile' : 'desktop'} button render failed:`, error));
}

function bindStudioAuthSlot(container, user, { mobile = false } = {}) {
    studioAI?.sync();
    const trigger = container.querySelector('[data-auth-trigger]');
    const dropdown = container.querySelector('[data-auth-dropdown]');
    trigger?.addEventListener('click', (event) => {
        event.stopPropagation();
        const willOpen = !dropdown?.classList.contains('open');
        closeAllStudioAuthDropdowns();
        dropdown?.classList.toggle('open', willOpen);
        trigger.setAttribute('aria-expanded', String(willOpen));
        if (willOpen && !user) {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => mountStudioGisButton(container, { mobile }));
            });
        }
    });
    dropdown?.addEventListener('click', async (event) => {
        const uiButton=event.target.closest('[data-ui-language]');
        if(uiButton){event.stopPropagation();const key=uiButton.dataset.uiLanguage;window.setStudioUILang(key);const next=container.querySelector('[data-auth-dropdown]');next?.classList.add('open');container.querySelector('[data-auth-trigger]')?.setAttribute('aria-expanded','true');container.querySelector(`[data-ui-language="${key}"]`)?.focus();return;}
        const themeBtn = event.target.closest('.theme-mode-btn');
        if (themeBtn?.dataset.themeMode) {
            setThemeMode(themeBtn.dataset.themeMode);
            updateStudioThemeSwitchers();
            return;
        }
        if (event.target.closest('[data-auth-signout]')) {
            try {
                await signOutUser(firebaseAuth);
            } catch (error) {
                console.error('[Auth] sign-out error:', error);
            }
            return;
        }
    });
    container.querySelector('[data-auth-signin-fallback]')?.addEventListener('click', async () => {
        try {
            const result = await signInWithGoogle({ authInstance: firebaseAuth });
            if (result?.user) {
                applyStudioAuthUser(result.user);
                closeAllStudioAuthDropdowns();
            }
        } catch (error) {
            console.error('[Auth] Google sign-in error:', error);
            alert(t('auth_google_failed', { message: error?.message || String(error) }));
        }
    });
}

function renderStudioAuthSlot(container, user, options = {}) {
    if (!container) return;
    bindStudioAuthGlobalHandlers();
    container.innerHTML = getStudioAuthMarkup(user, options);
    bindStudioAuthSlot(container, user, options);
}

// ── Studio shell — data-room・デバイス・サムネ列・リボン（editor 以外も共通） ─────────

const THUMB_COLUMN_OPTIONS = [8, 5, 4, 2, 1];
const MOBILE_THUMB_SIZE_MAP = { s: 4, m: 2, l: 1 };
const MOBILE_THUMB_SIZE_BY_COLS = { 4: 's', 2: 'm', 1: 'l' };

function getDeviceKey() {
    return window.innerWidth < 1024 ? 'mobile' : 'desktop';
}

function getCurrentRoom() {
    return document.body.dataset.room || 'editor';
}

function getRoomLabel(room) {
    const keyMap = {
        home: 'nav_dashboard',
        editor: 'nav_editor',
        press: 'nav_press',
        works: 'nav_works'
    };
    return t(keyMap[room] || 'mobile_title');
}

function getMobileHeaderTitle(room) {
    if (room === 'editor') {
        return state.projectName || state.title || t('project_title_default');
    }
    return getRoomLabel(room);
}

function getMobileHeaderNavTarget(room) {
    if (room === 'editor') return 'home';
    if (room === 'press') return 'editor';
    if (room === 'works') return 'home';
    return null;
}

function syncMobileHeader() {
    const room = getCurrentRoom();
    const navBtn = document.getElementById('mobile-header-nav');
    const roomLabel = document.getElementById('mobile-header-room-label');
    const title = document.getElementById('mobile-header-title');
    const navTarget = getMobileHeaderNavTarget(room);
    const roomText = getRoomLabel(room);

    if (roomLabel) {
        roomLabel.textContent = room === 'editor' ? roomText : t('mobile_title');
    }
    if (title) {
        title.textContent = getMobileHeaderTitle(room);
        title.title = title.textContent;
    }
    if (navBtn) {
        navBtn.hidden = !navTarget;
        navBtn.dataset.targetRoom = navTarget || '';
        const backLabel = navTarget ? getRoomLabel(navTarget) : '';
        navBtn.title = backLabel;
        navBtn.setAttribute('aria-label', backLabel || roomText);
        const icon = navBtn.querySelector('.material-icons');
        if (icon) {
            icon.textContent = 'arrow_back';
        }
    }
}

function syncMobileCanvasZoomBar() {
    const zoomBar = document.getElementById('mobile-canvas-zoom-bar');
    if (!zoomBar) return;
    const flowSourceActive = document.getElementById('canvas-view')?.classList.contains('flow-authoring-active');
    const visible = getDeviceKey() === 'mobile' && getCurrentRoom() === 'editor' && !flowSourceActive;
    zoomBar.hidden = !visible;
    document.body.classList.toggle('mobile-canvas-zoom-visible', visible);
    if (visible) syncCanvasZoomUI();
}

function syncStudioShell() {
    const device = getDeviceKey();
    const room = getCurrentRoom();

    document.body.dataset.device = device;
    document.body.classList.toggle('mobile-shell', device === 'mobile');
    document.body.classList.toggle('mobile-editor-shell', device === 'mobile' && room === 'editor');

    if ((device !== 'mobile' || room !== 'editor') && typeof window.closeMobileSheet === 'function') {
        window.closeMobileSheet();
    }

    syncMobileHeader();
    syncMobileCanvasZoomBar();
    syncMobileMenuSheet();
    renderMobileBottomBar();
}

function getValidStudioRoom(room) {
    return ['home', 'editor', 'press', 'works'].includes(room) ? room : 'home';
}

function normalizeStudioRouteUrl() {
    const url = new URL(window.location.href);
    if (url.pathname.endsWith('/studio.html')) {
        url.pathname = url.pathname.replace(/\/studio\.html$/, '/studio');
        window.history.replaceState(window.history.state, '', url);
    }
}

function syncStudioRoomUrl(room) {
    const url = new URL(window.location.href);
    if (url.pathname.endsWith('/studio.html')) {
        url.pathname = url.pathname.replace(/\/studio\.html$/, '/studio');
    }
    if (!url.pathname.endsWith('/studio')) return;
    url.searchParams.set('room', getValidStudioRoom(room));
    window.history.replaceState(window.history.state, '', url);
}

function sanitizeThumbColumns(value) {
    const n = Number(value);
    if (THUMB_COLUMN_OPTIONS.includes(n)) return n;
    return 2;
}

function getMobileThumbSizeKey(value = state.thumbColumns) {
    const n = sanitizeThumbColumns(value);
    return MOBILE_THUMB_SIZE_BY_COLS[n] || 'm';
}

function ensureUiPrefs() {
    if (!state.uiPrefs || typeof state.uiPrefs !== 'object') {
        state.uiPrefs = {};
    }
    if (!state.uiPrefs.desktop || typeof state.uiPrefs.desktop !== 'object') {
        state.uiPrefs.desktop = {};
    }
    if (!state.uiPrefs.mobile || typeof state.uiPrefs.mobile !== 'object') {
        state.uiPrefs.mobile = {};
    }
    state.uiPrefs.desktop.thumbColumns = sanitizeThumbColumns(state.uiPrefs.desktop.thumbColumns);
    state.uiPrefs.mobile.thumbColumns = sanitizeThumbColumns(state.uiPrefs.mobile.thumbColumns);
}

function applyThumbColumnsFromPrefs() {
    ensureUiPrefs();
    const key = getDeviceKey();
    dispatch({ type: actionTypes.SET_THUMB_COLUMNS, payload: { columns: state.uiPrefs[key].thumbColumns, device: key } });
}

function syncThumbColumnButtons() {
    const active = sanitizeThumbColumns(state.thumbColumns);
    document.querySelectorAll('[data-thumb-cols]').forEach((btn) => {
        const isActive = Number(btn.dataset.thumbCols) === active;
        btn.classList.toggle('active', isActive);
    });
    const activeSize = getMobileThumbSizeKey(active);
    document.querySelectorAll('[data-thumb-size]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.thumbSize === activeSize);
    });
}

function setCurrentDeviceThumbColumns(cols) {
    ensureUiPrefs();
    const key = getDeviceKey();
    dispatch({ type: actionTypes.SET_THUMB_COLUMNS, payload: { columns: cols, device: key } });
}



// ──────────────────────────────────────
//  refresh — 画面全体を再描画する (Gen3: image pages only)
// ──────────────────────────────────────
function refresh(options = {}) {
    window.dispatchEvent(new Event('local-draft-status'));
    const restoreButton = document.getElementById('btn-restore-private-authoring');
    if (restoreButton) {
        let available = false;
        try { available = !!getLoadedPrivateAuthoringHead(); } catch { /* stale auth session */ }
        restoreButton.hidden = !available;
    }

    for(const s of state.sections||[])if(s.objectOrder)initializeGraphicObjects(s,()=>createId('bubble'));
    refreshCanvasTranslationPanel();
    _flowCompare?.labels();
    if (_flowCompare?.enabled && (!['flow','page'].includes(getActiveBlock()?.kind) || (getActiveBlock()?.kind === 'flow' && isFlowSourceSelected(getActiveBlock().id)))) {
        _flowCompare.setEnabled(false); return;
    }
    projectAssetPanel.render();
    const skipAncillary = !!options.skipAncillary;
    const skipThumbs = !!options.skipThumbs;
    const visSelect = document.getElementById('prop-visibility');
    if (visSelect && document.activeElement !== visSelect) {
        visSelect.value = state.visibility || 'private';
    }

    syncBlocksFromState();
    const activeBlock = getActiveBlock();
    const flowPreviewTargetBlock = getFlowPreviewTargetBlock(activeBlock);
    const s = state.sections[state.activeIdx];
    const render = document.getElementById('content-render');
    const lang = state.activeLang;
    const langProps = getLangProps(lang);
    const isFlowReadOnly = activeBlock?.kind === 'flow'
        || (!s && state.version === 6 && (state.blocks || []).some((block) => block?.kind === 'flow'));
    const isFlowAuthoring = activeBlock?.kind === 'flow' && isFlowSourceSelected(activeBlock.id);
    const nextFlowContext = `${activeBlock?.id}:${getEditorFlowProjectionLanguage(activeBlock)}`;
    if (_flowCanvasContextKey && _flowCanvasContextKey !== nextFlowContext) {
        clearFlowDirectEditRuntime();
    }
    if (_flowDirectEditProxy && (!isFlowReadOnly || isFlowAuthoring)) clearFlowDirectEditRuntime();
    if (isFlowAuthoring || isFixedLanguageCompareActive() || !['page', 'flow'].includes(activeBlock?.kind)) {
        hideFlowCanvas();
    }
    setFlowAuthoringSurfaceVisible(isFlowAuthoring);
    render.classList.toggle('flow-editor-preview-active', isFlowReadOnly && !isFlowAuthoring);
    const flowAuthoringProps = document.getElementById('flow-authoring-props');
    if (flowAuthoringProps) flowAuthoringProps.hidden = !isFlowAuthoring;
    const flowAuthoringLanguage = document.getElementById('flow-authoring-language');
    if (flowAuthoringLanguage && isFlowAuthoring) {
        flowAuthoringLanguage.textContent = getFlowAuthoringLanguage(activeBlock).toUpperCase();
    }
    syncFlowAuthoringWritingModeControl(activeBlock, isFlowAuthoring);
    syncFlowPageSourceControls();

    // Normalize stale bubble selection
    if (state.activeBubbleIdx !== null && (!s?.bubbles || !s.bubbles[state.activeBubbleIdx])) {
        dispatch({ type: actionTypes.SET_ACTIVE_BUBBLE_INDEX, payload: null });
    }

    // メインキャンバスの描画 — image pages only
    if (isFlowAuthoring) {
        renderFlowAuthoringSurface(activeBlock, getEditorPageProjection());
        const pageLockNote = document.getElementById('page-lock-note');
        if (pageLockNote) {
            const sourceLanguage = activeBlock.flow?.document?.sourceLanguage || 'ja';
            const authoringLanguage = getFlowAuthoringLanguage(activeBlock);
            pageLockNote.textContent = authoringLanguage === sourceLanguage
                ? (getUILang()==='en'?`Editing source manuscript (${sourceLanguage.toUpperCase()})`:`Flow原稿を編集中（原稿言語 ${sourceLanguage.toUpperCase()}）`)
                : (getUILang()==='en'?`Editing translation (${authoringLanguage.toUpperCase()}; shared structure with ${sourceLanguage.toUpperCase()})`:`Flow翻訳を編集中（${authoringLanguage.toUpperCase()} / 構造は ${sourceLanguage.toUpperCase()} と共通）`);
            pageLockNote.style.display = 'block';
        }
        requestEditorFlowProjection(activeBlock);
        _hideTextPreviewOverlay();
        const imageProps = document.getElementById('image-only-props');
        if (imageProps) imageProps.style.display = 'none';
        const bubbleLayer = document.getElementById('bubble-layer');
        if (bubbleLayer) {
            bubbleLayer.innerHTML = '';
            bubbleLayer.style.display = 'none';
        }
        const bubbleShapeProps = document.getElementById('bubble-shape-props');
        if (bubbleShapeProps) bubbleShapeProps.style.display = 'none';
    } else if (isFlowReadOnly) {
        render.innerHTML = `
            <div id="flow-readonly-placeholder">
                <span class="material-icons">article</span>
                <strong>Flowテキスト</strong>
                <span data-flow-progress>ページ生成中…</span>
                <span>本文をクリックして編集できます。原稿全体は「原稿を開く」から開けます。</span>
            </div>`;
        syncFlowDirectFormatControls();
        const pageLockNote = document.getElementById('page-lock-note');
        if (pageLockNote) {
            pageLockNote.textContent = getUILang() === 'en' ? 'Generating Flow pages… (read-only)' : 'Flow原稿のページを生成中…（読取専用）';
            pageLockNote.style.display = 'block';
        }
        requestEditorFlowProjection(flowPreviewTargetBlock);
        _hideTextPreviewOverlay();
        const imageProps = document.getElementById('image-only-props');
        if (imageProps) imageProps.style.display = 'none';
        const bubbleLayer = document.getElementById('bubble-layer');
        if (bubbleLayer) {
            bubbleLayer.innerHTML = '';
            bubbleLayer.style.display = 'none';
        }
        const bubbleShapeProps = document.getElementById('bubble-shape-props');
        if (bubbleShapeProps) bubbleShapeProps.style.display = 'none';
    } else if (s && s.type === 'image') {
        const pos = getActiveImagePosition();
        if (!s.imageBasePosition) {
            s.imageBasePosition = { x: 0, y: 0, scale: 1, rotation: 0, flipX: false };
        }
        const bgUrl = getOptimizedImageUrl(s.backgrounds?.[state.activeLang] || s.backgrounds?.[state.defaultLang] || s.background || '');
        _hideTextPreviewOverlay();

        if (!bgUrl) {
            // 画像未設定 → アップロード誘導プレースホルダーを表示
            render.innerHTML = `<div id="image-upload-placeholder" onclick="document.getElementById('file-upload').click()">
                <span class="material-icons">add_photo_alternate</span>
                <span class="placeholder-main" data-i18n="placeholder_drop_image">画像をドロップ</span>
                <span class="placeholder-sub" data-i18n="placeholder_or_click">またはクリックして選択</span>
            </div>`;
            document.getElementById('image-only-props').style.display = 'block';
            document.getElementById('bubble-layer').style.display = 'none';
        } else {
            const { frameMetrics, targetTransform, invScale } = getImageAdjustRenderMetrics(bgUrl, pos, getSpreadImageRenderOptions(s, state.activeIdx));
            const targetStyle = [
                `width:${frameMetrics.widthPercent}%`,
                `height:${frameMetrics.heightPercent}%`,
                `transform:${targetTransform};`
            ].join('; ');
            const stageOverlay = isImageAdjusting ? `
                <div id="image-stage-overlay">
                    <div class="image-safe-frame${imageSnapState.edgeLeft ? ' active-left' : ''}${imageSnapState.edgeRight ? ' active-right' : ''}${imageSnapState.edgeTop ? ' active-top' : ''}${imageSnapState.edgeBottom ? ' active-bottom' : ''}"></div>
                    <div class="image-center-guide vertical${imageSnapState.centerX ? ' active' : ''}"></div>
                    <div class="image-center-guide horizontal${imageSnapState.centerY ? ' active' : ''}"></div>
                </div>
            ` : '';

            const overlayInTarget = isImageAdjusting ? `
                <div id="image-adjust-overlay" style="--inv-handle-scale:${invScale};">
                    <div class="adjust-frame"></div>
                    <button class="img-handle corner nw" onmousedown="startImageHandleDrag(event, 'nw')" ontouchstart="startImageHandleDrag(event, 'nw')" title="左上ハンドル"></button>
                    <button class="img-handle corner ne" onmousedown="startImageHandleDrag(event, 'ne')" ontouchstart="startImageHandleDrag(event, 'ne')" title="右上ハンドル"></button>
                    <button class="img-handle corner sw" onmousedown="startImageHandleDrag(event, 'sw')" ontouchstart="startImageHandleDrag(event, 'sw')" title="左下ハンドル"></button>
                    <button class="img-handle corner se" onmousedown="startImageHandleDrag(event, 'se')" ontouchstart="startImageHandleDrag(event, 'se')" title="右下ハンドル"></button>
                    <button class="img-handle rotate" onmousedown="startImageHandleDrag(event, 'rotate')" ontouchstart="startImageHandleDrag(event, 'rotate')" title="回転ハンドル">⟳</button>
                </div>
            ` : '';

            render.innerHTML = `
                <div id="image-adjust-stage">
                    ${stageOverlay}
                    <div id="image-adjust-target" style="${targetStyle}">
                        <img id="main-img" src="${bgUrl}" onload="handleEditorImageLoad(event)">
                        ${overlayInTarget}
                    </div>
                </div>`;
            document.getElementById('image-only-props').style.display = 'block';
            document.getElementById('bubble-layer').style.display = 'block';
        }
    } else if (s && s.type === 'text') {
        render.innerHTML = '';
        document.getElementById('image-only-props').style.display = 'none';
        document.getElementById('bubble-layer').style.display = 'none';
        document.getElementById('bubble-shape-props').style.display = 'none';
        renderTextPreview(s);
    } else if (s) {
        render.innerHTML = '';
        document.getElementById('image-only-props').style.display = 'none';
        document.getElementById('bubble-layer').style.display = 'none';
        document.getElementById('bubble-shape-props').style.display = 'none';
        _hideTextPreviewOverlay();
    }

    // 吹き出し描画
    const editingEl = document.activeElement;
    const isDirectEditing = editingEl && editingEl.classList.contains('bubble-text')
        && editingEl.getAttribute('contenteditable') === 'true';

    if (s && s.type === 'image' && !isDirectEditing) {
        document.getElementById('bubble-layer').innerHTML = (s.bubbles || []).map((b, i) =>
            renderBubbleHTML(b, i, i === state.activeBubbleIdx, langProps.defaultWritingMode || 'horizontal-tb')
        ).join('');
    }

    // パネルUIの同期
    const propType = document.getElementById('prop-type');
    if (propType) {
        propType.disabled = isFlowReadOnly;
        if (!isFlowReadOnly) propType.value = s?.type || 'image';
    }
    const deleteBtn = document.getElementById('btn-delete-active');
    if (deleteBtn) {
        const canDeleteFlowSource = isFlowAuthoring;
        const canDeleteSelection = canDeleteFlowSource || (!isFlowReadOnly && canDeleteActive());
        const deleteLabelKey = canDeleteFlowSource ? 'btn_delete_flow' : 'btn_delete';
        deleteBtn.disabled = !canDeleteSelection;
        deleteBtn.dataset.i18n = deleteLabelKey;
        deleteBtn.textContent = t(deleteLabelKey);
        deleteBtn.title = canDeleteFlowSource
            ? t('flow_delete_source_title')
            : isFlowReadOnly
                ? t('flow_delete_generated_title')
                : canDeleteSelection
                    ? ''
                    : '削除できない項目です';
    }
    if (!isFlowReadOnly) {
        const pageLockNote = document.getElementById('page-lock-note');
        if (pageLockNote) {
            pageLockNote.textContent = '';
            pageLockNote.style.display = 'none';
        }
    }
    const editableFixedSection = getEditableActiveFixedSection();
    const fixedPageEditingDisabled = !editableFixedSection;
    if (fixedPageEditingDisabled && isImageAdjusting) {
        exitImageAdjustmentModeUi();
    }
    document.querySelectorAll('[data-fixed-page-edit]').forEach((control) => {
        if (control.dataset.defaultTitle === undefined) {
            control.dataset.defaultTitle = control.title || '';
        }
        control.disabled = fixedPageEditingDisabled;
        control.title = fixedPageEditingDisabled ? 'ページ原稿または生成ページは読取専用です' : control.dataset.defaultTitle;
    });
    const activeBubbleLayer = document.getElementById('bubble-layer');
    if (activeBubbleLayer) {
        if (fixedPageEditingDisabled) activeBubbleLayer.style.pointerEvents = 'none';
        else if (!isImageAdjusting) activeBubbleLayer.style.pointerEvents = '';
    }
    document.querySelectorAll('[data-flow-publication-required]').forEach((control) => {
        if(control.id==='press-publish-cloud-btn'&&(!state.projectId||!state.uid)){control.disabled=false;control.title=getUILang()==='en'?'Choose a cloud space to continue':'クラウド保存先を選んで進む';return;}
        const needsAuth = control.hasAttribute('data-auth-required');
        const flowPortableReady = isVerifiedFlowPortableDownloadControl(control);
        const flowHorizonControl = isFlowHorizonPublishControl(control);
        const flowHorizonReady = isReadyFlowHorizonPublishControl(control);
        const blocked = hasFlowGroups(state) && !flowPortableReady && !flowHorizonReady;
        control.disabled = blocked || (needsAuth && !state.uid);
        control.title = needsAuth && !state.uid
            ? t('login_required')
            : (blocked
                ? (flowHorizonControl
                    ? getFlowHorizonPublishControlTitle(control)
                    : 'FlowのローカルZIP検証完了後に有効になります')
                : (flowHorizonControl
                    ? getFlowHorizonPublishControlTitle(control)
                    : (flowPortableReady ? '検証済みFlow portable .dsfをローカルへ保存します' : '')));
    });

    const isTextSection = editableFixedSection?.type === 'text';
    const isPageSection = editableFixedSection?.type === 'image' || editableFixedSection?.type === 'text';
    if (!isFlowReadOnly && hasFlowGroups(state) && !getEditorPageProjection()) {
        if (flowPreviewTargetBlock) requestEditorFlowProjection(flowPreviewTargetBlock);
    }

    // FAB「テキスト追加」ボタンをテキストページでは非表示

    // テキストページではキャンバスのクリックカーソルをデフォルトに戻す
    const canvasView = document.getElementById('canvas-view');
    if (canvasView) canvasView.style.cursor = (isTextSection || isFlowReadOnly) ? 'default' : '';

    // テキストセクション専用パネル
    const textSectionProps = document.getElementById('text-section-props');
    if (textSectionProps) {
        textSectionProps.style.display = isTextSection ? 'block' : 'none';
        if (isTextSection) {
            _syncTextSectionPanel(s);
        }
    }

    const pageHeadingProps = document.getElementById('canvas-page-heading-props');
    if (pageHeadingProps) pageHeadingProps.style.display = isPageSection ? 'flex' : 'none';
    if (isPageSection) {
        syncPageHeadingField(s);
    }
    renderEditorTocPreview();

    const hasSelectedBubble = !isTextSection && state.activeBubbleIdx !== null && s?.bubbles?.[state.activeBubbleIdx];

    // 吹き出しテキストエディター（バブル選択時のみ表示）
    const genericTextEditor = document.getElementById('generic-text-editor');
    if (genericTextEditor) genericTextEditor.style.display = hasSelectedBubble ? 'block' : 'none';

    // テキストエリア: バブル選択時のテキスト表示
    const propTextEl = document.getElementById('prop-text');
    if (propTextEl) {
        if (hasSelectedBubble) {
            propTextEl.value = getBubbleText(s.bubbles[state.activeBubbleIdx]);
        } else if (!isTextSection) {
            propTextEl.value = '';
        }
        propTextEl.style.display = hasSelectedBubble ? 'block' : 'none';
        propTextEl.readOnly = false;
    }

    // テキストラベルに現在の言語を表示
    const textLabel = document.getElementById('text-label');
    if (textLabel) {
        textLabel.textContent = `テキスト入力 [${langProps.label}]`;
    }

    // 吹き出し形状＆カラーセレクタの同期（テキストセクションでは非表示）
    const shapeProps = document.getElementById('bubble-shape-props');
    if (!isTextSection && state.activeBubbleIdx !== null && s?.bubbles?.[state.activeBubbleIdx]) {
        if (shapeProps) shapeProps.style.display = 'block';
        updateBubblePropPanel(s.bubbles[state.activeBubbleIdx]);
    } else {
        if (shapeProps) shapeProps.style.display = 'none';
        updateBubblePropPanel(null);
    }

    // プロジェクト名表示
    const titleEl = document.getElementById('project-title');
    if (titleEl && document.activeElement !== titleEl) {
        titleEl.textContent = getProjectDisplayName();
    }

    // 作品タイトル同期
    const propTitle = document.getElementById('prop-title');
    const titleLanguage = state.activeLang || state.defaultLang || 'ja';
    const titleLanguageProps = getLangProps(titleLanguage);
    const titleLanguageName = `${titleLanguageProps.label} ${titleLanguage.toUpperCase()}`;
    const propTitleLangBadge = document.getElementById('prop-title-lang-badge');
    if (propTitleLangBadge) {
        propTitleLangBadge.textContent = titleLanguageName;
    }
    if (propTitle && document.activeElement !== propTitle) {
        propTitle.value = getActiveLanguageWorkTitle();
    }
    if (propTitle) {
        propTitle.placeholder = getUILang()==='en'?t('placeholder_work_title'):(titleLanguageProps.placeholders?.title || t('placeholder_work_title'));
        const titleFieldLabel = t('label_work_title_for_language', { language: titleLanguageName });
        propTitle.setAttribute('aria-label', titleFieldLabel);
        propTitle.title = titleFieldLabel;
    }
    // 生成Flowページを含むruntime projectionとFixed互換ページを同じ番号体系で表示する。
    syncEditorPageCounters();
    syncPageNavigationSlider();

    // モバイル見開きボタンのアクティブ状態
    const mobileSpreadBtn = document.getElementById('btn-spread-view-mobile');
    if (mobileSpreadBtn) {
        mobileSpreadBtn.classList.toggle('active', !!(state.uiPrefs?.spreadView) && !hasFlowGroups(state));
        mobileSpreadBtn.disabled = hasFlowGroups(state);
    }

    // Explicit language comparison retains its existing paired editor; normal editing uses the shared strip.
    refreshSpreadPage();
    if (!isFlowAuthoring && !isFlowReadOnly) renderUnifiedFixedCanvas();

    syncImageRibbonContext({ active: editableFixedSection?.type === 'image',
        bubbleSelected: !!hasSelectedBubble, adjusting: isImageAdjusting,
        position: editableFixedSection?.type === 'image' ? getActiveImagePosition() : null });

    objectToolbar.render();
    flowSearch.update();
    const hasGraphicObjects=!!getActiveBlock()?.content?.graphicObjects?.length;
    document.getElementById('image-upload-placeholder')?.classList.toggle('graphic-page-placeholder',hasGraphicObjects);

    // 言語タブの更新
    if (!skipAncillary) {
        renderLangTabs();
        syncLangPanel();
        renderLangSettings();
        updateHistoryButtons();
    }
    if (!skipThumbs) {
        renderThumbs();
    }
    if (!skipAncillary) {
        syncThumbColumnButtons();
        syncStudioShell();
    }
}

function captureViewportSnapshot() {
    const sidebarPages = document.querySelector('.sidebar-pages');
    const editorMain = document.getElementById('editor-main');
    return {
        windowX: window.scrollX,
        windowY: window.scrollY,
        sidebarPagesScrollTop: sidebarPages?.scrollTop ?? 0,
        editorMainScrollTop: editorMain?.scrollTop ?? 0
    };
}

function restoreViewportSnapshot(snapshot) {
    if (!snapshot) return;
    requestAnimationFrame(() => {
        window.scrollTo(snapshot.windowX, snapshot.windowY);
        const sidebarPages = document.querySelector('.sidebar-pages');
        if (sidebarPages) sidebarPages.scrollTop = snapshot.sidebarPagesScrollTop;
        const editorMain = document.getElementById('editor-main');
        if (editorMain) editorMain.scrollTop = snapshot.editorMainScrollTop;
    });
}

function refreshForThumbSelection() {
    const snapshot = captureViewportSnapshot();
    refresh({ skipAncillary: true, skipThumbs: true });
    syncThumbSelectionDom();
    restoreViewportSnapshot(snapshot);
}

function syncThumbSelectionDom() {
    document.querySelectorAll('.flow-thumb-group').forEach(el => { el.dataset.groupSelected = String(el.dataset.flowGroupId === getActiveBlock()?.id); });
    document.querySelectorAll('.thumb-wrap, .thumb-row').forEach((el) => {
        const blockIndex = Number(el.dataset.blockIndex);
        const flowPageIndex = el.dataset.flowPageIndex === undefined
            ? null
            : Number(el.dataset.flowPageIndex);
        const activeBlock = getActiveBlock();
        const isFlowPage = Number.isInteger(flowPageIndex);
        const isActive = Number.isInteger(blockIndex)
            && blockIndex === state.activeBlockIdx
            && (
                isFlowPage
                    ? activeBlock?.kind === 'flow'
                        && !isFlowSourceSelected(activeBlock.id)
                        && flowPageIndex === getSelectedFlowRuntimePageIndex(activeBlock.id)
                    : activeBlock?.kind === 'flow'
                        ? isFlowSourceSelected(activeBlock.id)
                        : true
            );
        el.classList.toggle('active', isActive);
        el.setAttribute('aria-current', isActive ? 'true' : 'false');
    });
}

// ──────────────────────────────────────
//  言語UI
// ──────────────────────────────────────
function getEditorLangDirection(code) {
    const props = getLangProps(code);
    const fallback = props.directions?.[0]?.value || 'ltr';
    return state.languageConfigs?.[code]?.pageDirection || fallback;
}

function getEditorLangDirectionArrow(code) {
    return getEditorLangDirection(code) === 'rtl' ? '&lt;&lt;' : '&gt;&gt;';
}

function renderEditorLangTabContent(code) {
    const props = getLangProps(code);
    const codeLabel = String(code || '').toUpperCase();
    return `
        ${renderStudioLanguageBadge(code, 'lang-tab-badge')}
        <span class="lang-tab-label">${escapeStudioHtml(props.label)}</span>
        <span class="lang-tab-code">${escapeStudioHtml(codeLabel)}</span>
        <span class="lang-tab-dir">${getEditorLangDirectionArrow(code)}</span>
    `;
}

function canSwitchEditorLanguage() {
    return !_flowAuthoringComposing && _flowDirectEditProxy?.dataset.flowReflowPending !== 'true';
}
function refreshEditorLanguagePresentation() {
    const group=getActiveBlock();
    updateLanguagePresentation({state,group,busy:!canSwitchEditorLanguage(),onPrepare:()=>{
        if(!canSwitchEditorLanguage()||group?.kind!=='flow')return;
        let blocks=state.blocks;const languageKey=state.activeLang;
        for(const block of state.blocks){if(block.kind!=='flow'||block.flow.layout.typographyByLanguage[languageKey])continue;
            blocks=ensureFlowLanguageTypography(blocks,{groupId:block.id,languageKey,writingMode:getWritingModeFromConfigs(languageKey,state.languageConfigs)}).blocks;}
        if(blocks!==state.blocks)applyEditorSpineChange({blocks,activeBlockIndex:state.activeBlockIdx},{preserveFlowSource:isFlowSourceSelected(group.id)});
    },onIssue:ids=>{
        if(!canSwitchEditorLanguage()||group?.kind!=='flow')return;
        const pages=getEditorPageProjection()?.pages||[];
        const candidates=pages.filter(page=>page.groupId===group.id&&page.page?.fragments.some(f=>ids.includes(f.blockId)));
        const current=getSelectedFlowRuntimePageIndex(group.id);
        const next=candidates.find(page=>page.flowPageIndex>current)||candidates[0];
        if(next)window.changeFlowGeneratedPage(state.blocks.findIndex(b=>b.id===group.id),next.flowPageIndex);
    }});
}
function renderLangTabs() {
    const html = state.languages.map(code => {
        const active = code === state.activeLang ? 'active' : '';
        const label = `${t('language_content')}: ${languageName(code)} · ${String(code).toUpperCase()} · ${getEditorLangDirectionArrow(code)}`;
        return `<button class="lang-tab ${active}" onclick="switchLang('${code}')" title="${escapeStudioHtml(label)}">${renderEditorLangTabContent(code)}</button>`;
    }).join('');
    ['lang-tabs', 'lang-tabs-mobile', 'lang-tabs-top', 'lang-tabs-pages-panel'].forEach((id) => {
        const container = document.getElementById(id);
        if (container) container.innerHTML = html;
    });
}

function renderLangSettings() {
    const list = document.getElementById('lang-list');
    if (!list) return;
    const draft = _getPsSettingsSource();
    const languages = draft.languages || ['ja'];
    const configs = draft.languageConfigs || {};
    let defaultControl=document.getElementById('ps-default-language');
    if(!defaultControl){const label=document.createElement('label');label.className='ps-default-language';label.innerHTML='<span></span><select id="ps-default-language"></select><small></small>';list.before(label);defaultControl=label.querySelector('select');defaultControl.addEventListener('change',()=>{_capturePsInputsToDraft();_ensurePsDraft().defaultLang=defaultControl.value;renderProjectSettingsTable();});}
    defaultControl.parentElement.querySelector('span').textContent=t('language_default');
    defaultControl.parentElement.querySelector('small').textContent=t('language_default_hint');
    defaultControl.replaceChildren(...languages.map(key=>new Option(languageName(key)+' · '+key.toUpperCase(),key)));
    defaultControl.value=languages.includes(draft.defaultLang)?draft.defaultLang:languages[0];
    list.innerHTML = languages.map(code => {
        const props = getLangProps(code);
        const canRemove = languages.length > 1;
        const removeBtn = canRemove
            ? `<button class="btn-sm lang-item-remove" onclick="removeLang('${code}')">✕</button>`
            : '';

        // 複数方向対応の言語にはインラインセレクトを表示
        let dirSelect = '';
        if (props.directions && props.directions.length > 1) {
            const currentDir = configs?.[code]?.pageDirection || props.directions[0].value;
            const options = props.directions.map(d => {
                const sel = d.value === currentDir ? ' selected' : '';
                return `<option value="${d.value}"${sel}>${d.label}</option>`;
            }).join('');
            dirSelect = `<select class="lang-dir-select" onchange="changeLangDirection('${code}', this.value)">${options}</select>`;
        }

        return `<div class="lang-item"><span class="lang-item-label">${props.label}</span>${dirSelect}${removeBtn}</div>`;
    }).join('');
}

window.changeLangDirection = (code, dir) => {
    _capturePsInputsToDraft();
    const draft = _ensurePsDraft();
    if (!draft.languageConfigs) draft.languageConfigs = {};
    if (!draft.languageConfigs[code]) draft.languageConfigs[code] = {};
    draft.languageConfigs[code].pageDirection = dir;
    renderLangSettings();
    renderProjectSettingsTable();
};

// ──────────────────────────────────────
//  Undo/Redoボタンの有効/無効を更新
// ──────────────────────────────────────
function updateHistoryButtons() {
    const info = getHistoryInfo();
    const undoBtn = document.getElementById('btn-undo');
    const redoBtn = document.getElementById('btn-redo');
    if (undoBtn) undoBtn.disabled = !info.canUndo;
    if (redoBtn) redoBtn.disabled = !info.canRedo;
}

let thumbDragSourceIdx = null;
let thumbTouchState = null;
let suppressThumbClickUntil = 0;

function clearThumbDropHints() {
    document.querySelectorAll('.thumb-wrap').forEach((el) => {
        el.classList.remove(
            'drop-before',
            'drop-after',
            'drag-source',
            'preview-gap-left',
            'preview-gap-right',
            'preview-gap-left-edge',
            'preview-gap-right-edge'
        );
    });
    document.getElementById('thumb-drop-indicator')?.remove();
    document.getElementById('thumb-drop-preview')?.remove();
}

function getThumbElement(index) {
    return document.querySelector(`.thumb-wrap[data-section-index="${index}"]`);
}

function getSpreadGroupIdByIndex(index) {
    const idx = Number(index);
    if (!Number.isInteger(idx)) return '';
    return state.sections?.[idx]?.spreadImage?.groupId || '';
}

function getSpreadPairIndices(index) {
    const idx = Number(index);
    if (!Number.isInteger(idx)) return [];
    const groupId = getSpreadGroupIdByIndex(idx);
    if (!groupId) return [idx];
    const pair = (state.sections || [])
        .map((section, pageIdx) => section?.spreadImage?.groupId === groupId ? pageIdx : -1)
        .filter((pageIdx) => pageIdx >= 0)
        .sort((a, b) => a - b);
    return pair.length ? pair : [idx];
}

function getSpreadPairStart(index) {
    const pair = getSpreadPairIndices(index);
    return pair[0] ?? Number(index);
}

function getSpreadPairEnd(index) {
    const pair = getSpreadPairIndices(index);
    return pair[pair.length - 1] ?? Number(index);
}

function addThumbClassToSpreadPair(index, className) {
    getSpreadPairIndices(index).forEach((pageIdx) => {
        getThumbElement(pageIdx)?.classList.add(className);
    });
}

function setThumbDeleteDropzoneActive(active) {
    const zone = document.getElementById('thumb-delete-dropzone');
    if (!zone) return;
    zone.classList.toggle('is-active', !!active);
}

function clearThumbDeleteDropzone() {
    document.body.classList.remove('thumb-delete-mode');
    setThumbDeleteDropzoneActive(false);
}

function isPointInThumbDeleteDropzone(clientX, clientY) {
    const zone = document.getElementById('thumb-delete-dropzone');
    if (!zone || zone.offsetParent === null) return false;
    const rect = zone.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

function getThumbTargetFromPoint(clientX, clientY) {
    const hit = document.elementFromPoint(clientX, clientY);
    const direct = hit ? hit.closest('.thumb-wrap') : null;
    if (direct) return direct;
    const container = document.getElementById('thumb-container');
    if (!container) return null;
    const thumbs = [...container.querySelectorAll('.thumb-wrap[data-section-index]')];
    if (!thumbs.length) return null;
    let nearest = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    thumbs.forEach((thumb) => {
        const rect = thumb.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const dist = Math.hypot(clientX - centerX, clientY - centerY);
        if (dist < nearestDistance) {
            nearest = thumb;
            nearestDistance = dist;
        }
    });
    return nearest;
}

function getThumbVisualThumbs() {
    const container = document.getElementById('thumb-container');
    if (!container) return [];
    return [...container.querySelectorAll('.thumb-wrap[data-section-index]')].sort((a, b) => {
        const rectA = a.getBoundingClientRect();
        const rectB = b.getBoundingClientRect();
        return rectA.left - rectB.left;
    });
}

function getMobileThumbInsertTarget(clientX) {
    const container = document.getElementById('thumb-container');
    if (!container) return null;
    const sourceIndex = Number(thumbTouchState?.sourceIndex ?? thumbDragSourceIdx);
    const sourceEl = getThumbElement(sourceIndex);
    if (!sourceEl) return null;
    const sourceRect = sourceEl.getBoundingClientRect();
    const sourcePair = new Set(getSpreadPairIndices(sourceIndex));
    const visualThumbs = getThumbVisualThumbs().filter((thumb) => !sourcePair.has(Number(thumb.dataset.sectionIndex)));
    const dir = container.dataset.dir === 'rtl' ? 'rtl' : 'ltr';
    if (!visualThumbs.length) {
        const containerRect = container.getBoundingClientRect();
        return {
            insertIndex: 0,
            boundary: containerRect.left + sourceRect.width / 2,
            top: sourceRect.top,
            height: sourceRect.height,
            sourceRect,
            leftEl: null,
            rightEl: null
        };
    }
    const rects = visualThumbs.map((thumb) => ({
        el: thumb,
        index: Number(thumb.dataset.sectionIndex),
        rect: thumb.getBoundingClientRect()
    }));
    const first = rects[0];
    const last = rects[rects.length - 1];
    if (clientX <= first.rect.left + first.rect.width / 2) {
        return {
            insertIndex: dir === 'rtl' ? first.index + 1 : first.index,
            boundary: first.rect.left,
            top: first.rect.top,
            height: first.rect.height,
            sourceRect,
            leftEl: null,
            rightEl: first.el
        };
    }
    for (let i = 0; i < rects.length - 1; i += 1) {
        const left = rects[i];
        const right = rects[i + 1];
        const midpoint = (left.rect.right + right.rect.left) / 2;
        if (clientX <= midpoint) {
            return {
                insertIndex: dir === 'rtl' ? left.index : right.index,
                boundary: (left.rect.right + right.rect.left) / 2,
                top: Math.min(left.rect.top, right.rect.top),
                height: Math.max(left.rect.height, right.rect.height),
                sourceRect,
                leftEl: left.el,
                rightEl: right.el
            };
        }
    }
    return {
        insertIndex: dir === 'rtl' ? last.index : last.index + 1,
        boundary: last.rect.right,
        top: last.rect.top,
        height: last.rect.height,
        sourceRect,
        leftEl: last.el,
        rightEl: null
    };
}

function showMobileThumbInsertPreview(target) {
    const container = document.getElementById('thumb-container');
    const sourceEl = getThumbElement(thumbTouchState?.sourceIndex ?? thumbDragSourceIdx);
    if (!container || !sourceEl || !target) return;
    clearThumbDropHints();
    addThumbClassToSpreadPair(thumbTouchState?.sourceIndex ?? thumbDragSourceIdx, 'drag-source');

    const containerRect = container.getBoundingClientRect();
    const leftPx = target.boundary - containerRect.left + container.scrollLeft;
    const topPx = target.top - containerRect.top + container.scrollTop;

    if (target.leftEl && target.rightEl) {
        target.leftEl.classList.add('preview-gap-right');
        target.rightEl.classList.add('preview-gap-left');
    } else if (target.leftEl) {
        target.leftEl.classList.add('preview-gap-right-edge');
    } else if (target.rightEl) {
        target.rightEl.classList.add('preview-gap-left-edge');
    }

    const indicator = document.createElement('div');
    indicator.id = 'thumb-drop-indicator';
    indicator.style.left = `${leftPx - 2}px`;
    indicator.style.top = `${topPx + 6}px`;
    indicator.style.height = `${Math.max(40, target.height - 12)}px`;
    container.appendChild(indicator);

    const preview = sourceEl.cloneNode(true);
    preview.id = 'thumb-drop-preview';
    preview.removeAttribute('onclick');
    preview.removeAttribute('ontouchstart');
    preview.removeAttribute('draggable');
    preview.style.width = `${target.sourceRect.width}px`;
    preview.style.minWidth = `${target.sourceRect.width}px`;
    preview.style.left = `${leftPx - target.sourceRect.width / 2}px`;
    preview.style.top = `${topPx}px`;
    container.appendChild(preview);
}

function markThumbDropHint(index, position) {
    clearThumbDropHints();
    addThumbClassToSpreadPair(thumbDragSourceIdx, 'drag-source');
    const targetIndex = position === 'before' ? getSpreadPairStart(index) : getSpreadPairEnd(index);
    const el = getThumbElement(targetIndex);
    if (!el) return;
    el.classList.add(position === 'before' ? 'drop-before' : 'drop-after');
}

function getDropPositionByPoint(el, clientX, clientY) {
    const rect = el.getBoundingClientRect();
    if (window.innerWidth < 1024) {
        const isRtl = window.getComputedStyle(el.parentElement).flexDirection === 'row-reverse';
        const before = clientX < (rect.left + rect.width / 2);
        if (isRtl) return before ? 'after' : 'before';
        return before ? 'before' : 'after';
    }
    return clientY < (rect.top + rect.height / 2) ? 'before' : 'after';
}

function moveSectionWithHistory(fromIndex, targetIndex, position) {
    if (state.version === 6) {
        const sourcePageIndex = Number(fromIndex);
        const targetPageIndex = position === 'before'
            ? getSpreadPairStart(targetIndex)
            : getSpreadPairEnd(targetIndex);
        const result = moveFixedPageRangeInSpine(state.blocks || [], {
            sourcePageIndex,
            targetPageIndex,
            position,
        });
        if (!result.changed) return false;

        const nextSections = result.blocks
            .filter((block) => block?.kind === 'page')
            .map(createSectionFromPageBlock);
        if (!validateSpreadImageCompositionForSections(nextSections)) return false;

        endHistoryGroup();
        pushState();
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'blocks', value: result.blocks } });
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'sections', value: nextSections } });
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'pages', value: blocksToPages(result.blocks) } });
        dispatch({ type: actionTypes.SET_ACTIVE_BLOCK_INDEX, payload: result.activeBlockIndex });
        dispatch({ type: actionTypes.SET_ACTIVE_INDEX, payload: result.activePageIndex });
        dispatch({ type: actionTypes.SET_ACTIVE_BUBBLE_INDEX, payload: null });
        invalidateFlowRuntimePages({ preserveSelection: true });
        refreshForThumbSelection();
        triggerAutoSave();
        return true;
    }
    const insertIndex = position === 'before' ? getSpreadPairStart(targetIndex) : getSpreadPairEnd(targetIndex) + 1;
    return moveSectionToInsertIndexWithHistory(fromIndex, insertIndex);
}

function moveSectionToInsertIndexWithHistory(fromIndex, insertIndex) {
    if (state.version === 6) return false;
    const from = Number(fromIndex);
    const pair = getSpreadPairIndices(from);
    if (pair.length > 1) {
        const fromStart = pair[0];
        const count = pair.length;
        let to = Math.max(0, Math.min(Number(insertIndex), state.sections.length));
        if (!Number.isInteger(fromStart) || !Number.isInteger(to)) return false;
        if (to > fromStart && to < fromStart + count) return false;
        if (to === fromStart || to === fromStart + count) return false;
        const simulated = [...(state.sections || [])];
        const moved = simulated.splice(fromStart, count);
        const simulatedTo = to > fromStart ? to - count : to;
        simulated.splice(simulatedTo, 0, ...moved);
        if (!validateSpreadImageCompositionForSections(simulated)) return false;
        pushState();
        moveSectionRange(fromStart, count, to, refresh);
        triggerAutoSave();
        return true;
    }
    let to = Math.max(0, Math.min(insertIndex, state.sections.length));
    if (to === from || to === from + 1) return false;
    const simulated = [...(state.sections || [])];
    const [moved] = simulated.splice(from, 1);
    const simulatedTo = to > from ? to - 1 : to;
    simulated.splice(simulatedTo, 0, moved);
    if (!validateSpreadImageCompositionForSections(simulated)) return false;
    pushState();
    moveSection(from, to, refresh);
    triggerAutoSave();
    return true;
}

function deleteSectionWithHistory(sectionIndex) {
    const idx = Number(sectionIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= state.sections.length) return false;
    if (state.sections.length <= 1) return false;
    pushState();
    deleteSectionAt(idx, refreshForThumbSelection);
    triggerAutoSave();
    return true;
}

function bindTouchDragListeners() {
    document.addEventListener('touchmove', onThumbTouchMove, { passive: false });
    document.addEventListener('touchend', onThumbTouchEnd, { passive: false });
    document.addEventListener('touchcancel', onThumbTouchCancel, { passive: false });
}

function unbindTouchDragListeners() {
    document.removeEventListener('touchmove', onThumbTouchMove);
    document.removeEventListener('touchend', onThumbTouchEnd);
    document.removeEventListener('touchcancel', onThumbTouchCancel);
}

function onThumbTouchMove(e) {
    if (!thumbTouchState) return;
    const touch = e.touches && e.touches[0];
    if (!touch) return;
    thumbTouchState.lastX = touch.clientX;
    thumbTouchState.lastY = touch.clientY;

    const dx = touch.clientX - thumbTouchState.startX;
    const dy = touch.clientY - thumbTouchState.startY;

    if (!thumbTouchState.active) {
        if (Math.abs(dx) > 18 && Math.abs(dx) > Math.abs(dy) + 6) {
            thumbTouchState = null;
            unbindTouchDragListeners();
            clearThumbDropHints();
            clearThumbDeleteDropzone();
            thumbDragSourceIdx = null;
            return;
        }
        if (dy <= -12 && Math.abs(dy) > Math.abs(dx) + 4) {
            thumbTouchState.active = true;
            thumbTouchState.mode = 'move';
            addThumbClassToSpreadPair(thumbTouchState.sourceIndex, 'drag-source');
        } else if (dy >= 12 && Math.abs(dy) > Math.abs(dx) + 4) {
            thumbTouchState.active = true;
            thumbTouchState.mode = 'delete';
            document.body.classList.add('thumb-delete-mode');
            setThumbDeleteDropzoneActive(false);
            addThumbClassToSpreadPair(thumbTouchState.sourceIndex, 'drag-source');
        } else {
            return;
        }
    }

    e.preventDefault();
    if (thumbTouchState.mode === 'delete') {
        clearThumbDropHints();
        setThumbDeleteDropzoneActive(isPointInThumbDeleteDropzone(touch.clientX, touch.clientY));
        return;
    }

    if (window.innerWidth < 1024) {
        const target = getMobileThumbInsertTarget(touch.clientX);
        if (target) {
            thumbTouchState.insertIndex = target.insertIndex;
            showMobileThumbInsertPreview(target);
        }
    } else {
        const wrap = getThumbTargetFromPoint(touch.clientX, touch.clientY);
        if (!wrap) return;
        const targetIndex = Number(wrap.dataset.sectionIndex);
        if (!Number.isInteger(targetIndex)) return;
        const position = getDropPositionByPoint(wrap, touch.clientX, touch.clientY);
        thumbTouchState.targetIndex = targetIndex;
        thumbTouchState.position = position;
        markThumbDropHint(targetIndex, position);
    }

    const container = document.getElementById('thumb-container');
    if (container) {
        const cRect = container.getBoundingClientRect();
        if (window.innerWidth < 1024) {
            if (touch.clientX < cRect.left + 40) container.scrollBy({ left: -24, behavior: 'auto' });
            if (touch.clientX > cRect.right - 40) container.scrollBy({ left: 24, behavior: 'auto' });
        } else {
            if (touch.clientY < cRect.top + 40) container.scrollBy({ top: -20, behavior: 'auto' });
            if (touch.clientY > cRect.bottom - 40) container.scrollBy({ top: 20, behavior: 'auto' });
        }
    }
}

function onThumbTouchEnd(e) {
    if (!thumbTouchState) return;
    const endTouch = e?.changedTouches?.[0];
    const endX = endTouch?.clientX ?? thumbTouchState.lastX ?? thumbTouchState.startX;
    const endY = endTouch?.clientY ?? thumbTouchState.lastY ?? thumbTouchState.startY;
    let changed = false;
    if (thumbTouchState.active) {
        if (thumbTouchState.mode === 'delete') {
            if (isPointInThumbDeleteDropzone(endX, endY)) {
                changed = deleteSectionWithHistory(thumbTouchState.sourceIndex);
            }
        } else {
            if (window.innerWidth < 1024) {
                const target = getMobileThumbInsertTarget(endX);
                if (target) {
                    thumbTouchState.insertIndex = target.insertIndex;
                    showMobileThumbInsertPreview(target);
                }
                if (Number.isInteger(thumbTouchState.insertIndex)) {
                    changed = moveSectionToInsertIndexWithHistory(thumbTouchState.sourceIndex, thumbTouchState.insertIndex);
                }
            } else {
                const endWrap = getThumbTargetFromPoint(endX, endY);
                if (endWrap) {
                    const endTargetIndex = Number(endWrap.dataset.sectionIndex);
                    if (Number.isInteger(endTargetIndex)) {
                        thumbTouchState.targetIndex = endTargetIndex;
                        thumbTouchState.position = getDropPositionByPoint(endWrap, endX, endY);
                        markThumbDropHint(endTargetIndex, thumbTouchState.position);
                    }
                }
                if (Number.isInteger(thumbTouchState.targetIndex)) {
                    changed = moveSectionWithHistory(thumbTouchState.sourceIndex, thumbTouchState.targetIndex, thumbTouchState.position || 'after');
                }
            }
        }
    } else if (thumbTouchState.mode === 'delete' && isPointInThumbDeleteDropzone(endX, endY)) {
        changed = deleteSectionWithHistory(thumbTouchState.sourceIndex);
    } else {
        changeSection(thumbTouchState.sourceIndex, refreshForThumbSelection);
        changed = true;
    }
    if (changed) {
        suppressThumbClickUntil = Date.now() + 350;
    }
    thumbTouchState = null;
    unbindTouchDragListeners();
    clearThumbDropHints();
    clearThumbDeleteDropzone();
    thumbDragSourceIdx = null;
}

function onThumbTouchCancel() {
    if (!thumbTouchState) return;
    thumbTouchState = null;
    unbindTouchDragListeners();
    clearThumbDropHints();
    clearThumbDeleteDropzone();
    thumbDragSourceIdx = null;
}

// ──────────────────────────────────────
//  セクションプロパティ更新
// ──────────────────────────────────────
function update(k, v) {
    const s = getEditableActiveFixedSection();
    if (!s) return;
    pushState();
    s[k] = v;
    refresh();
    triggerAutoSave();
}

// ──────────────────────────────────────
//  背景画像調整モード
// ──────────────────────────────────────
let isImageAdjusting = false;
let mobileAdjustViewBackup = null;
let imageHandleDrag = null;

function calcMobileAdjustScale(pos) {
    const view = document.getElementById('canvas-view');
    if (!view) return 0.6;
    const cw = view.clientWidth || CANONICAL_PAGE_WIDTH;
    const ch = view.clientHeight || CANONICAL_PAGE_HEIGHT;
    const halfW = CANONICAL_PAGE_WIDTH / 2;
    const halfH = CANONICAL_PAGE_HEIGHT / 2;
    const visibilityFactor = Math.max(
        1,
        pos?.scale || 1,
        1 + Math.abs(pos?.x || 0) / halfW,
        1 + Math.abs(pos?.y || 0) / halfH
    );
    const needW = CANONICAL_PAGE_WIDTH * visibilityFactor;
    const needH = CANONICAL_PAGE_HEIGHT * visibilityFactor;
    const s = Math.min(cw / needW, ch / needH) * 0.82;
    return Math.min(Math.max(s, 0.22), 0.9);
}

function isSpreadImageSection(section) {
    return section?.type === 'image'
        && section.spreadImage
        && typeof section.spreadImage === 'object'
        && !!section.spreadImage.groupId;
}

function getSpreadImagePhysicalRole(pageIndex) {
    const idx = Number(pageIndex);
    if (!Number.isInteger(idx) || idx < 0) return '';
    const adjIdx = getSpreadAdjacentPageIndexForRole(idx);
    if (adjIdx < 0) return '';
    const lang = state.activeLang || state.defaultLang || 'ja';
    const pageDir = getEditorLangDirection(lang);
    const pageOnLeft = pageDir === 'rtl' ? idx >= adjIdx : idx <= adjIdx;
    return pageOnLeft ? 'left' : 'right';
}

function getSpreadImageRenderOptions(section, pageIndex = -1) {
    if (!isSpreadImageSection(section)) return {};
    const resolvedIndex = Number.isInteger(pageIndex) && pageIndex >= 0
        ? pageIndex
        : (state.sections || []).indexOf(section);
    const physicalRole = getSpreadImagePhysicalRole(resolvedIndex);
    const role = physicalRole || (section.spreadImage.role === 'left' ? 'left' : 'right');
    return {
        frameWidth: CANONICAL_PAGE_WIDTH * 2,
        frameHeight: CANONICAL_PAGE_HEIGHT,
        percentBaseWidth: CANONICAL_PAGE_WIDTH,
        percentBaseHeight: CANONICAL_PAGE_HEIGHT,
        offsetX: role === 'left' ? CANONICAL_PAGE_WIDTH / 2 : -CANONICAL_PAGE_WIDTH / 2
    };
}

function normalizeImagePosition(pos = {}) {
    const toNum = (v, fallback) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : fallback;
    };
    return {
        x: toNum(pos.x, 0),
        y: toNum(pos.y, 0),
        scale: Math.max(0.1, toNum(pos.scale, 1)),
        rotation: toNum(pos.rotation, 0),
        flipX: !!pos.flipX
    };
}

function syncSpreadImageGroupForLang(activeIdx, lang) {
    const active = state.sections?.[activeIdx];
    if (!isSpreadImageSection(active)) return null;
    const groupId = active.spreadImage.groupId;
    const members = (state.sections || []).filter((section) => section?.spreadImage?.groupId === groupId);
    if (members.length < 2) return null;

    let shared = active.imagePositions?.[lang]
        || members.find((section) => section.imagePositions?.[lang])?.imagePositions?.[lang]
        || active.imagePosition
        || members.find((section) => section.imagePosition)?.imagePosition
        || { x: 0, y: 0, scale: 1, rotation: 0, flipX: false };
    shared = normalizeImagePosition(shared);

    members.forEach((section) => {
        if (!section.imagePositions) section.imagePositions = {};
        section.imagePositions[lang] = shared;
        section.imagePosition = shared;
        if (!section.imageBasePosition) {
            section.imageBasePosition = { x: 0, y: 0, scale: 1, rotation: 0, flipX: false };
        }
    });
    return shared;
}

function getActiveImagePosition() {
    const s = state.sections[state.activeIdx];
    if (!s || s.type !== 'image') return null;
    const lang = state.activeLang || state.defaultLang || 'ja';
    const spreadShared = syncSpreadImageGroupForLang(state.activeIdx, lang);
    if (spreadShared) return spreadShared;
    if (!s.imagePositions) s.imagePositions = {};
    if (!s.imagePositions[lang]) {
        // Migrate from legacy shared imagePosition on first access
        const legacy = s.imagePosition || {};
        s.imagePositions[lang] = {
            x: Number.isFinite(Number(legacy.x)) ? Number(legacy.x) : 0,
            y: Number.isFinite(Number(legacy.y)) ? Number(legacy.y) : 0,
            scale: Math.max(0.1, Number.isFinite(Number(legacy.scale)) ? Number(legacy.scale) : 1),
            rotation: Number.isFinite(Number(legacy.rotation)) ? Number(legacy.rotation) : 0,
            flipX: legacy.flipX || false
        };
    }
    const pos = s.imagePositions[lang];
    const toNum = (v, fallback) => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };
    pos.x = toNum(pos.x, 0);
    pos.y = toNum(pos.y, 0);
    pos.scale = Math.max(0.1, toNum(pos.scale, 1));
    pos.rotation = toNum(pos.rotation, 0);
    if (pos.flipX === undefined) pos.flipX = false;
    if (!s.imageBasePosition) s.imageBasePosition = { x: 0, y: 0, scale: 1, rotation: 0, flipX: false };
    return pos;
}

function getPointerClientPoint(e) {
    if (e.touches && e.touches[0]) {
        return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    return { x: e.clientX, y: e.clientY };
}

function roundRotationHalfStep(value) {
    const n = Number(value) || 0;
    return Math.round(n * 2) / 2;
}

window.adjustImageZoom = (delta) => {
    if (!canEditActiveFixedPage('image')) return;
    const pos = getActiveImagePosition();
    if (!isImageAdjusting || !pos) return;
    pushState();
    updateHistoryButtons();
    pos.scale = Math.max(0.1, pos.scale + delta);
    const s = state.sections[state.activeIdx];
    const bgUrl = getOptimizedImageUrl(s?.backgrounds?.[state.activeLang] || s?.backgrounds?.[state.defaultLang] || s?.background || '');
    applyImageSnapping(pos, bgUrl);
    scheduleImageAdjustDomUpdate();
    triggerAutoSave();
};

window.resetImageTransform = () => {
    const s = getEditableActiveFixedSection('image');
    const pos = getActiveImagePosition();
    if (!isImageAdjusting || !s || !pos) return;
    const base = s.imageBasePosition || { x: 0, y: 0, scale: 1, rotation: 0, flipX: false };
    pushState();
    updateHistoryButtons();
    pos.x = base.x || 0;
    pos.y = base.y || 0;
    pos.scale = base.scale || 1;
    pos.rotation = base.rotation || 0;
    pos.flipX = base.flipX || false;
    resetImageSnapState();
    scheduleImageAdjustDomUpdate();
    triggerAutoSave();
};

window.toggleImageFlipX = () => {
    if (!canEditActiveFixedPage('image')) return;
    const pos = getActiveImagePosition();
    if (!isImageAdjusting || !pos) return;
    pushState();
    updateHistoryButtons();
    pos.flipX = !pos.flipX;
    scheduleImageAdjustDomUpdate();
    triggerAutoSave();
};

window.commitRibbonImageRotation = (value) => {
    if (!isImageAdjusting || !canEditActiveFixedPage('image') || !Number.isFinite(Number(value))) return;
    const pos = getActiveImagePosition();
    if (!pos || Number(value) === pos.rotation) return;
    pushState();
    updateHistoryButtons();
    window.setImageRotationFromSlider(value);
    triggerAutoSave();
};

window.setImageRotationFromSlider = (value) => {
    if (!canEditActiveFixedPage('image')) return;
    const pos = getActiveImagePosition();
    if (!isImageAdjusting || !pos) return;
    const rotation = roundRotationHalfStep(Math.max(-180, Math.min(180, Number(value) || 0)));
    pos.rotation = rotation;
    const s = state.sections[state.activeIdx];
    const bgUrl = getOptimizedImageUrl(s?.backgrounds?.[state.activeLang] || s?.backgrounds?.[state.defaultLang] || s?.background || '');
    applyImageSnapping(pos, bgUrl);
    scheduleImageAdjustDomUpdate();
};

window.startImageRotationSliderAdjust = (event) => {
    if (!canEditActiveFixedPage('image')) return;
    if (event) {
        event.stopPropagation();
        event.preventDefault();
        if (event.currentTarget?.setPointerCapture && event.pointerId != null) {
            event.currentTarget.setPointerCapture(event.pointerId);
        }
    }
    isAdjustingRotationSlider = true;
    window.moveImageRotationSliderAdjust(event);
};

window.endImageRotationSliderAdjust = (event) => {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
        if (event.currentTarget?.releasePointerCapture && event.pointerId != null) {
            try {
                event.currentTarget.releasePointerCapture(event.pointerId);
            } catch { }
        }
    }
    isAdjustingRotationSlider = false;
};

window.moveImageRotationSliderAdjust = (event) => {
    if (!isAdjustingRotationSlider || !event?.currentTarget) return;
    event.stopPropagation();
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.height) return;
    const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
    const ratio = y / rect.height;
    const rotation = 180 - (ratio * 360);
    window.setImageRotationFromSlider(rotation);
};

window.startImageHandleDrag = (e, handleType) => {
    if (!isImageAdjusting || !canEditActiveFixedPage('image')) return;
    e.preventDefault();
    e.stopPropagation();
    const pos = getActiveImagePosition();
    if (!pos) return;

    const p = getPointerClientPoint(e);
    const target = document.getElementById('image-adjust-target') || document.getElementById('canvas-transform-layer');
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    imageHandleDrag = {
        handleType,
        startPoint: p,
        center: { x: cx, y: cy },
        base: {
            x: pos.x,
            y: pos.y,
            scale: pos.scale,
            rotation: pos.rotation || 0
        },
        startAngle: Math.atan2(p.y - cy, p.x - cx),
        startDist: Math.hypot(p.x - cx, p.y - cy) || 1
    };
    pushState();
    window.addEventListener('mousemove', onImageHandleDragMove);
    window.addEventListener('mouseup', onImageHandleDragEnd);
};

function onImageHandleDragMove(e) {
    if (!isImageAdjusting || !imageHandleDrag || !canEditActiveFixedPage('image')) return;
    const pos = getActiveImagePosition();
    if (!pos) return;

    const p = getPointerClientPoint(e);
    const dx = p.x - imageHandleDrag.startPoint.x;
    const dy = p.y - imageHandleDrag.startPoint.y;

    if (imageHandleDrag.handleType === 'rotate') {
        const currentAngle = Math.atan2(p.y - imageHandleDrag.center.y, p.x - imageHandleDrag.center.x);
        const deltaDeg = (currentAngle - imageHandleDrag.startAngle) * (180 / Math.PI);
        pos.rotation = imageHandleDrag.base.rotation + deltaDeg;
    } else {
        const currentDist = Math.hypot(p.x - imageHandleDrag.center.x, p.y - imageHandleDrag.center.y) || 1;
        const ratio = currentDist / imageHandleDrag.startDist;
        pos.scale = Math.max(0.1, imageHandleDrag.base.scale * ratio);
        pos.x = imageHandleDrag.base.x + dx / (2 * canvasScale);
        pos.y = imageHandleDrag.base.y + dy / (2 * canvasScale);
    }
    const s = state.sections[state.activeIdx];
    const bgUrl = getOptimizedImageUrl(s?.backgrounds?.[state.activeLang] || s?.backgrounds?.[state.defaultLang] || s?.background || '');
    applyImageSnapping(pos, bgUrl);
    scheduleImageAdjustDomUpdate();
}

function onImageHandleDragEnd() {
    if (!imageHandleDrag) return;
    imageHandleDrag = null;
    resetImageSnapState();
    window.removeEventListener('mousemove', onImageHandleDragMove);
    window.removeEventListener('mouseup', onImageHandleDragEnd);
    const s = state.sections[state.activeIdx];
    if (s && state.uid) {
        const lang = state.activeLang || state.defaultLang || 'ja';
        const thumbBgUrl = s.backgrounds?.[lang] || s.backgrounds?.[state.defaultLang] || s.background || '';
        const thumbPos = getActiveImagePosition() || s.imagePosition || { x: 0, y: 0, scale: 1, rotation: 0 };
        if (thumbBgUrl) {
            generateCroppedThumbnail(thumbBgUrl, thumbPos, refresh)
                .catch(e => console.warn('[DSF] Thumbnail update skipped (onImageHandleDragEnd):', e));
        }
    }
    triggerAutoSave();
}

function exitImageAdjustmentModeUi() {
    isImageAdjusting = false;
    isAdjustingRotationSlider = false;
    imageHandleDrag = null;
    window.removeEventListener('mousemove', onImageHandleDragMove);
    window.removeEventListener('mouseup', onImageHandleDragEnd);
    resetImageSnapState();
    ['btn-adjust-img', 'btn-adjust-img-panel'].forEach((id) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.style.background = '#fff';
        btn.style.color = '#333';
    });
    document.getElementById('canvas-transform-layer')?.classList.remove('adjust-image-mode');
    const bubbleLayer = document.getElementById('bubble-layer');
    if (bubbleLayer) bubbleLayer.style.pointerEvents = '';
    document.getElementById('image-zoom-controls-floating')?.classList.remove('visible');
    if (mobileAdjustViewBackup) {
        canvasScale = mobileAdjustViewBackup.scale;
        canvasTranslate = { ...mobileAdjustViewBackup.translate };
        mobileAdjustViewBackup = null;
        updateCanvasTransform();
    }
    document.body.classList.remove('image-adjusting-mobile');
    const info = document.getElementById('text-label');
    if (info) info.textContent = 'テキスト入力';
}

window.toggleImageAdjustment = () => {
    const s = getEditableActiveFixedSection('image');
    if (!s) return;

    isImageAdjusting = !isImageAdjusting;
    if (!isImageAdjusting) {
        exitImageAdjustmentModeUi();
    }

    // UI更新
    ['btn-adjust-img', 'btn-adjust-img-panel'].forEach((id) => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.style.background = isImageAdjusting ? 'var(--primary)' : '#fff';
            btn.style.color = isImageAdjusting ? '#fff' : '#333';
        }
    });

    // クロップ枠外のグレーアウト表示切り替え
    const layer = document.getElementById('canvas-transform-layer');
    if (layer) {
        if (isImageAdjusting) {
            layer.classList.add('adjust-image-mode');
        } else {
            layer.classList.remove('adjust-image-mode');
            resetImageSnapState();
        }
    }
    const bubbleLayer = document.getElementById('bubble-layer');
    if (bubbleLayer) {
        bubbleLayer.style.pointerEvents = isImageAdjusting ? 'none' : '';
    }
    const floatingControls = document.getElementById('image-zoom-controls-floating');
    if (floatingControls) {
        floatingControls.classList.toggle('visible', isImageAdjusting);
    }

    const isMobile = window.innerWidth < 1024;
    if (isMobile && isImageAdjusting) {
        if (typeof window.closeMobileSheet === 'function') {
            window.closeMobileSheet();
        }
        mobileAdjustViewBackup = {
            scale: canvasScale,
            translate: { ...canvasTranslate }
        };
        const pos = getActiveImagePosition() || s.imagePosition || { x: 0, y: 0, scale: 1 };
        canvasScale = calcMobileAdjustScale(pos);
        canvasTranslate = { x: 0, y: 0 };
        updateCanvasTransform();
        document.body.classList.add('image-adjusting-mobile');
    } else if (isMobile && !isImageAdjusting) {
        if (mobileAdjustViewBackup) {
            canvasScale = mobileAdjustViewBackup.scale;
            canvasTranslate = { ...mobileAdjustViewBackup.translate };
            updateCanvasTransform();
        }
        mobileAdjustViewBackup = null;
        document.body.classList.remove('image-adjusting-mobile');
    }

    // ガイド表示などの視覚的フィードバック
    const imgInfo = document.getElementById('text-label');
    if (imgInfo) {
        imgInfo.textContent = isImageAdjusting ? "画像をドラッグ/ピンチして調整" : "テキスト入力";
    }

    // 調整モード確定: refresh で handles 表示/非表示を切り替える
    refresh();
    // 調整モード終了時に値を確定して保存＋サムネイル再生成
    if (!isImageAdjusting) {
        triggerAutoSave();
        // サムネイル更新（多言語対応: backgrounds[activeLang] を優先使用）
        const lang = state.activeLang || state.defaultLang || 'ja';
        const thumbBgUrl = s.backgrounds?.[lang] || s.backgrounds?.[state.defaultLang] || s.background || '';
        const thumbPos = getActiveImagePosition() || s.imagePosition || { x: 0, y: 0, scale: 1, rotation: 0 };
        if (thumbBgUrl && state.uid) {
            generateCroppedThumbnail(
                thumbBgUrl,
                thumbPos,
                refresh
            ).catch(e => console.warn('[DSF] Thumbnail update skipped (toggleImageAdjustment):', e));
        }
    }
};

// 画像操作イベントリスナー
function initImageAdjustment() {
    const view = document.getElementById('canvas-view');
    // We bind events to view but check target or mode

    let isDraggingImg = false;
    let startPos = { x: 0, y: 0 };
    let startTransform = { x: 0, y: 0 };
    let startScale = 1;
    let initialPinchDist = null;

    // Events

    const onMove = (clientX, clientY) => {
        if (isAdjustingRotationSlider) return;
        const dx = clientX - startPos.x;
        const dy = clientY - startPos.y;
        const pos = getActiveImagePosition();
        if (!pos) return;
        pos.x = startTransform.x + dx / canvasScale;
        pos.y = startTransform.y + dy / canvasScale;
        const s = state.sections[state.activeIdx];
        const bgUrl = getOptimizedImageUrl(s?.backgrounds?.[state.activeLang] || s?.backgrounds?.[state.defaultLang] || s?.background || '');
        applyImageSnapping(pos, bgUrl);
        scheduleImageAdjustDomUpdate();
    };

    const onMoveWrap = (e) => onMove(e.clientX, e.clientY);

    const onEnd = () => {
        if (isDraggingImg) {
            isDraggingImg = false;
            resetImageSnapState();
            const s = state.sections[state.activeIdx];
            if (s && state.uid) {
                const lang = state.activeLang || state.defaultLang || 'ja';
                const thumbBgUrl = s.backgrounds?.[lang] || s.backgrounds?.[state.defaultLang] || s.background || '';
                const thumbPos = getActiveImagePosition() || s.imagePosition || { x: 0, y: 0, scale: 1, rotation: 0 };
                if (thumbBgUrl) {
                    generateCroppedThumbnail(thumbBgUrl, thumbPos, refresh)
                        .catch(e => console.warn('[DSF] Thumbnail update skipped (onEnd):', e));
                }
            }
            triggerAutoSave();
        }
        window.removeEventListener('mousemove', onMoveWrap);
        window.removeEventListener('mouseup', onEnd);
    };

    const onStart = (clientX, clientY) => {
        if (!isImageAdjusting || isAdjustingRotationSlider) return;
        isDraggingImg = true;
        startPos = { x: clientX, y: clientY };
        const pos = getActiveImagePosition();
        startTransform = pos ? { x: pos.x, y: pos.y } : { x: 0, y: 0 };
        window.addEventListener('mousemove', onMoveWrap);
        window.addEventListener('mouseup', onEnd);
    };

    // Mouse
    view.addEventListener('mousedown', (e) => {
        if (isAdjustingRotationSlider) return;
        const inAdjustTarget = !!(e.target && e.target.closest && e.target.closest('#image-adjust-target'));
        if (isImageAdjusting && (e.target.id === 'main-img' || inAdjustTarget)) {
            e.stopPropagation(); // Stop canvas pan
            e.preventDefault();
            onStart(e.clientX, e.clientY);
        }
    });

    // Touch
    view.addEventListener('touchstart', (e) => {
        if (isAdjustingRotationSlider) return;
        const inAdjustTarget = !!(e.target && e.target.closest && e.target.closest('#image-adjust-target'));
        if (isImageAdjusting && (e.target.id === 'main-img' || inAdjustTarget || e.touches.length === 2)) {
            e.stopPropagation();
            if (e.touches.length === 1) {
                onStart(e.touches[0].clientX, e.touches[0].clientY);
            } else if (e.touches.length === 2) {
                // Pinch start
                isDraggingImg = false; // Cancel drag
                const dist = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                );
                initialPinchDist = dist;
                const pos = getActiveImagePosition();
                startScale = pos?.scale || 1;
            }
        }
    }, { passive: false });

    view.addEventListener('touchmove', (e) => {
        onImageHandleDragMove(e);
        if (!isImageAdjusting) return;
        if (isAdjustingRotationSlider) {
            e.preventDefault();
            return;
        }
        if (e.touches.length === 1) {
            e.preventDefault(); // Prevent scroll
            onMove(e.touches[0].clientX, e.touches[0].clientY);
        } else if (e.touches.length === 2 && initialPinchDist) {
            e.preventDefault();
            const dist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            const scale = dist / initialPinchDist;
            const pos = getActiveImagePosition();
            if (!pos) return;
            pos.scale = Math.max(0.1, startScale * scale);
            const s = state.sections[state.activeIdx];
            const bgUrl = getOptimizedImageUrl(s?.backgrounds?.[state.activeLang] || s?.backgrounds?.[state.defaultLang] || s?.background || '');
            applyImageSnapping(pos, bgUrl);
            scheduleImageAdjustDomUpdate();
        }
    }, { passive: false });

    view.addEventListener('touchend', () => {
        initialPinchDist = null;
        onEnd();
        onImageHandleDragEnd();
    });

    // Wheel Zoom for Image
    view.addEventListener('wheel', (e) => {
        if (e.target.closest?.('.flow-authoring-editor, #flow-authoring-surface, #flow-canvas-translation-panel')) return;
        if (isImageAdjusting) {
            e.preventDefault();
            e.stopPropagation();
            const pos = getActiveImagePosition();
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            pos.scale = Math.max(0.1, (pos.scale || 1) * delta);
            const s = state.sections[state.activeIdx];
            const bgUrl = getOptimizedImageUrl(s?.backgrounds?.[state.activeLang] || s?.backgrounds?.[state.defaultLang] || s?.background || '');
            applyImageSnapping(pos, bgUrl);
            scheduleImageAdjustDomUpdate();
            // Debounce save?
            if (window.saveTimer) clearTimeout(window.saveTimer);
            window.saveTimer = setTimeout(triggerAutoSave, 500);
        }
    }, { passive: false });
}

// ──────────────────────────────────────
//  テキスト更新（多言語対応）
// ──────────────────────────────────────
let textPushTimer = null;
function updateActiveText(v) {
    const s = getEditableActiveFixedSection();
    if (!s) return;
    if (!textPushTimer) {
        pushState();
    } else {
        clearTimeout(textPushTimer);
    }
    textPushTimer = setTimeout(() => { textPushTimer = null; }, 500);

    if (state.activeBubbleIdx !== null && s.bubbles && s.bubbles[state.activeBubbleIdx]) {
        setBubbleText(s.bubbles[state.activeBubbleIdx], v);
    }
    refresh();
    triggerAutoSave();
}

// ──────────────────────────────────────────────────────────────
//  テキストセクション キャンバスプレビュー
// ──────────────────────────────────────────────────────────────

function _hideTextPreviewOverlay() {
    const overlay = document.getElementById('text-preview-overlay');
    if (overlay) overlay.style.display = 'none';
}

/** HTML 特殊文字をエスケープ */
function _escHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

const VERTICAL_GLYPH_MAP = Object.freeze({
    'ー': '︱',
    '―': '︱',
    '—': '︱',
    '–': '︲',
    '…': '︙',
    '‥': '︰',
    '、': '︑',
    '。': '︒',
    '，': '︐',
    '：': '︓',
    '；': '︔',
    '！': '︕',
    '？': '︖',
    '（': '︵',
    '）': '︶',
    '｛': '︷',
    '｝': '︸',
    '〔': '︹',
    '〕': '︺',
    '【': '︻',
    '】': '︼',
    '《': '︽',
    '》': '︾',
    '〈': '︿',
    '〉': '﹀',
    '「': '﹁',
    '」': '﹂',
    '『': '﹃',
    '』': '﹄',
    '［': '﹇',
    '］': '﹈'
});

function _verticalGlyphText(text) {
    return Array.from(String(text || ''), ch => VERTICAL_GLYPH_MAP[ch] || ch).join('');
}

function _markupVerticalDigits(text) {
    const chars = Array.from(String(text || ''));
    return chars.map(ch => _escHtml(_verticalGlyphText(ch))).join('');
}

/**
 * 縦書き列の 1 行を HTML にマークアップする。
 * 2〜4 桁の半角または全角数字を <span class="tcy"> でラップし縦中横（Tate-Chu-Yoko）を適用する。
 * ルビなし plain-text 用。ruby 付き行は _markupTokenLine を使用する。
 */
function _markupVerticalLine(rawLine) {
    if (!rawLine) return '\u00a0';
    return _markupTcyText(rawLine) || '\u00a0';
}

/**
 * トークン行からベーステキストのみ HTML を生成する（縦書き列用）。
 * ruby token は base テキストだけを出力し、<ruby> 要素を使わない。
 * ルビ注釈は別レイヤー（.tpv-ruby-overlay）で描画する。
 */
function _baseTextFromTokenLine(tokenLine) {
    if (!tokenLine || !tokenLine.length) return '\u00a0';
    const parts = [];
    for (const tok of tokenLine) {
        parts.push(_markupTcyText(tok.kind === 'ruby' ? tok.base : (tok.text || '')));
    }
    return parts.join('') || '\u00a0';
}

/**
 * トークン行（alignRubyToLines の 1 要素）を HTML にマークアップする。
 * - plain text token: _escHtml + TCY 数字ラップ（_markupVerticalLine 相当）
 * - ruby token: <ruby>base<rt>ruby</rt></ruby>（base にも TCY 適用）
 * 横書きで使用する。
 */
function _markupTokenLine(tokenLine) {
    if (!tokenLine || !tokenLine.length) return '\u00a0';
    const parts = [];
    for (const tok of tokenLine) {
        if (tok.kind === 'ruby') {
            const markedBase = _markupTcyText(tok.base);
            const rubyText = _escHtml(tok.ruby || '');
            parts.push(`<ruby>${markedBase}<rt>${rubyText}</rt></ruby>`);
        } else {
            parts.push(_markupTcyText(tok.text || ''));
        }
    }
    const html = parts.join('');
    return html || '\u00a0';
}

/** 文字列内の 2〜4 桁の半角・全角数字に TCY span を適用する（内部ヘルパー） */
function _markupTcyText(text) {
    if (!text) return '';
    return _markupVerticalDigits(text);
}

/**
 * composeText の lines 配列を縦書き連続フロー用 HTML に変換する。
 * 空行（段落区切り）は全角スペース（字下げ代わり）に変換し、
 * 行間スペースを入れずに連結することで CSS のマルチカラムフロー
 * （column-fill: auto）が列を上から下まで充填できるようにする。
 */
function _buildCjkHtmlFlow(lines) {
    const parts = [];
    for (const line of lines) {
        if (line === '') {
            parts.push('\u3000'); // 段落区切り → 字下げ（U+3000 ideographic space）
        } else {
            parts.push(_markupVerticalLine(line));
        }
    }
    return parts.join('');
}

/**
 * composeText の lines 配列を段落単位に再結合する（横書き向け）。
 * 連続する非空行をスペースで繋ぎ、空行は null（ブランク行）として返す。
 * CSS が justify + hyphens で再ラップできるよう、行分割を解除する。
 */
function _linesIntoParagraphs(lines, lineBreaks = []) {
    const result = [];
    let buf = [];
    function flushBuf() {
        if (!buf.length) return;
        result.push(buf.join(' '));
        buf = [];
    }
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (line === '') {
            flushBuf();
            result.push(null);
        } else {
            buf.push(line);
            if (lineBreaks[i]) flushBuf();
        }
    }
    flushBuf();
    return result;
}

/**
 * ルビあり横書き向け: alignRubyToLines の token-line 配列を段落単位に結合する。
 * 空行（lines[i] === ''）は null として返す。
 * 連続する token 行のトークンを結合し、text トークン間にスペースを挿入する。
 * @param {Array<Array>} rubyLines  alignRubyToLines の返り値
 * @param {string[]} lines          composeText の lines（空行判定用）
 * @returns {Array<Array<token>|null>}
 */
function _tokenLinesIntoParagraphs(rubyLines, lines, lineBreaks = []) {
    const result = [];
    let buf = [];

    function flushBuf() {
        if (!buf.length) return;
        // 複数行のトークンをスペース区切りで結合（行境界にスペースを挿入）
        const merged = [];
        for (let i = 0; i < buf.length; i++) {
            merged.push(...buf[i]);
            if (i < buf.length - 1) {
                merged.push({ kind: 'text', text: ' ' });
            }
        }
        result.push(merged);
        buf = [];
    }

    for (let i = 0; i < lines.length; i++) {
        if (lines[i] === '') {
            flushBuf();
            result.push(null);
        } else {
            buf.push(rubyLines[i] || []);
            if (lineBreaks[i]) flushBuf();
        }
    }
    flushBuf();
    return result;
}

function _getHorizontalTextOffsetY(composed) {
    if (!composed || composed.writingMode !== 'horizontal-tb') return 0;
    return 0;
}

function _getTextSectionAlign(section) {
    const value = section?.textAlign || 'start';
    return TEXT_ALIGN_VALUES.includes(value) ? value : 'start';
}

function _getHorizontalBlockJustifyCss(section) {
    const align = _getTextSectionAlign(section);
    if (align === 'center') return 'center';
    if (align === 'end') return 'flex-end';
    return 'flex-start';
}

function _getVerticalBlockJustifyCss(section) {
    const align = _getTextSectionAlign(section);
    if (align === 'center') return 'center';
    if (align === 'end') return 'flex-end';
    return 'flex-start';
}

function _getVerticalBlockOffsetPx(section, frameW, usedCols, colW) {
    const groupW = Math.min(frameW, usedCols * colW);
    const align = _getTextSectionAlign(section);
    if (align === 'center') return Math.max(0, (frameW - groupW) / 2);
    if (align === 'end') return 0;
    return Math.max(0, frameW - groupW);
}

/**
 * テキストセクションの組版結果をキャンバス上の HTML オーバーレイとして描画する。
 *
 * ▼ 縦書き (vertical-rl)
 *   - 列ごとに <span class="tpv-col"> を生成し、flex row-reverse で右端から配置
 *   - 列幅   = frame.w / maxLines（全列が枠内に収まるよう均等割り）
 *   - 文字ピッチ = frame.h / charsPerLine（縦方向均等割り）
 *   - 2〜4 桁の半角・全角数字に <span class="tcy"> を自動付与（縦中横）
 *   - {base|ruby} 記法を <ruby> タグに変換（ルビ）
 *
 * ▼ 横書き (horizontal-tb)
 *   - composeText() が確定した行をそのまま 1 行ずつ描画
 *   - 行頭は揃えたまま、ブロック全体を start / center / end に配置
 *   - {base|ruby} 記法を <ruby> タグに変換（ルビ）
 */
function renderTextPreview(section) {
    const overlay = document.getElementById('text-preview-overlay');
    if (!overlay) return;

    const lang = state.activeLang || state.defaultLang || 'ja';
    const raw = section.texts?.[lang] ?? '';
    const writingMode = getWritingModeFromConfigs(lang, state.languageConfigs);
    const fontPreset = getFontPresetFromConfigs(lang, state.languageConfigs);

    // ルビマークアップを解析し、ベーステキストで組版する
    let rubyTokens, hasRuby, plainText, rubyLines;
    try {
        rubyTokens = parseRubyTokens(raw);
        hasRuby = rubyTokens.some(t => t.kind === 'ruby');
        plainText = hasRuby ? tokensToPlainText(rubyTokens) : raw;
    } catch (e) {
        console.error('[renderTextPreview] ruby parse error:', e);
        rubyTokens = []; hasRuby = false; plainText = raw;
    }

    const composed = composeText(plainText, lang, writingMode, fontPreset);
    const textAlign = _getTextSectionAlign(section);

    // ルビあり: 行ごとのトークン配列を構築
    try {
        rubyLines = hasRuby ? alignRubyToLines(rubyTokens, composed.lines) : null;
    } catch (e) {
        console.error('[renderTextPreview] ruby align error:', e);
        rubyLines = null;
    }

    const paperStyle = _getTextPaperStyle(_getTextPaperPresetKey(section));
    overlay.style.backgroundColor = paperStyle.backgroundColor;
    overlay.style.display = 'block';

    const frameEl = document.getElementById('text-preview-frame');
    if (frameEl) {
        const { x, y, w, h } = composed.frame;
        frameEl.style.left          = `${x}px`;
        frameEl.style.top           = `${y}px`;
        frameEl.style.width         = `${w}px`;
        frameEl.style.height        = `${h}px`;
        frameEl.style.fontFamily    = composed.font.family;
        frameEl.style.fontSize      = `${composed.font.size}px`;
        frameEl.style.color         = paperStyle.textColor;
        frameEl.style.writingMode   = '';
        frameEl.style.lineHeight    = '';
        frameEl.style.letterSpacing = composed.font.letterSpacing
            ? `${composed.font.letterSpacing}px` : '0';
        // hyphens:auto などが言語固有処理を使えるよう lang 属性を設定
        frameEl.setAttribute('lang', lang.toLowerCase());
    }

    const contentEl = document.getElementById('text-preview-content');
    if (contentEl) {
        if (!raw) {
            contentEl.innerHTML = '';
        } else if (composed.writingMode === 'vertical-rl') {
            // 縦書き: 2 レイヤー方式
            //
            // Layer 1 (.tpv-vertical): ベーステキスト列のみ（<ruby> なし）
            //   列幅・文字ピッチの計算はルビに左右されないため安定する。
            //
            // Layer 2 (.tpv-ruby-overlay): ルビ注釈を絶対座標で独立描画
            //   列レイアウトへの影響ゼロ。文字の行間が詰まらない。
            //
            // 座標系（canonical px、contentEl の左上が原点）:
            //   列 i（0=最右列）の左端 = w - (i+1)*colW
            //   列 i の右端           = w - i*colW
            //   ルビは列 i の右側（右端から右へ rubyW px）に配置
            //   文字オフセット co の上端 = co * charPitch
            const { w, h }    = composed.frame;
            const maxCols     = composed.rules?.maxLines    || 12;
            const charsPerCol = composed.rules?.charsPerLine || 33;
            const fontSize    = composed.font.size;
            const colW        = Math.floor(w / maxCols);
            const lineHeight  = (colW / fontSize).toFixed(3);
            const letterSpacing = ((h / charsPerCol) - fontSize).toFixed(3);
            const charPitch   = h / charsPerCol; // 1 文字あたりの縦ピクセル（canonical）
            const rubyFontSize = Math.round(fontSize * 0.5); // rt のフォントサイズ（canonical）
            const rubyColW    = Math.round(fontSize * 0.65); // ルビ注釈の横幅（canonical）
            const verticalJustify = _getVerticalBlockJustifyCss(section);
            const usedCols = composed.lines.length;
            const groupW = usedCols * colW;
            const blockOffsetX = _getVerticalBlockOffsetPx(section, w, usedCols, colW);
            // 字形は line-height の中央に配置されるため、ルビは字形右端 = 列右端 - (colW - fontSize)/2 に置く
            const charRightOffset = Math.round((colW - fontSize) / 2);

            // Layer 1: ベーステキスト列（ruby 要素なし）
            const cols = composed.lines.map((line, i) => {
                const content = rubyLines
                    ? _baseTextFromTokenLine(rubyLines[i])
                    : _markupVerticalLine(line);
                return `<span class="tpv-col"` +
                    ` style="width:${colW}px;line-height:${lineHeight};letter-spacing:${letterSpacing}px"` +
                    `>${content}</span>`;
            }).join('');

            // Layer 2: ルビ注釈オーバーレイ
            let rubyOverlay = '';
            if (rubyLines) {
                const anns = [];
                for (let i = 0; i < rubyLines.length; i++) {
                    let charOffset = 0;
                    for (const tok of rubyLines[i]) {
                        const baseLen = tok.kind === 'ruby'
                            ? Array.from(tok.base || '').length
                            : Array.from(tok.text || '').length;
                        if (tok.kind === 'ruby' && tok.ruby) {
                            // 字形は line-height の中央にある。
                            // 字形右端 = 列右端 - charRightOffset = w - i*colW - charRightOffset
                            // ルビはその右（字形右端）から配置し、字形に密着させる。
                            const annLeft = groupW - i * colW - charRightOffset;
                            // ルビテキストを base 文字スパンの中央に揃えるため top を調整する
                            const rubyLen = Array.from(tok.ruby).length;
                            const rubyH   = Math.round(rubyLen * rubyFontSize * 1.2);
                            const baseH   = Math.round(baseLen * charPitch);
                            const annTop  = Math.round(charOffset * charPitch + Math.max(0, (baseH - rubyH) / 2));
                            anns.push(
                                `<span class="tpv-ruby-ann"` +
                                ` style="left:${Math.round(blockOffsetX + annLeft)}px;top:${annTop}px;` +
                                `width:${rubyColW}px;` +
                                `font-size:${rubyFontSize}px"` +
                                `>${_escHtml(_verticalGlyphText(tok.ruby))}</span>`
                            );
                        }
                        charOffset += baseLen;
                    }
                }
                if (anns.length) {
                    rubyOverlay = `<div class="tpv-ruby-overlay">${anns.join('')}</div>`;
                }
            }

            contentEl.innerHTML = `<div class="tpv-vertical" style="justify-content:${verticalJustify}">${cols}</div>${rubyOverlay}`;
        } else {
            // 横書き: 行頭は揃えたまま、行ブロック全体だけを配置する
            const lineH  = composed.frame.h / (composed.rules?.maxLines || 20);
            const offsetY = _getHorizontalTextOffsetY(composed);
            const horizontalJustify = _getHorizontalBlockJustifyCss(section);

            let html;
            if (rubyLines) {
                html = rubyLines.map((tokenLine, idx) => {
                    if (!composed.lines[idx]) {
                        return `<div class="tpv-blank" style="height:${lineH}px"></div>`;
                    }
                    return `<div class="tpv-line">${tokenLine.map(tok =>
                        tok.kind === 'ruby'
                            ? `<ruby>${_markupTcyText(tok.base)}<rt>${_escHtml(tok.ruby || '')}</rt></ruby>`
                            : _escHtml(tok.text || '')
                    ).join('')}</div>`;
                }).join('');
            } else {
                html = (composed.lines || []).map(line =>
                    !line
                        ? `<div class="tpv-blank" style="height:${lineH}px"></div>`
                        : `<div class="tpv-line">${_escHtml(line)}</div>`
                ).join('');
            }
            contentEl.innerHTML =
                `<div class="tpv-horizontal" lang="${lang.toLowerCase()}" style="line-height:${lineH}px;transform:translateY(${offsetY}px);justify-content:${horizontalJustify}"><div class="tpv-horizontal-block">${html}</div></div>`;
        }
    }

    const placeholder = document.getElementById('text-preview-placeholder');
    if (placeholder) placeholder.style.display = raw ? 'none' : 'flex';
}

// ──────────────────────────────────────────────────────────────
//  テキストセクション パネル同期・入力ハンドラ
// ──────────────────────────────────────────────────────────────

let _textBodyPushTimer = null;
let _textBodyDebounceTimer = null;

/**
 * テキストセクションパネルを現在のセクション内容で同期する
 */
function _syncTextSectionPanel(section) {
    const lang = state.activeLang || state.defaultLang || 'ja';
    const textarea = document.getElementById('prop-body-text');
    if (textarea && document.activeElement !== textarea) {
        textarea.value = section.texts?.[lang] ?? '';
    }
    const label = document.getElementById('text-body-label');
    if (label) label.textContent = `本文 [${lang.toUpperCase()}]`;

    _syncTextPaperPresetControls(section);
    _syncTextAlignControls(section);
    _updateTextOverflowBadge(section, lang);
}

function _inferTextPaperPresetKey(section) {
    if (section?.paperPreset && TEXT_PAPER_PRESETS[section.paperPreset]) {
        return section.paperPreset;
    }
    const bg = String(section?.backgroundColor || '').toLowerCase();
    const ink = String(section?.textColor || '').toLowerCase();
    const match = Object.entries(TEXT_PAPER_PRESETS).find(([, preset]) =>
        preset.backgroundColor.toLowerCase() === bg && preset.textColor.toLowerCase() === ink
    );
    return match?.[0] || 'white';
}

function _getTextPaperPresetKey(section) {
    if (state.textPaperPreset && TEXT_PAPER_PRESETS[state.textPaperPreset]) {
        return state.textPaperPreset;
    }
    return _inferTextPaperPresetKey(section);
}

function _syncTextPaperPresetControls(section) {
    const activeKey = _getTextPaperPresetKey(section);
    document.querySelectorAll('[data-text-paper-preset], [data-project-text-paper-preset]').forEach((button) => {
        const key = button.dataset.textPaperPreset || button.dataset.projectTextPaperPreset;
        const isActive = key === activeKey;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
}

function _getProjectTextPaperPresetKey(source = state) {
    if (source?.textPaperPreset && TEXT_PAPER_PRESETS[source.textPaperPreset]) return source.textPaperPreset;
    const textSection = (source?.sections || []).find((section) => section?.type === 'text');
    return _inferTextPaperPresetKey(textSection);
}

function _getTextPaperStyle(key) {
    const presetKey = TEXT_PAPER_PRESETS[key] ? key : 'white';
    const preset = TEXT_PAPER_PRESETS[presetKey];
    return {
        paperPreset: presetKey,
        backgroundColor: preset.backgroundColor,
        textColor: preset.textColor
    };
}

function _applyTextPaperStyleToSections(sections, key) {
    const nextStyle = _getTextPaperStyle(key);
    return (sections || []).map((section) => {
        if (section?.type !== 'text') return section;
        return { ...section, ...nextStyle };
    });
}

function _applyTextPaperStyleToBlocks(blocks, key) {
    const nextStyle = _getTextPaperStyle(key);
    return (blocks || []).map((block) => {
        if (block?.kind !== 'page' || block.content?.pageKind !== 'text') return block;
        return {
            ...block,
            content: {
                ...(block.content || {}),
                ...nextStyle
            }
        };
    });
}

function _syncTextAlignControls(section) {
    const activeAlign = _getTextSectionAlign(section);
    document.querySelectorAll('[data-text-align]').forEach((button) => {
        const isActive = button.dataset.textAlign === activeAlign;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
}

function updateTextSectionAlign(value) {
    if (!TEXT_ALIGN_VALUES.includes(value)) return;

    const idx = state.activeIdx;
    const section = getEditableActiveFixedSection('text');
    if (!section) return;

    pushState();

    const sectionIndices = new Set([idx]);
    const blockIdx = Number.isInteger(state.activeBlockIdx) && state.activeBlockIdx >= 0
        ? state.activeBlockIdx
        : getBlockIndexFromPageIndex(state.blocks, idx);
    const activeBlock = state.blocks?.[blockIdx];
    const flowId = activeBlock?.kind === 'page' ? activeBlock.content?._flow?.id : '';

    let touchedBlock = false;
    const newBlocks = Array.isArray(state.blocks)
        ? state.blocks.map((block, bi) => {
            if (block?.kind !== 'page') return block;
            const sameFlow = flowId && block.content?._flow?.id === flowId;
            const samePage = bi === blockIdx;
            if (!sameFlow && !samePage) return block;
            const pageIdx = getPageIndexFromBlockIndex(state.blocks, bi);
            if (pageIdx >= 0) sectionIndices.add(pageIdx);
            touchedBlock = true;
            return {
                ...block,
                content: {
                    ...block.content,
                    textAlign: value
                }
            };
        })
        : [];

    const newSections = (state.sections || []).map((item, sectionIdx) => {
        if (!sectionIndices.has(sectionIdx) || item?.type !== 'text') return item;
        return { ...item, textAlign: value };
    });

    const blocks = touchedBlock
        ? newBlocks
        : syncBlocksWithSections(state.blocks, newSections, state.languages, { strictSpine: state.version === 6 });

    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'sections', value: newSections } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'blocks', value: blocks } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'pages', value: blocksToPages(blocks) } });

    renderTextPreview(newSections[idx]);
    _syncTextAlignControls(newSections[idx]);
    refresh();
    triggerAutoSave();
}

function updateTextSectionPaperPreset(key) {
    if (!TEXT_PAPER_PRESETS[key]) return;
    if (!canEditActiveFixedPage('text')) return;

    pushState();

    const newSections = _applyTextPaperStyleToSections(state.sections, key);
    const newBlocks = _applyTextPaperStyleToBlocks(state.blocks, key);

    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'textPaperPreset', value: key } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'sections', value: newSections } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'blocks', value: newBlocks } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'pages', value: blocksToPages(newBlocks) } });

    const section = newSections[state.activeIdx];
    if (section?.type === 'text') renderTextPreview(section);
    _syncTextPaperPresetControls(section);
    refresh();
    triggerAutoSave();
}

window.updateTextSectionPaperPreset = updateTextSectionPaperPreset;
window.updateTextSectionAlign = updateTextSectionAlign;

/**
 * 溢れバッジを更新する（溢れ時はページ数を表示）
 */
function _updateTextOverflowBadge(section, lang) {
    const badge = document.getElementById('text-overflow-badge');
    if (!badge) return;
    const raw = section.texts?.[lang] ?? '';
    if (!raw) { badge.style.display = 'none'; return; }
    const writingMode = getWritingModeFromConfigs(lang, state.languageConfigs);
    const fontPreset = getFontPresetFromConfigs(lang, state.languageConfigs);
    const tokens = parseRubyTokens(raw);
    const plainText = tokens.some(t => t.kind === 'ruby') ? tokensToPlainText(tokens) : raw;
    const result = composeText(plainText, lang, writingMode, fontPreset);
    if (!result.overflow) {
        badge.style.display = 'none';
    } else {
        // ページ数を計算して表示
        const pages = paginateText(plainText, lang, writingMode, fontPreset);
        const count = pages.length;
        badge.style.display = 'block';
        badge.textContent = t('label_text_flow', { count }) || `→ ${count} ページに展開`;
    }
}

// ──────────────────────────────────────
//  テキスト自動ページ流し込み (Auto Text Flow)
// ──────────────────────────────────────

let _autoFlowDebounceTimer = null;

/** flowId に属する継続ページブロック（idx > 0）のインデックスを取得する */
function _findFlowContinuationIndices(blocks, flowId) {
    const result = [];
    for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        if (b?.kind === 'page' && b.content?._flow?.id === flowId && b.content._flow.idx > 0) {
            result.push(i);
        }
    }
    result.sort((a, b) => blocks[a].content._flow.idx - blocks[b].content._flow.idx);
    return result;
}

/** フロー継続ページブロックを新規作成する */
function _createContinuationBlock(masterBlock, text, flowId, flowIdx, lang) {
    const texts = {};
    texts[lang] = text;
    return {
        id: createId('page'),
        kind: 'page',
        content: {
            pageKind: 'text',
            background: masterBlock.content?.background || '',
            paperPreset: masterBlock.content?.paperPreset || 'white',
            backgroundColor: masterBlock.content?.backgroundColor || '',
            textColor: masterBlock.content?.textColor || '',
            textAlign: masterBlock.content?.textAlign || 'start',
            texts,
            bubbles: [],
            _flow: { id: flowId, idx: flowIdx }
        }
    };
}

/**
 * テキストセクションを自動ページ分割する。
 *
 * 多言語動作ルール:
 *  - 言語 A で溢れてページ追加した場合、他言語の継続スロットは空のまま追加するだけ。
 *  - 言語 B に切り替えて溢れが発生した場合:
 *      ・継続スロットの B テキストが「空」→ そのスロットを上書きして埋める
 *      ・継続スロットの B テキストが「非空」→ 上書きせず末尾に新規スロットを挿入
 *      ・既存スロット数を超えて新規ページが必要な場合 → 末尾に新規ブロックを追加
 *      ・他言語のページ数を超えた分 → 他言語は空スロットとして追加済み
 *  - B テキストが必要ページ数より少ない（テキスト削減）場合は、余剰スロットの
 *    B テキストをクリア。他言語コンテンツがあれば削除せず保持。
 */
function autoFlowTextSection() {
    if (!canEditActiveFixedPage('text')) return;
    const lang = state.activeLang || state.defaultLang || 'ja';
    const pageIdx = state.activeIdx;
    const blockIdx = getBlockIndexFromPageIndex(state.blocks, pageIdx);
    if (blockIdx < 0) return;

    const masterBlock = state.blocks[blockIdx];
    if (masterBlock?.kind !== 'page' || masterBlock.content?.pageKind !== 'text') return;
    // 継続ブロック上ではマスターフローのみ処理する
    if ((masterBlock.content._flow?.idx ?? 0) > 0) return;

    const rawText = masterBlock.content.texts?.[lang] ?? '';
    const writingMode = getWritingModeFromConfigs(lang, state.languageConfigs);
    const fontPreset = getFontPresetFromConfigs(lang, state.languageConfigs);

    const tokens = parseRubyTokens(rawText);
    const plainText = tokens.some(t => t.kind === 'ruby') ? tokensToPlainText(tokens) : rawText;
    const pageTexts = paginateText(plainText, lang, writingMode, fontPreset);

    let flowId = masterBlock.content._flow?.id;
    if (!flowId && pageTexts.length > 1) flowId = createId('flow');

    const newBlocks = [...state.blocks];

    // マスターブロックの _flow を更新
    const masterContent = { ...masterBlock.content };
    if (pageTexts.length > 1) {
        masterContent._flow = { id: flowId, idx: 0 };
    } else {
        delete masterContent._flow;
    }
    newBlocks[blockIdx] = { ...masterBlock, content: masterContent };

    const neededCount = pageTexts.length - 1;

    if (!flowId) {
        // フローなし・溢れなし
        _applyBlocksAndRefresh(newBlocks);
        return;
    }

    // 継続ブロックを配列上の位置順に収集
    const contIndices = [];
    for (let i = 0; i < newBlocks.length; i++) {
        const b = newBlocks[i];
        if (b?.kind === 'page' && b.content?._flow?.id === flowId && (b.content._flow?.idx ?? 0) > 0) {
            contIndices.push(i);
        }
    }
    contIndices.sort((a, b) => a - b);

    const getLangText = (bi) => (newBlocks[bi]?.content?.texts?.[lang] ?? '').trim();
    const hasOtherLang = (bi) =>
        Object.entries(newBlocks[bi]?.content?.texts || {})
            .some(([l, txt]) => l !== lang && txt?.trim());

    // ── 空スロットと非空スロットを分類 ──
    const emptySlots   = contIndices.filter(bi => !getLangText(bi));
    const nonEmptySlots = contIndices.filter(bi => !!getLangText(bi));

    if (neededCount === 0) {
        // 溢れなし: 全継続ブロックの lang テキストをクリア（他言語があれば削除しない）
        for (let i = contIndices.length - 1; i >= 0; i--) {
            const bi = contIndices[i];
            if (hasOtherLang(bi)) {
                newBlocks[bi] = {
                    ...newBlocks[bi],
                    content: { ...newBlocks[bi].content, texts: { ...newBlocks[bi].content.texts, [lang]: '' } }
                };
            } else {
                newBlocks.splice(bi, 1);
            }
        }
    } else {
        let assigned = 0; // pageTexts[1..] の割り当て済み数

        // Step 1: 空スロットを前から順に埋める
        for (let i = 0; i < emptySlots.length && assigned < neededCount; i++) {
            const bi = emptySlots[i];
            newBlocks[bi] = {
                ...newBlocks[bi],
                content: {
                    ...newBlocks[bi].content,
                    texts: { ...newBlocks[bi].content.texts, [lang]: pageTexts[assigned + 1] }
                }
            };
            assigned++;
        }

        // Step 2: まだ足りない場合 → 末尾に新規ブロックを追加
        const stillNeeded = neededCount - assigned;
        if (stillNeeded > 0) {
            // 現時点での最後の継続ブロック位置を再取得（splice後の変化考慮）
            let insertAfter = blockIdx;
            for (let i = 0; i < newBlocks.length; i++) {
                const b = newBlocks[i];
                if (b?.kind === 'page' && b.content?._flow?.id === flowId) {
                    insertAfter = i;
                }
            }
            const newConts = [];
            for (let i = 0; i < stillNeeded; i++) {
                newConts.push(_createContinuationBlock(
                    newBlocks[blockIdx], pageTexts[assigned + 1 + i], flowId, contIndices.length + i + 1, lang
                ));
            }
            newBlocks.splice(insertAfter + 1, 0, ...newConts);
        }

        // Step 3: 非空スロットが neededCount を超えている場合は余剰をクリア
        // （割り当て済み空スロット + 非空スロット > neededCount のとき末尾から削除）
        const totalExisting = Math.min(emptySlots.length, neededCount) + nonEmptySlots.length;
        if (totalExisting > neededCount) {
            const excessCount = totalExisting - neededCount;
            const toExcess = nonEmptySlots.slice(-excessCount);
            for (let i = toExcess.length - 1; i >= 0; i--) {
                const bi = toExcess[i];
                if (hasOtherLang(bi)) {
                    newBlocks[bi] = {
                        ...newBlocks[bi],
                        content: { ...newBlocks[bi].content, texts: { ...newBlocks[bi].content.texts, [lang]: '' } }
                    };
                } else {
                    newBlocks.splice(bi, 1);
                }
            }
        }
    }

    // _flow.idx を配列上の出現順に再番号付け
    let flowIdx = 0;
    for (let i = 0; i < newBlocks.length; i++) {
        const b = newBlocks[i];
        if (b?.kind === 'page' && b.content?._flow?.id === flowId) {
            newBlocks[i] = { ...b, content: { ...b.content, _flow: { id: flowId, idx: flowIdx++ } } };
        }
    }

    _applyBlocksAndRefresh(newBlocks);
}

function _applyBlocksAndRefresh(newBlocks) {
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'blocks', value: newBlocks } });
    const newSections = extractSectionsFromBlocks(newBlocks);
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'sections', value: newSections } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'pages', value: blocksToPages(newBlocks) } });
    refresh();
    triggerAutoSave();
}

// HTML から onclick で呼べるよう window に公開
window.autoFlowTextSection = autoFlowTextSection;

function _getActiveSectionHeading(section, lang) {
    if (!section || !lang) return '';
    return section.headings?.[lang] || '';
}

function syncPageHeadingField(section) {
    const lang = state.activeLang || state.defaultLang || 'ja';
    const input = document.getElementById('canvas-page-heading-input');
    if (input && document.activeElement !== input) {
        input.value = _getActiveSectionHeading(section, lang);
    }
}

function _getSectionHeadingForToc(section, lang) {
    if (!section || (section.type !== 'image' && section.type !== 'text')) return '';
    const defaultLang = state.defaultLang || 'ja';
    return (
        section.headings?.[lang] ||
        (lang !== defaultLang ? section.headings?.[defaultLang] : '') ||
        ''
    ).trim();
}

function getEditorTocItems() {
    const lang = state.activeLang || state.defaultLang || 'ja';
    const projection = getEditorPageProjection();
    const pageCount = projection?.totalPageCount || (state.sections || []).length;
    return (state.sections || [])
        .map((section, pageIndex) => {
            const heading = _getSectionHeadingForToc(section, lang);
            if (!heading) return null;
            const projectedPage = projection?.pages?.find((page) => (
                page.kind === 'fixed' && page.fixedPageIndex === pageIndex
            ));
            const presentationIndex = projectedPage?.index ?? pageIndex;
            return {
                pageIndex,
                label: getPageDisplayLabel(presentationIndex, pageCount, state.book, state.bookMode),
                heading
            };
        })
        .filter(Boolean);
}

function renderEditorTocPreview() {
    const panels = [...document.querySelectorAll('.js-toc-preview-panel')];
    if (!panels.length) return;
    const activeSection = getEditableActiveFixedSection();
    const isPageSection = activeSection?.type === 'image' || activeSection?.type === 'text';
    const canShowToc = isPageSection || getActiveBlock()?.kind === 'flow';
    panels.forEach((panel) => { panel.style.display = canShowToc ? 'block' : 'none'; });
    if (!canShowToc) return;

    const items = getEditorTocItems();
    const html = !items.length
        ? `<div class="toc-preview-empty">${escapeStudioHtml(t('toc_preview_empty'))}</div>`
        : items.map((item) => {
            const active = getActiveBlock()?.kind === 'page' && item.pageIndex === state.activeIdx;
            const activeLabel = active ? `<span class="toc-preview-current">${escapeStudioHtml(t('toc_preview_current'))}</span>` : '';
            return `
                <button type="button" class="toc-preview-item${active ? ' active' : ''}" onclick="jumpToTocPage(${item.pageIndex})">
                    <span class="toc-preview-page">${escapeStudioHtml(item.label)}</span>
                    <span class="toc-preview-heading">${escapeStudioHtml(item.heading)}</span>
                    ${activeLabel}
                </button>
            `;
        }).join('');

    panels.forEach((panel) => {
        const list = panel.querySelector('.js-toc-preview-list');
        if (list) list.innerHTML = html;
    });
}

function updatePageHeading(value, langOverride) {
    const idx = state.activeIdx;
    const section = getEditableActiveFixedSection();
    if (!section || (section.type !== 'image' && section.type !== 'text')) return;
    const lang = langOverride || state.activeLang || state.defaultLang || 'ja';

    if (!_pageHeadingPushTimer) {
        pushState();
    } else {
        clearTimeout(_pageHeadingPushTimer);
    }
    _pageHeadingPushTimer = setTimeout(() => { _pageHeadingPushTimer = null; }, 600);
    const nextSections = (state.sections || []).map((sec, secIdx) => {
        if (secIdx !== idx) return sec;
        return {
            ...sec,
            headings: {
                ...(sec.headings || {}),
                [lang]: value || ''
            }
        };
    });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'sections', value: nextSections } });

    const activeBlockIdx = getBlockIndexFromPageIndex(state.blocks, idx);
    const nextBlocks = (state.blocks || []).map((block, blockIdx) => {
        if (blockIdx !== activeBlockIdx || block?.kind !== 'page') return block;
        return {
            ...block,
            content: {
                ...(block.content || {}),
                headings: {
                    ...(block.content?.headings || {}),
                    [lang]: value || ''
                }
            }
        };
    });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'blocks', value: nextBlocks } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'pages', value: blocksToPages(nextBlocks) } });

    refresh({ skipThumbs: true });
    triggerAutoSave();
}

/**
 * テキストセクションの本文入力ハンドラ（debounce 付き）
 */
function updateTextSectionBody(v) {
    const idx = state.activeIdx;
    const s = getEditableActiveFixedSection('text');
    if (!s) return;
    const lang = state.activeLang || state.defaultLang || 'ja';

    if (!_textBodyPushTimer) {
        pushState();
    } else {
        clearTimeout(_textBodyPushTimer);
    }
    _textBodyPushTimer = setTimeout(() => { _textBodyPushTimer = null; }, 600);

    dispatch({ type: actionTypes.UPDATE_SECTION_TEXT, payload: { idx, lang, text: v } });

    // blocks/pages を同期
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: {
        key: 'blocks',
        value: syncBlocksWithSections(state.blocks, state.sections, state.languages, { strictSpine: state.version === 6 }),
    } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'pages', value: blocksToPages(state.blocks) } });

    // プレビューと溢れバッジをリアルタイム更新（debounce）
    clearTimeout(_textBodyDebounceTimer);
    _textBodyDebounceTimer = setTimeout(() => {
        const sec = state.sections[idx];
        _updateTextOverflowBadge(sec, lang);
        renderTextPreview(sec);
    }, 300);

    // 自動ページ流し込み（少し長めに待つ）
    clearTimeout(_autoFlowDebounceTimer);
    _autoFlowDebounceTimer = setTimeout(() => {
        autoFlowTextSection();
    }, 1000);

    triggerAutoSave();
}

function updateBubbleShape(shapeName) {
    const s = getEditableActiveFixedSection();
    if (s && state.activeBubbleIdx !== null && s.bubbles && s.bubbles[state.activeBubbleIdx]) {
        pushState();
        s.bubbles[state.activeBubbleIdx].shape = shapeName;
        refresh();
        triggerAutoSave();
    }
}

// ──────────────────────────────────────
//  最近使った色パレット
// ──────────────────────────────────────
const RECENT_COLORS_KEY = 'dsf_bubble_recent_colors';
const RECENT_COLORS_MAX = 16;

function loadRecentColors() {
    try {
        return JSON.parse(localStorage.getItem(RECENT_COLORS_KEY) || '[]');
    } catch { return []; }
}

function addRecentColor(color) {
    const hex = (color || '').toLowerCase();
    if (!hex.match(/^#[0-9a-f]{6}$/)) return;
    let list = loadRecentColors();
    list = [hex, ...list.filter(c => c !== hex)].slice(0, RECENT_COLORS_MAX);
    try { localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(list)); } catch { }
    renderRecentColors();
}

function renderRecentColors() {
    const container = document.getElementById('bubble-recent-colors');
    if (!container) return;
    const list = loadRecentColors();
    if (list.length === 0) {
        container.innerHTML = '<span style="font-size:11px;color:#aaa;">まだありません</span>';
        return;
    }
    container.innerHTML = list.map(c =>
        `<button class="recent-color-swatch" style="background:${c};" title="${c}"
            onclick="applyRecentColor('${c}')" type="button"></button>`
    ).join('');
}

// 最後にアクティブだったカラープロップを記憶
let _lastColorProp = 'strokeColor';

function applyRecentColor(hex) {
    const propEls = {
        strokeColor: 'prop-stroke-color',
        fillColor: 'prop-fill-color',
        fontColor: 'prop-font-color'
    };
    // 選択中のカラーピッカーに適用
    const el = document.getElementById(propEls[_lastColorProp]);
    if (el) el.value = hex;
    updateBubbleColor(_lastColorProp, hex);
}
window.applyRecentColor = applyRecentColor;

function updateBubbleColor(prop, value) {
    _lastColorProp = prop;
    const s = getEditableActiveFixedSection();
    if (s && state.activeBubbleIdx !== null && s.bubbles && s.bubbles[state.activeBubbleIdx]) {
        s.bubbles[state.activeBubbleIdx][prop] = value;
        addRecentColor(value);
        refresh();
        triggerAutoSave();
    }
}
window.updateBubbleColor = updateBubbleColor;

// ─── AR 設定パネル ───────────────────────────────────────────────────────────


// フキダシ選択時に右パネルの値を同期する
function updateBubblePropPanel(bubble) {
    const shapeEl = document.getElementById('prop-shape');
    const strokeEl = document.getElementById('prop-stroke-color');
    const fillEl = document.getElementById('prop-fill-color');
    const fontEl = document.getElementById('prop-font-color');
    if (!bubble) {
        if (shapeEl) shapeEl.value = 'speech';
        if (strokeEl) strokeEl.value = '#000000';
        if (fillEl) fillEl.value = '#ffffff';
        if (fontEl) fontEl.value = '#000000';
        renderRecentColors();
        return;
    }
    if (shapeEl) shapeEl.value = bubble.shape || 'speech';
    if (strokeEl) strokeEl.value = bubble.strokeColor || '#000000';
    if (fillEl) fillEl.value = bubble.fillColor || '#ffffff';
    const defaultFont = (bubble.shape === 'urchin') ? '#ffffff' : '#000000';
    if (fontEl) fontEl.value = bubble.fontColor || defaultFont;
    renderRecentColors();
}
window.updateBubblePropPanel = updateBubblePropPanel;



// ──────────────────────────────────────
//  ページ送り方向更新
// ──────────────────────────────────────
function updatePageDirection(dir) {
    const lang = state.activeLang;
    if (!state.languageConfigs) state.languageConfigs = {};
    if (!state.languageConfigs[lang]) state.languageConfigs[lang] = {};
    state.languageConfigs[lang].pageDirection = dir;
    pushState();
    refresh();
    triggerAutoSave();
}
window.updatePageDirection = updatePageDirection;

function syncLangPanel() {
    const sel = document.getElementById('lang-page-direction');
    if (!sel) return;
    const dir = state.languageConfigs?.[state.activeLang]?.pageDirection || 'ltr';
    sel.value = dir;
}


let openingProject = null;
function onLoadProject(pid) {
    if(openingProject)return openingProject.pid===pid?openingProject.promise:Promise.resolve(false);
    const promise=performLoadProject(pid).finally(()=>{openingProject=null;});
    openingProject={pid,promise};return promise;
}
async function performLoadProject(pid) {
    const openingUid=state.uid;
    try {
        await flushBeforeSafeResume();
        await loadProject(pid, () => {
            resetFlowRuntimeForProjectChange({keepSession:true});
            clearHistory();
            ensureUiPrefs();
            applyThumbColumnsFromPrefs();
            refresh();
            renderLangSettings();
            if (getCurrentRoom() === 'press') enterPressRoom();
        });
        if(state.uid===openingUid&&state.projectId===pid&&!readSharedStudioAccess())noteRecentCloudOpen({projectId:pid});
        return true;
    } catch (error) {
        console.error('[Studio] Project load failed:', error);
        alert(`プロジェクトを安全に読み込めませんでした。\n${error?.message || String(error)}`);
        return false;
    }
}

// --- キーボードショートカット ---
document.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229 || _flowAuthoringComposing) return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        performProjectUndo();
    }
    if ((e.ctrlKey || e.metaKey) && (e.shiftKey && e.key === 'Z' || e.key === 'y')) {
        e.preventDefault();
        performProjectRedo();
    }
});

function refreshAfterHistoryRestore(focusSnapshot = null) {
    _flowAuthoringSourceRevision += 1;
    invalidateFlowRuntimeAuthoring();
    clearFlowDirectEditRuntime();
    restoreFlowDirectEditFocusSnapshot(focusSnapshot);
    refresh();
    if (focusSnapshot?.mode !== 'direct') restoreFlowAuthoringFocusSnapshot(focusSnapshot);
}

function performProjectUndo() {
    if (_flowTranslationJob?.state === 'running') {
        _flowTranslationJob.controller?.abort?.();
    }
    _flowTranslationJob = null;
    endHistoryGroup();
    const focusSnapshot = captureFlowEditorFocusSnapshot();
    const changed = undo((restoredFocus) => refreshAfterHistoryRestore(restoredFocus === undefined ? focusSnapshot : restoredFocus),
        { editorFocus: focusSnapshot });
    if (changed) triggerAutoSave();
    return changed;
}

function performProjectRedo() {
    if (_flowTranslationJob?.state === 'running') {
        _flowTranslationJob.controller?.abort?.();
    }
    _flowTranslationJob = null;
    endHistoryGroup();
    const focusSnapshot = captureFlowEditorFocusSnapshot();
    const changed = redo((restoredFocus) => refreshAfterHistoryRestore(restoredFocus === undefined ? focusSnapshot : restoredFocus),
        { editorFocus: focusSnapshot });
    if (changed) triggerAutoSave();
    return changed;
}

// --- グローバル関数の登録 ---
window.handleCanvasClick = (e) => {
    // テキストページはキャンバスクリックを無効にする（吹き出し追加・画像操作不要）
    const activeSection = getEditableActiveFixedSection();
    if (!activeSection || activeSection.type === 'text') return;
    pushState();
    handleCanvasClick(e, refresh);
    triggerAutoSave();
};
window.selectBubble = (e, i) => {
    if (!canEditActiveFixedPage()) return;
    selectBubble(e, i, refresh);
};
function hideContextMenu() {
    const contextMenu = document.getElementById('context-menu');
    if (!contextMenu) return;
    contextMenu.style.display = 'none';
    contextMenu.dataset.pointerX = '';
    contextMenu.dataset.pointerY = '';
}
function showContextMenuAt(x, y, html) {
    const contextMenu = document.getElementById('context-menu');
    if (!contextMenu) return;
    if (html !== null) contextMenu.innerHTML = html;
    contextMenu.style.display = 'flex';
    const rect = contextMenu.getBoundingClientRect();
    let menuX = x;
    let menuY = y;
    if (menuX + rect.width > window.innerWidth) menuX = window.innerWidth - rect.width - 8;
    if (menuY + rect.height > window.innerHeight) menuY = window.innerHeight - rect.height - 8;
    contextMenu.style.left = `${Math.max(8, menuX)}px`;
    contextMenu.style.top = `${Math.max(8, menuY)}px`;
}
function insertSectionBeforeActiveByType(sectionType = 'image') {
    if (state.version === 6) {
        const blockIdx = Number.isInteger(state.activeBlockIdx)
            ? state.activeBlockIdx
            : Math.max(0, (state.blocks || []).length - 1);
        pushState();
        insertPageNearBlock(blockIdx, 'before', refresh, sectionType);
        triggerAutoSave();
        return;
    }
    const activeIdx = Number.isInteger(state.activeIdx) ? state.activeIdx : -1;
    const insertAt = activeIdx >= 0 ? activeIdx : (state.sections || []).length;
    pushState();
    insertSectionAt(insertAt, refresh, sectionType);
    triggerAutoSave();
}
function isActiveCoverPage() {
    const activeIdx = Number.isInteger(state.activeIdx) ? state.activeIdx : -1;
    if (activeIdx < 0) return false;
    return isCoverPage(activeIdx);
}

function getCompositionIssueMessage(issue) {
    const messages = {
        cover_requires_even_pages: '表紙あり構成では総ページ数を偶数にしてください。',
        cover_requires_two_or_more_pages: '表紙あり構成には最低2ページが必要です。',
        cover_disallows_three_pages: '表紙あり3ページ構成は使用できません。2ページ、または4ページ以上の偶数にしてください。',
        spread_image_requires_covers: '表紙なし構成では見開き画像ページを使用できません。',
        spread_image_requires_full_covers: '見開き画像ページは C1/C2/C3/C4 構成の見開き位置でのみ使用できます。',
        spread_image_requires_adjacent_pair: '見開き画像ページは隣接する2ページ単位で配置してください。',
        spread_image_cannot_include_cover: '見開き画像ページに C1/C4 外側表紙ページを含めることはできません。',
        spread_image_invalid_body_pair: '見開き画像ページは C2|1、2|3、最終ページ|C3 のような紙面上の隣接見開き位置にだけ挿入できます。'
    };
    return messages[issue] || issue;
}

function alertCompositionIssues(issues) {
    const unique = [...new Set(issues || [])];
    if (!unique.length) return;
    alert(unique.map(getCompositionIssueMessage).join('\n'));
}

function validateSpreadImageCompositionForSections(sections) {
    const issues = getBookCompositionIssues({
        pageCount: (sections || []).length,
        book: state.book || {},
        bookMode: state.bookMode || state.book?.mode || 'simple',
        sections
    }).filter((issue) => issue.startsWith('spread_image_'));
    if (!issues.length) return true;
    alertCompositionIssues(issues);
    return false;
}

function insertSpreadImageBeforeActive() {
    if (state.version === 6) {
        alert('Project v6での見開きページ追加は、混在スパイン対応後に利用できます。');
        return;
    }
    const activeIdx = Number.isInteger(state.activeIdx) ? state.activeIdx : -1;
    const insertAt = activeIdx >= 0 ? activeIdx : (state.sections || []).length;
    const decision = canInsertSpreadImageAt(insertAt, (state.sections || []).length, state.book || {}, state.bookMode || state.book?.mode || 'simple');
    if (!decision.ok) {
        alertCompositionIssues(decision.issues);
        return;
    }
    pushState();
    insertSpreadImageAt(insertAt, refresh);
    triggerAutoSave();
}
function addProjectPageAtTail(sectionType) {
    if (state.version !== 6) return false;
    const blocks = state.blocks || [];
    pushState();
    insertPageNearBlock(blocks.length ? blocks.length - 1 : -1, 'after', refresh, sectionType);
    triggerAutoSave();
    return true;
}
window.addSection = () => {
    if (addProjectPageAtTail('image')) return;
    pushState();
    addSection(refresh);
    triggerAutoSave();
};
window.addTextSection = () => {
    if (addProjectPageAtTail('text')) return;
    pushState();
    addTextSection(refresh);
    triggerAutoSave();
};
async function insertFlowGroupAt(insertIndex, titlePage = false) {
    if(!canSwitchEditorLanguage())return;
    const originalBlocks=state.blocks;
    const choice=await chooseSourceLanguage({languages:state.languages,initial:state.defaultLang,configs:state.languageConfigs});
    if(!choice||state.blocks!==originalBlocks||!canSwitchEditorLanguage())return;
    const sourceLanguage=choice.languageKey,writingMode=choice.pageDirection==='rtl'?'vertical-rl':'horizontal-tb';
    endHistoryGroup();pushState();clearFlowDirectEditRuntime();
    state.activeLang=sourceLanguage;
    const group = createFlowGroupBlock({
        sourceLanguage,
        writingMode,
        document: {
            sourceLanguage,
            sections: [{
                title: { [sourceLanguage]: '' },
                blocks: [
                    { type: 'heading', level: 1, texts: { [sourceLanguage]: '' } },
                    { type: 'paragraph', texts: { [sourceLanguage]: '' } },
                ],
            }],
        },
    });
    if (titlePage) { group.flow.pageRole='title'; Object.assign(group.flow.layout.typographyByLanguage[sourceLanguage], {textAlign:'center',blockAlign:'center'}); }
    const nextBlocks = [...(state.blocks || [])];
    const insertAt = Math.max(0, Math.min(insertIndex, nextBlocks.length));
    nextBlocks.splice(insertAt, 0, group);
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'version', value: PROJECT_SCHEMA_VERSION } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'blocks', value: nextBlocks } });
    dispatch({ type: actionTypes.SET_ACTIVE_BLOCK_INDEX, payload: insertAt });
    dispatch({ type: actionTypes.SET_ACTIVE_BUBBLE_INDEX, payload: null });
    invalidateFlowRuntimePages({ preserveSelection: true });
    if (titlePage) selectFlowGeneratedPage(group.id); else selectFlowSource(group.id);
    refresh();
    triggerAutoSave();
}
window.insertFlowGroupBeforeActive = () => insertFlowGroupAt(
    Number.isInteger(state.activeBlockIdx) ? state.activeBlockIdx : (state.blocks || []).length);
window.insertSectionBeforeActive = () => insertSectionBeforeActiveByType('image');
window.insertTextSectionBeforeActive = () => insertSectionBeforeActiveByType('text');
window.insertSpreadImageBeforeActive = insertSpreadImageBeforeActive;
window.addSectionByType = (sectionType = 'image', e) => {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    hideContextMenu();
    if (sectionType === 'flow') {
        insertFlowGroupAt((state.blocks || []).length);
        return;
    }
    if (sectionType === 'text') {
        window.addTextSection();
        return;
    }
    if (sectionType === 'spread-image') {
        insertSpreadImageBeforeActive();
        return;
    }
    window.addSection();
};
window.showTailPageAddMenu = (e) => {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    const anchor = e?.currentTarget;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    showContextMenuAt(
        rect.left + rect.width - 220,
        rect.top - 8,
        `
            <div class="context-menu-item" onclick="addSectionByType('flow', event)">
                <span class="material-icons">article</span> ${t('flow_add_manuscript')}
            </div>
            <div class="context-menu-item" onclick="addSectionByType('image', event)">
                <span class="material-icons">add_photo_alternate</span> ${t('btn_add_section')}
            </div>
            <div class="context-menu-item" onclick="addSectionByType('spread-image', event)">
                <span class="material-icons">view_week</span> ${t('btn_add_spread_image_section')}
            </div>
        `
    );
};
window.updateTextSectionBody = updateTextSectionBody;
window.updatePageHeading = updatePageHeading;
window.jumpToTocPage = (pageIndex) => {
    changeSection(Number(pageIndex), refreshForThumbSelection);
};

/** テキストエリアのカーソル位置に改ページマーカーを挿入する */
window.insertPageBreak = function() {
    if (!canEditActiveFixedPage('text')) return;
    const ta = document.getElementById('prop-body-text');
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const val = ta.value;
    // 前後に改行を挿入（連続改ページを防ぐ）
    const before = start > 0 && val[start - 1] !== '\n' ? '\n' : '';
    const after  = end < val.length && val[end] !== '\n' ? '\n' : '';
    const marker = `${before}${PAGE_BREAK_MARKER}\n${after}`;
    const newVal = val.slice(0, start) + marker + val.slice(end);
    ta.value = newVal;
    const newCursor = start + marker.length;
    ta.setSelectionRange(newCursor, newCursor);
    ta.focus();
    updateTextSectionBody(newVal);
};

/** テキストエリアの選択範囲をルビ記法に変換する */
window.insertRubyMarkup = function() {
    if (!canEditActiveFixedPage('text')) return;
    const ta = document.getElementById('prop-body-text');
    if (!ta) return;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? start;
    const val = ta.value || '';
    const selected = val.slice(start, end);
    const baseText = selected || '漢字';
    const rubyText = 'かんじ';
    const markup = `{${baseText}|${rubyText}}`;
    const newVal = val.slice(0, start) + markup + val.slice(end);
    ta.value = newVal;

    const rubyStart = start + 1 + baseText.length + 1;
    const rubyEnd = rubyStart + rubyText.length;
    ta.focus();
    ta.setSelectionRange(rubyStart, rubyEnd);
    updateTextSectionBody(newVal);
};

// ── キャンバスへのドラッグ&ドロップ（画像アップロード） ──────────────────────
window.handleCanvasDragOver = (e) => {
    const s = getEditableActiveFixedSection('image');
    if (!s) return;
    // 画像ファイルを含むドラッグのみ受け付ける
    if ([...e.dataTransfer.types].some(t => t === 'Files')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        document.getElementById('canvas-view')?.classList.add('drag-over');
    }
};

window.handleCanvasDragLeave = (e) => {
    // canvas-view の外へ出たときのみ解除（子要素への移動は無視）
    if (!e.currentTarget.contains(e.relatedTarget)) {
        document.getElementById('canvas-view')?.classList.remove('drag-over');
    }
};

window.handleCanvasDrop = (e) => {
    e.preventDefault();
    document.getElementById('canvas-view')?.classList.remove('drag-over');
    const s = getEditableActiveFixedSection('image');
    if (!s) return;
    const file = e.dataTransfer.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    // 既存の uploadToStorage に File を渡すため擬似 input を作成
    pushState();
    uploadToStorage({ files: [file] }, refresh);
    triggerAutoSave();
};
window.changeSection = (i) => {
    if (Date.now() < suppressThumbClickUntil) return;
    _spreadActivationPinnedAdjIdx = -1; // サムネ選択時はピンを解除
    changeSection(i, refreshForThumbSelection);
};

// ──────────────────────────────────────
//  ページナビゲーション（ストリップヘッダーボタン・キーボード）
// ──────────────────────────────────────

function isOuterCoverPage(pageIndex) {
    const total = (state.sections || []).length;
    const coverKey = getPageCoverKey(pageIndex, state.book, state.bookMode, total);
    return coverKey === 'c1' || coverKey === 'c4';
}

function isCoverPage(pageIndex) {
    const total = (state.sections || []).length;
    return !!getPageCoverKey(pageIndex, state.book, state.bookMode, total);
}

function getReadablePageOrdinal(pageIndex) {
    const total = (state.sections || []).length;
    const idx = Number(pageIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= total) return 0;
    let ordinal = 0;
    for (let i = 0; i <= idx; i += 1) {
        if (!isCoverPage(i)) ordinal += 1;
    }
    return ordinal;
}

function getPageLabelForIndex(pageIndex) {
    const total = (state.sections || []).length;
    return getPageDisplayLabel(pageIndex, total, state.book, state.bookMode);
}

function getActiveCompareLang() {
    const langs = Array.isArray(state.languages) ? state.languages : [];
    if (langs.length < 2) return '';
    const active = state.activeLang || state.defaultLang || langs[0];
    return langs.find((code) => code !== active) || '';
}

function getLangShortCode(code) {
    return String(code || '').toUpperCase();
}

function getSpreadAdjacentPageIndex(activeIdx) {
    const sections = state.sections || [];
    const total = sections.length;
    if (activeIdx < 0 || activeIdx >= total) return -1;
    if (isOuterCoverPage(activeIdx)) return -1;
    const pinned = _spreadActivationPinnedAdjIdx;
    if (pinned >= 0 && pinned !== activeIdx && !isOuterCoverPage(pinned)) return pinned;

    const coverKey = getPageCoverKey(activeIdx, state.book, state.bookMode, total);
    const mode = state.bookMode || state.book?.mode || 'simple';
    const readableOrdinal = getReadablePageOrdinal(activeIdx);
    let candidate;
    if (coverKey === 'c2') {
        candidate = activeIdx + 1;
    } else if (coverKey === 'c3') {
        candidate = activeIdx - 1;
    } else if (mode === 'full') {
        candidate = readableOrdinal % 2 === 1 ? activeIdx - 1 : activeIdx + 1;
    } else {
        candidate = readableOrdinal % 2 === 1 ? activeIdx + 1 : activeIdx - 1;
    }
    if (candidate < 0 || candidate >= total) return -1;
    if (isOuterCoverPage(candidate)) return -1;
    return candidate;
}

function getSpreadAdjacentPageIndexForRole(pageIndex) {
    const sections = state.sections || [];
    const total = sections.length;
    if (pageIndex < 0 || pageIndex >= total) return -1;
    if (isOuterCoverPage(pageIndex)) return -1;

    const coverKey = getPageCoverKey(pageIndex, state.book, state.bookMode, total);
    const mode = state.bookMode || state.book?.mode || 'simple';
    const readableOrdinal = getReadablePageOrdinal(pageIndex);
    let candidate;
    if (coverKey === 'c2') {
        candidate = pageIndex + 1;
    } else if (coverKey === 'c3') {
        candidate = pageIndex - 1;
    } else if (mode === 'full') {
        candidate = readableOrdinal % 2 === 1 ? pageIndex - 1 : pageIndex + 1;
    } else {
        candidate = readableOrdinal % 2 === 1 ? pageIndex + 1 : pageIndex - 1;
    }
    if (candidate < 0 || candidate >= total) return -1;
    if (isOuterCoverPage(candidate)) return -1;
    return candidate;
}

function getVisualSpreadPageIndices(activeIdx, adjIdx, pageDir) {
    const activeFirst = pageDir === 'rtl'
        ? activeIdx >= adjIdx
        : activeIdx <= adjIdx;
    return activeFirst ? [activeIdx, adjIdx] : [adjIdx, activeIdx];
}

function getPageSliderBubbleText() {
    const activeIdx = state.activeIdx ?? 0;
    const compareLang = state.uiPrefs?.languageCompareView ? getActiveCompareLang() : '';
    if (compareLang) {
        const label = getPageLabelForIndex(activeIdx);
        return `${getLangShortCode(state.activeLang)} ${label} | ${label} ${getLangShortCode(compareLang)}`;
    }

    const adjIdx = getSpreadAdjacentPageIndex(activeIdx);
    if (adjIdx >= 0) {
        const lang = state.activeLang || state.defaultLang || 'ja';
        const pageDir = getEditorLangDirection(lang);
        const [leftIdx, rightIdx] = getVisualSpreadPageIndices(activeIdx, adjIdx, pageDir);
        return `${getPageLabelForIndex(leftIdx)} | ${getPageLabelForIndex(rightIdx)}`;
    }
    return getPageLabelForIndex(activeIdx);
}

function getPageSliderBubbleParts() {
    const activeIdx = state.activeIdx ?? 0;
    const compareLang = state.uiPrefs?.languageCompareView ? getActiveCompareLang() : '';
    if (compareLang) {
        const label = getPageLabelForIndex(activeIdx);
        return {
            left: `${getLangShortCode(state.activeLang)} ${label}`,
            right: `${label} ${getLangShortCode(compareLang)}`,
            activeSide: 'left'
        };
    }

    const adjIdx = getSpreadAdjacentPageIndex(activeIdx);
    if (adjIdx >= 0) {
        const lang = state.activeLang || state.defaultLang || 'ja';
        const pageDir = getEditorLangDirection(lang);
        const [leftIdx, rightIdx] = getVisualSpreadPageIndices(activeIdx, adjIdx, pageDir);
        return {
            left: getPageLabelForIndex(leftIdx),
            right: getPageLabelForIndex(rightIdx),
            activeSide: leftIdx === activeIdx ? 'left' : 'right'
        };
    }
    return null;
}

function syncPageNavigationSlider() {
    const presentation = getEditorPresentationState();
    const total = presentation.total;
    const activeIdx = presentation.activeIndex;
    const slider = document.getElementById('page-nav-slider');
    const bubble = document.getElementById('page-nav-slider-bubble');
    const totalEl = document.getElementById('page-nav-slider-total');
    const compareBtn = document.getElementById('btn-language-compare-view');
    const pageDirection = getEditorLangDirection(state.activeLang || state.defaultLang || 'ja');
    const isRtl = pageDirection === 'rtl';
    const ratio = total > 1 ? activeIdx / (total - 1) : 0;
    const visualRatio = isRtl ? 1 - ratio : ratio;
    const pct = ratio * 100;

    if (slider) {
        slider.max = String(Math.max(0, total - 1));
        slider.value = String(activeIdx);
        slider.disabled = total <= 1;
        slider.style.setProperty('--page-slider-progress', `${pct}%`);
        slider.dir = isRtl ? 'rtl' : 'ltr';
        slider.dataset.dir = pageDirection;
    }
    if (bubble) {
        const parts = presentation.projection ? null : getPageSliderBubbleParts();
        if (parts) {
            bubble.classList.add('is-pair');
            bubble.classList.toggle('active-left', parts.activeSide === 'left');
            bubble.classList.toggle('active-right', parts.activeSide === 'right');
            bubble.innerHTML = `<span class="page-nav-bubble-left">${escapeStudioHtml(parts.left)}</span><span class="page-nav-bubble-divider">|</span><span class="page-nav-bubble-right">${escapeStudioHtml(parts.right)}</span>`;
        } else {
            bubble.classList.remove('is-pair');
            bubble.classList.remove('active-left', 'active-right');
            bubble.textContent = presentation.label || getPageSliderBubbleText();
        }
        const width = slider?.clientWidth || bubble.parentElement?.clientWidth || 0;
        const thumb = 16;
        const x = width > thumb ? (thumb / 2) + (width - thumb) * visualRatio : 0;
        bubble.style.left = `${x}px`;
    }
    if (totalEl) {
        totalEl.textContent = String(getReadablePageCount(total, state.book, state.bookMode) || total);
    }
    if (compareBtn) {
        const enabled = !!state.uiPrefs?.languageCompareView && !!getActiveCompareLang();
        compareBtn.classList.toggle('active', enabled);
        compareBtn.disabled = hasFlowGroups(state)
            || !Array.isArray(state.languages)
            || state.languages.length < 2;
    }
    const spreadBtn = document.getElementById('btn-spread-view');
    if (spreadBtn) spreadBtn.disabled = hasFlowGroups(state);
}

window.onPageSliderInput = (value) => {
    const nextIdx = Number(value);
    const projection = getEditorPageProjection();
    if (projection) {
        if (!Number.isInteger(nextIdx) || nextIdx < 0 || nextIdx >= projection.pages.length) return;
        _spreadActivationPinnedAdjIdx = -1;
        activateProjectionPage(projection.pages[nextIdx]);
        return;
    }
    const sections = state.sections || [];
    if (!Number.isInteger(nextIdx) || nextIdx < 0 || nextIdx >= sections.length) return;
    _spreadActivationPinnedAdjIdx = -1;
    changeSection(nextIdx, refreshForThumbSelection);
};

window.pagePrev = () => {
    _spreadActivationPinnedAdjIdx = -1; // 通常ナビ時はピンを解除
    const projection = getEditorPageProjection();
    if (projection) {
        const index = getActiveProjectionPageIndex(projection);
        if (index > 0) activateProjectionPage(projection.pages[index - 1]);
        return;
    }
    const idx = state.activeIdx ?? 0;
    if (idx > 0) changeSection(idx - 1, refreshForThumbSelection);
};

window.pageNext = () => {
    _spreadActivationPinnedAdjIdx = -1; // 通常ナビ時はピンを解除
    const projection = getEditorPageProjection();
    if (projection) {
        const index = getActiveProjectionPageIndex(projection);
        if (index >= 0 && index < projection.pages.length - 1) {
            activateProjectionPage(projection.pages[index + 1]);
        }
        return;
    }
    const idx = state.activeIdx ?? 0;
    if (idx < (state.sections || []).length - 1) changeSection(idx + 1, refreshForThumbSelection);
};

window.pageVisualLeft = () => movePageSelectionByVisualDirection('left');
window.pageVisualRight = () => movePageSelectionByVisualDirection('right');

function movePageSelectionByVisualDirection(direction) {
    const projection = getEditorPageProjection();
    if (projection) {
        const index = getActiveProjectionPageIndex(projection);
        if (index < 0) return;
        const pageDirection = getEditorLangDirection(state.activeLang || state.defaultLang || 'ja');
        const delta = direction === 'right'
            ? (pageDirection === 'rtl' ? -1 : 1)
            : (pageDirection === 'rtl' ? 1 : -1);
        const nextIndex = index + delta;
        if (nextIndex < 0 || nextIndex >= projection.pages.length) return;
        _spreadActivationPinnedAdjIdx = -1;
        activateProjectionPage(projection.pages[nextIndex]);
        return;
    }
    const idx = state.activeIdx ?? 0;
    const pages = state.sections || [];
    if (!pages.length) return;
    const pageDirection = getEditorLangDirection(state.activeLang || state.defaultLang || 'ja');
    const delta = direction === 'right'
        ? (pageDirection === 'rtl' ? -1 : 1)
        : (pageDirection === 'rtl' ? 1 : -1);
    const pair = getSpreadPairIndices(idx);
    const nextIdx = pair.length > 1
        ? (delta > 0 ? pair[pair.length - 1] + 1 : pair[0] - 1)
        : idx + delta;
    if (nextIdx < 0 || nextIdx >= pages.length) return;
    _spreadActivationPinnedAdjIdx = -1;
    changeSection(nextIdx, refreshForThumbSelection);
}

// ──────────────────────────────────────
//  見開き表示 (Spread View)
// ──────────────────────────────────────

window.toggleSpreadView = () => {
    if (hasFlowGroups(state)) return;
    const current = state.uiPrefs?.spreadView || false;
    const next = !current;
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: {
        key: 'uiPrefs', value: { ...(state.uiPrefs || {}), spreadView: next, languageCompareView: next ? false : !!state.uiPrefs?.languageCompareView }
    }});
    // デスクトップ・モバイル両方のボタンを同期
    document.getElementById('btn-spread-view')?.classList.toggle('active', next);
    document.getElementById('btn-spread-view-mobile')?.classList.toggle('active', next);
    document.getElementById('btn-language-compare-view')?.classList.remove('active');
    // キャンバスサイズ再計算 → 見開きページ表示/非表示を更新
    refresh();
    fitCanvasView();
    syncPageNavigationSlider();
};

window.toggleLanguageCompareView = () => {
    if (hasFlowGroups(state)) return;
    if (!getActiveCompareLang()) return;
    const current = !!state.uiPrefs?.languageCompareView;
    const next = !current;
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: {
        key: 'uiPrefs', value: { ...(state.uiPrefs || {}), languageCompareView: next, spreadView: next ? false : !!state.uiPrefs?.spreadView }
    }});
    document.getElementById('btn-language-compare-view')?.classList.toggle('active', next);
    document.getElementById('btn-spread-view')?.classList.remove('active');
    document.getElementById('btn-spread-view-mobile')?.classList.remove('active');
    refresh();
    fitCanvasView();
    syncPageNavigationSlider();
    triggerAutoSave();
};

/**
 * 見開きページ（隣接ページ）を描画・更新する
 */
/**
 * テキストセクションの組版 HTML を任意のコンテナへ描画する
 * renderTextPreview と同じロジックだが DOM id に依存せず要素を受け取る。
 */
function _renderTextIntoSpread(section, lang, outerEl, frameEl, contentEl) {
    const writingMode  = getWritingModeFromConfigs(lang, state.languageConfigs);
    const fontPreset   = getFontPresetFromConfigs(lang, state.languageConfigs);
    const raw          = section.texts?.[lang] ?? '';

    let rubyTokens, hasRuby, plainText, rubyLines;
    try {
        rubyTokens = parseRubyTokens(raw);
        hasRuby    = rubyTokens.some(t => t.kind === 'ruby');
        plainText  = hasRuby ? tokensToPlainText(rubyTokens) : raw;
    } catch (_) {
        rubyTokens = []; hasRuby = false; plainText = raw;
    }

    const composed = composeText(plainText, lang, writingMode, fontPreset);
    const textAlign = _getTextSectionAlign(section);
    try { rubyLines = hasRuby ? alignRubyToLines(rubyTokens, composed.lines) : null; }
    catch (_) { rubyLines = null; }

    const paperStyle = _getTextPaperStyle(_getTextPaperPresetKey(section));
    outerEl.style.backgroundColor = paperStyle.backgroundColor;

    const { x, y, w, h } = composed.frame;
    frameEl.style.cssText = [
        `position:absolute`,
        `left:${x}px`, `top:${y}px`,
        `width:${w}px`, `height:${h}px`,
        `font-family:${composed.font.family}`,
        `font-size:${composed.font.size}px`,
        `color:${paperStyle.textColor}`,
        `letter-spacing:${composed.font.letterSpacing ? composed.font.letterSpacing + 'px' : '0'}`,
    ].join(';');
    frameEl.setAttribute('lang', lang.toLowerCase());

    if (!raw) { contentEl.innerHTML = ''; return; }

    if (composed.writingMode === 'vertical-rl') {
        const maxCols      = composed.rules?.maxLines    || 12;
        const charsPerCol  = composed.rules?.charsPerLine || 33;
        const fontSize     = composed.font.size;
        const colW         = Math.floor(w / maxCols);
        const lineHeight   = (colW / fontSize).toFixed(3);
        const letterSpacing = ((h / charsPerCol) - fontSize).toFixed(3);
        const charPitch    = h / charsPerCol;
        const rubyFontSize = Math.round(fontSize * 0.5);
        const rubyColW     = Math.round(fontSize * 0.65);
        const charRightOffset = Math.round((colW - fontSize) / 2);
        const verticalJustify = _getVerticalBlockJustifyCss(section);
        const usedCols = composed.lines.length;
        const groupW = usedCols * colW;
        const blockOffsetX = _getVerticalBlockOffsetPx(section, w, usedCols, colW);

        const cols = composed.lines.map((line, i) => {
            const content = rubyLines
                ? _baseTextFromTokenLine(rubyLines[i])
                : _markupVerticalLine(line);
            return `<span class="tpv-col"` +
                ` style="width:${colW}px;line-height:${lineHeight};letter-spacing:${letterSpacing}px"` +
                `>${content}</span>`;
        }).join('');

        let rubyOverlay = '';
        if (rubyLines) {
            const anns = [];
            for (let i = 0; i < rubyLines.length; i++) {
                let charOffset = 0;
                for (const tok of rubyLines[i]) {
                    const baseLen = tok.kind === 'ruby'
                        ? Array.from(tok.base || '').length
                        : Array.from(tok.text || '').length;
                    if (tok.kind === 'ruby' && tok.ruby) {
                        const annLeft = groupW - i * colW - charRightOffset;
                        const rubyLen = Array.from(tok.ruby).length;
                        const rubyH   = Math.round(rubyLen * rubyFontSize * 1.2);
                        const baseH   = Math.round(baseLen * charPitch);
                        const annTop  = Math.round(charOffset * charPitch + Math.max(0, (baseH - rubyH) / 2));
                        anns.push(
                            `<span class="tpv-ruby-ann"` +
                            ` style="left:${Math.round(blockOffsetX + annLeft)}px;top:${annTop}px;` +
                            `width:${rubyColW}px;font-size:${rubyFontSize}px"` +
                            `>${_escHtml(_verticalGlyphText(tok.ruby))}</span>`
                        );
                    }
                    charOffset += baseLen;
                }
            }
            if (anns.length) rubyOverlay = `<div class="tpv-ruby-overlay">${anns.join('')}</div>`;
        }
        contentEl.innerHTML = `<div class="tpv-vertical" style="justify-content:${verticalJustify}">${cols}</div>${rubyOverlay}`;
    } else {
        const lineH = h / (composed.rules?.maxLines || 20);
        const offsetY = _getHorizontalTextOffsetY(composed);
        const horizontalJustify = _getHorizontalBlockJustifyCss(section);
        let html;
        if (rubyLines) {
            html = rubyLines.map((tokenLine, idx) =>
                !composed.lines[idx]
                    ? `<div class="tpv-blank" style="height:${lineH}px"></div>`
                    : `<div class="tpv-line">${tokenLine.map(tok =>
                        tok.kind === 'ruby'
                            ? `<ruby>${_markupTcyText(tok.base)}<rt>${_escHtml(tok.ruby || '')}</rt></ruby>`
                            : _escHtml(tok.text || '')
                      ).join('')}</div>`
            ).join('');
        } else {
            html = (composed.lines || []).map(line =>
                !line
                    ? `<div class="tpv-blank" style="height:${lineH}px"></div>`
                    : `<div class="tpv-line">${_escHtml(line)}</div>`
            ).join('');
        }
        contentEl.innerHTML =
            `<div class="tpv-horizontal" lang="${lang.toLowerCase()}" style="line-height:${lineH}px;transform:translateY(${offsetY}px);justify-content:${horizontalJustify}"><div class="tpv-horizontal-block">${html}</div></div>`;
    }
}

function refreshSpreadPage() {
    const isSpread = state.uiPrefs?.spreadView || false;
    const compareLang = state.uiPrefs?.languageCompareView ? getActiveCompareLang() : '';
    const isLanguageCompare = !!compareLang;
    const spreadEl = document.getElementById('canvas-spread-page');
    const stage    = document.getElementById('canvas-stage');
    if (!spreadEl || !stage) return;
    if (hasFlowGroups(state) || !isLanguageCompare) {
        spreadEl.style.display = 'none';
        stage.style.flexDirection = '';
        stage.classList.remove('spread-image-pair-active');
        document.getElementById('canvas-transform-layer')?.classList.remove('active-pair-page');
        return;
    }

    // スプレッドボタンのアクティブ状態を同期
    const btn = document.getElementById('btn-spread-view');
    if (btn) btn.classList.toggle('active', isSpread);

    // 見出し入力はアクティブページ上端の外側に出すため、ページレイヤー自体は clip しない。
    const transformLayer = document.getElementById('canvas-transform-layer');
    if (transformLayer) {
        transformLayer.style.overflow = 'visible';
        transformLayer.classList.toggle('active-pair-page', isSpread || isLanguageCompare);
    }
    stage.classList.remove('spread-image-pair-active');
    spreadEl.classList.remove('spread-image-pair-active');

    if (!isSpread && !isLanguageCompare) {
        spreadEl.style.display = 'none';
        stage.style.flexDirection = '';
        if (transformLayer) transformLayer.classList.remove('active-pair-page');
        return;
    }

    const lang    = state.activeLang || state.defaultLang || 'ja';
    // languageConfigs に保存された pageDirection を参照（'rtl' | 'ltr'）
    const pageDir = state.languageConfigs?.[lang]?.pageDirection || (lang === 'ja' ? 'rtl' : 'ltr');
    const isRTL   = pageDir === 'rtl';

    const sections  = state.sections || [];
    const activeIdx = state.activeIdx ?? 0;
    const total     = sections.length;
    const adjIdx = isLanguageCompare ? activeIdx : getSpreadAdjacentPageIndex(activeIdx);
    const renderLang = isLanguageCompare ? compareLang : lang;

    if (adjIdx < 0 || adjIdx >= total) {
        spreadEl.style.display = 'none';
        stage.style.flexDirection = '';
        return;
    }

    // flex 方向: ページ番号（インデックス）が小さい方を右（RTL）または左（LTR）に固定する。
    // #canvas-transform-layer（アクティブ）が常に低インデックス側とは限らないため、
    // activeIdx と adjIdx の大小で flex-direction を決定する。
    //   RTL: 低インデックス → 右 (transform-layer が右) → activeIdx < adjIdx なら row-reverse, それ以外は row
    //   LTR: 低インデックス → 左 (transform-layer が左) → activeIdx < adjIdx なら row, それ以外は row-reverse
    if (isLanguageCompare) {
        stage.style.flexDirection = 'row';
    } else if (isRTL) {
        stage.style.flexDirection = activeIdx < adjIdx ? 'row-reverse' : 'row';
    } else {
        stage.style.flexDirection = activeIdx < adjIdx ? 'row' : 'row-reverse';
    }

    spreadEl.style.display = 'block';
    spreadEl.dataset.adjIdx = adjIdx;

    const adjSection = sections[adjIdx];
    const activeSection = sections[activeIdx];
    const sharedSpreadGroup = !isLanguageCompare
        && activeSection?.spreadImage?.groupId
        && activeSection.spreadImage.groupId === adjSection?.spreadImage?.groupId;
    stage.classList.toggle('spread-image-pair-active', !!sharedSpreadGroup);
    spreadEl.classList.toggle('spread-image-pair-active', !!sharedSpreadGroup);

    // ページ番号ラベル
    const labelEl = document.getElementById('canvas-spread-label');
    if (labelEl) {
        const adjLabel = getPageDisplayLabel(adjIdx, total, state.book, state.bookMode);
        labelEl.textContent = `${adjLabel} ${renderLang.toUpperCase()}`;
    }

    // ── 隣ページのコンテンツを描画 ──────────────────────────────
    const contentEl = document.getElementById('canvas-spread-content');
    if (!contentEl) return;

    renderFixedPagePreview(contentEl, adjSection, renderLang, adjIdx);
}

function renderFixedPagePreview(contentEl, adjSection, renderLang, adjIdx) {
    const token = {};
    contentEl._fixedPreviewToken = token;
    function appendPreviewBubbles() {
        appendGraphicPreview(contentEl,adjSection,state.projectAssets||[],renderLang,state.defaultLang).catch(()=>{contentEl.dataset.graphicRenderError='true';});

        // 吹き出しレイヤー
        const bubbles = adjSection.bubbles || [];
        if (bubbles.length > 0) {
            const langProps = getLangProps(renderLang);
            const bLayer = document.createElement('div');
            bLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;';
            bLayer.innerHTML = bubbles.map((b, i) =>
                renderBubbleHTML(b, i, false, langProps.defaultWritingMode || 'horizontal-tb')
            ).join('');
            // Passive previews must not duplicate the active editor's IDs or invoke editing handlers.
            const ids = new Map([...bLayer.querySelectorAll('[id]')].map(el => [el.id, `preview-${adjIdx}-${el.id}`]));
            bLayer.querySelectorAll('*').forEach(el => {
                for (const attr of [...el.attributes]) {
                    if (attr.name.startsWith('on') || ['contenteditable', 'tabindex'].includes(attr.name)) {
                        el.removeAttribute(attr.name);
                    } else {
                        let value = attr.value.replace(/url\(#([^)]*)\)/g, (match, id) => ids.has(id) ? `url(#${ids.get(id)})` : match);
                        if (['href', 'xlink:href'].includes(attr.name) && ids.has(value.slice(1))) value = `#${ids.get(value.slice(1))}`;
                        if (value !== attr.value) el.setAttribute(attr.name, value);
                    }
                }
                if (el.id) el.id = ids.get(el.id);
            });
            graphicOrder(adjSection).forEach((entry,index)=>{if(entry.legacy){const node=bLayer.querySelector(`[id$="bubble-svg-${entry.index}"]`);if(node){node.style.zIndex=String((index+1)*2);node.style.display=entry.legacy.visible===false?'none':'';}}});
            bLayer.style.display='contents';
            bLayer.setAttribute('inert', '');
            contentEl.appendChild(bLayer);
        }
    }

    if (adjSection.type === 'text') {
        // テキストページ: renderTextPreview と同じロジックで描画
        contentEl.innerHTML = '';
        contentEl.style.backgroundImage = '';
        contentEl.style.backgroundColor = '';
        contentEl.style.position = 'relative';
        contentEl.style.width  = '100%';
        contentEl.style.height = '100%';
        contentEl.style.overflow = 'hidden';

        // フレーム要素を確保（初回は作成）
        let spFrame = contentEl.querySelector('.spread-text-frame');
        let spContent = contentEl.querySelector('.spread-text-content');
        if (!spFrame) {
            spFrame   = document.createElement('div');
            spFrame.className = 'spread-text-frame';
            spContent = document.createElement('div');
            spContent.className = 'spread-text-content';
            spFrame.appendChild(spContent);
            contentEl.appendChild(spFrame);
        }
        contentEl.style.backgroundColor = _getTextPaperStyle(_getTextPaperPresetKey(adjSection)).backgroundColor;
        _renderTextIntoSpread(adjSection, renderLang, contentEl, spFrame, spContent);
        appendPreviewBubbles();
    } else {
        // 画像ページ: メインキャンバスと同じ位置・トリミングで描画
        contentEl.innerHTML = '';
        contentEl.style.backgroundImage = '';
        contentEl.style.position = 'relative';
        contentEl.style.width  = '100%';
        contentEl.style.height = '100%';
        contentEl.style.overflow = 'hidden';
        contentEl.style.backgroundColor = adjSection.backgroundColor || '#fff';

        const bgUrl = getOptimizedImageUrl(
            adjSection.backgrounds?.[renderLang] || adjSection.backgrounds?.[state.defaultLang] || adjSection.background || ''
        );

        if (!bgUrl) {
            // 画像未設定: プレースホルダー
            contentEl.innerHTML =
                `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#aaa;">
                    <span class="material-icons" style="font-size:48px;">add_photo_alternate</span>
                </div>`;
            appendPreviewBubbles();
        } else {
            // 言語別位置 → 共通位置 → レガシー → デフォルトの優先順で取得（main canvas と同じロジック）
            const pos = adjSection.imagePositions?.[renderLang]
                || adjSection.imagePositions?.[state.defaultLang]
                || adjSection.imageBasePosition
                || adjSection.imagePosition
                || { x: 0, y: 0, scale: 1, rotation: 0, flipX: false };
            const cached = editorImageAspectCache.get(bgUrl);

            const _renderSpreadImg = () => {
                const { frameMetrics, targetTransform } = getImageAdjustRenderMetrics(bgUrl, pos, getSpreadImageRenderOptions(adjSection, adjIdx));
                // 画像レイヤー（メインキャンバスと同じ transform）
                const imgEl = document.createElement('img');
                imgEl.src = bgUrl;
                imgEl.style.cssText = [
                    'position:absolute',
                    'top:50%', 'left:50%',
                    `width:${frameMetrics.widthPercent}%`,
                    `height:${frameMetrics.heightPercent}%`,
                    `transform:${targetTransform}`,
                    'transform-origin:center center',
                    'pointer-events:none',
                ].join(';');
                contentEl.appendChild(imgEl);

                appendPreviewBubbles();
            };

            if (cached) {
                // アスペクト比がキャッシュ済み → 即座に描画
                _renderSpreadImg();
            } else {
                // アスペクト比未キャッシュ → object-fit:cover で仮表示し、ロード後に再描画
                const tmpImg = document.createElement('img');
                tmpImg.src = bgUrl;
                tmpImg.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
                contentEl.appendChild(tmpImg);
                const loader = new Image();
                loader.onload = () => {
                    if (loader.naturalWidth && loader.naturalHeight) {
                        editorImageAspectCache.set(bgUrl, loader.naturalWidth / loader.naturalHeight);
                    }
                    // キャッシュが埋まったら正確な位置で再描画
                    if (contentEl.isConnected && contentEl._fixedPreviewToken === token) {
                        contentEl.innerHTML = '';
                        contentEl.style.backgroundColor = adjSection.backgroundColor || '#fff';
                        _renderSpreadImg();
                    }
                };
                loader.src = bgUrl;
            }
        }
    }
}

/**
 * 見開きの隣ページをクリック → そのページをアクティブにして編集可能にする。
 * 見開きに表示されている 2 ページは変わらない（ページ送りなし）。
 */
window.spreadPageActivate = (e) => {
    if (e) e.stopPropagation();
    const spreadEl = document.getElementById('canvas-spread-page');
    if (!spreadEl) return;
    const adjIdx = parseInt(spreadEl.dataset.adjIdx, 10);
    if (!Number.isInteger(adjIdx) || adjIdx < 0) return;

    // 現在のアクティブページを「次の隣ページ」としてピン留めする。
    // refreshSpreadPage はこの値を参照して表示を維持する。
    _spreadActivationPinnedAdjIdx = state.activeIdx ?? 0;
    changeSection(adjIdx, refreshForThumbSelection);
    // changeSection → refresh → refreshSpreadPage が同期的に完了した後にリセット
    _spreadActivationPinnedAdjIdx = -1;
};

// ──────────────────────────────────────
//  キーボードナビゲーション（エディター）
// ──────────────────────────────────────

document.addEventListener('keydown', (e) => {
    // テキスト入力中・モーダル表示中はスキップ
    const tag = document.activeElement?.tagName || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (document.activeElement?.getAttribute('contenteditable') === 'true') return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (getCurrentRoom() !== 'editor') return;
    // ページストリップが折りたたまれていてもナビは有効にする
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        // 画像調整モード中は矢印キーを使わない
        if (document.getElementById('canvas-transform-layer')?.classList.contains('adjust-image-mode')) return;
        e.preventDefault();
        movePageSelectionByVisualDirection(e.key === 'ArrowRight' ? 'right' : 'left');
    }
});
window.changeBlock = (idx) => {
    if (Date.now() < suppressThumbClickUntil) return;
    changeBlock(idx, refreshForThumbSelection);
};
window.changeFlowSourceBlock = (blockIndex) => {
    if (Date.now() < suppressThumbClickUntil) return;
    const block = state.blocks?.[Number(blockIndex)];
    if (block?.kind !== 'flow') return;
    endHistoryGroup();
    if (_flowAuthoringComposing || _flowImageInsertionBusy) return;
    const page = getEditorPageProjection()?.pages.find(page => page.kind === 'flow'
        && page.groupId === block.id && page.flowPageIndex === getSelectedFlowRuntimePageIndex(block.id));
    let point = resolveEditorFlowSourcePoint(block, page, _flowDirectEditSession, {
        start: _flowDirectEditProxy?.selectionStart, end: _flowDirectEditProxy?.selectionEnd,
        direction: _flowDirectEditProxy?.selectionDirection });
    // Fallback text has no equivalent translated character offset. Open the same block.
    const languageKey = getFlowAuthoringLanguage(block);
    if (point && point.languageKey !== languageKey) point = { ...point, languageKey, utf16Offset: 0, graphemeOffset: 0 };
    objectToolbar.clearSelection();
    clearFlowDirectEditRuntime();
    selectFlowSource(block.id, point || {});
    changeBlock(blockIndex, refresh);
    if (point) restoreMappedFlowSourceCaret(block.id, point);
};
window.changeFlowGeneratedPage = (blockIndex, flowPageIndex) => {
    if (Date.now() < suppressThumbClickUntil) return;
    const block = state.blocks?.[Number(blockIndex)];
    if (block?.kind !== 'flow') return;
    const projection = getEditorPageProjection();
    const pageCount = projection?.pages?.filter((page) => (
        page.kind === 'flow' && page.groupId === block.id
    )).length || 1;
    endHistoryGroup();
    selectFlowGeneratedPage(block.id);
    setSelectedFlowRuntimePageIndex(block.id, flowPageIndex, pageCount);
    changeBlock(blockIndex, refreshForThumbSelection);
};
window.insertSectionAtIndex = (idx, e) => {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    if (state.version === 6) {
        alert('Project v6ではページ上の＋ボタンを使って挿入位置を指定してください。');
        return;
    }
    const insertAt = Math.max(0, Math.min(Number(idx) || 0, (state.sections || []).length));
    const simulated = [...(state.sections || [])];
    simulated.splice(insertAt, 0, { type: 'image' });
    if (!validateSpreadImageCompositionForSections(simulated)) return;
    pushState();
    insertSectionAt(insertAt, refresh);
    triggerAutoSave();
};
window.duplicateSectionByIndex = (idx, e) => {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    if (state.version === 6) return;
    pushState();
    duplicateSectionAt(idx, refresh);
    triggerAutoSave();
};
window.insertPageNearBlock = (blockIdx, position, e) => {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    pushState();
    insertPageNearBlock(blockIdx, position, refresh);
    triggerAutoSave();
};
window.duplicateBlockByIndex = (blockIdx, e) => {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    if (state.blocks?.[blockIdx]?.kind === 'flow') return;
    pushState();
    duplicateBlockAt(blockIdx, refresh);
    triggerAutoSave();
};
window.moveBlockByIndex = (blockIdx, direction, e) => {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    pushState();
    const moved = moveBlockAt(blockIdx, direction, refresh);
    if (moved) triggerAutoSave();
};
function isPersistedFixedPageIndex(pageIndex) {
    const blockIndex = getBlockIndexFromPageIndex(state.blocks || [], Number(pageIndex));
    return blockIndex >= 0
        && state.blocks?.[blockIndex]?.kind === 'page'
        && !state.sections?.[Number(pageIndex)]?.spreadImage?.groupId;
}

function applyEditorSpineChange(result, options = {}) {
    assertSharedStudioEdit();
    const editorFocus = captureFlowEditorFocusSnapshot();
    endHistoryGroup();
    pushState({ editorFocus, ...options.history });
    clearFlowDirectEditRuntime();
    if (result.projectAssets) { state.version = 6; state.projectAssets = result.projectAssets; }
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'blocks', value: result.blocks } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'sections', value: result.blocks.some(block=>block.kind==='page') ? extractSectionsFromBlocks(result.blocks) : [] } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'pages', value: blocksToPages(result.blocks) } });
    dispatch({ type: actionTypes.SET_ACTIVE_BLOCK_INDEX, payload: result.activeBlockIndex });
    dispatch({ type: actionTypes.SET_ACTIVE_INDEX, payload: Math.max(0, getPageIndexFromBlockIndex(result.blocks, result.activeBlockIndex)) });
    dispatch({ type: actionTypes.SET_ACTIVE_BUBBLE_INDEX, payload: null });
    const active = result.blocks[result.activeBlockIndex];
    if (active.kind === 'flow') {
        if(options.preserveFlowSource)selectFlowSource(active.id);else selectFlowGeneratedPage(active.id);
        setSelectedFlowRuntimePageIndex(active.id, options.flowPageIndex || 0);
    }
    _flowAuthoringSourceRevision += 1;
    invalidateFlowRuntimePages({ preserveSelection: true });
    refresh();
    updateHistoryButtons();
    triggerAutoSave();
}

function editorDragBlocked(requireV6 = true) {
    return (requireV6 && state.version !== 6) || _flowAuthoringComposing || _flowImageInsertionBusy
        || _flowDirectEditApplying || _flowTranslationJob?.state === 'running';
}

function resolveEditorThumbDrop(hit, x, y, context) {
    if (editorDragBlocked()) return null;
    const image = state.blocks.find(block => block.id === context.id);
    const isImage = image?.kind === 'page' && image.content?.pageKind === 'image' && !image.content.spreadImage;
    const projection = getEditorPageProjection();
    const thumb = hit?.closest('.thumb-wrap[data-editor-unit-id]');
    if (thumb) {
        const container = thumb.closest('#page-strip-thumbs, #thumb-container');
        const horizontal = container.id === 'page-strip-thumbs' || innerWidth < 1024;
        const rtl = container.dataset.dir === 'rtl';
        const box = thumb.getBoundingClientRect();
        const before = horizontal ? (x < box.left + box.width / 2) !== rtl : y < box.top + box.height / 2;
        const position = before ? 'before' : 'after';
        if (isImage && thumb.dataset.flowPageIndex !== undefined && !projection) return null;
        const groupPages = projection?.pages.filter(page => page.kind === 'flow'
            && page.groupId === thumb.dataset.editorUnitId) || [];
        const pageIndex = Number(thumb.dataset.flowPageIndex);
        if (isImage && groupPages.length && (before ? pageIndex > 0 : pageIndex < groupPages.length - 1)) {
            const page = groupPages.find(page => page.flowPageIndex === pageIndex);
            const point = resolveEditorFlowPageBoundary(page, position);
            return createEditorImageFlowDrop(page, point, context, {
                left: before !== rtl ? box.left : box.right, top: box.top, width: box.width, height: box.height,
            }, horizontal ? 'vertical' : 'horizontal', t('flow_drag_insert_image_boundary'));
        }
        const result = moveAuthoringUnitInSpine(state.blocks, { sourceBlockId: context.id,
            targetBlockId: thumb.dataset.editorUnitId, position });
        if (!result.changed) return null;
        const target = state.blocks.find(block => block.id === thumb.dataset.editorUnitId);
        const spreadId = target?.content?.spreadImage?.groupId;
        const targetIds = new Set(spreadId
            ? state.blocks.filter(block => block.content?.spreadImage?.groupId === spreadId).map(block => block.id)
            : [thumb.dataset.editorUnitId]);
        const unitThumbs = [...container.querySelectorAll('.thumb-wrap[data-editor-unit-id]')]
            .filter(el => targetIds.has(el.dataset.editorUnitId));
        const edge = (before ? unitThumbs[0] : unitThumbs.at(-1)).getBoundingClientRect();
        return { kind: 'spine', targetId: thumb.dataset.editorUnitId, position,
            label: context.label, orientation: horizontal ? 'vertical' : 'horizontal',
            rect: { left: horizontal ? (before !== rtl ? edge.left : edge.right) : edge.left,
                top: horizontal ? edge.top : before ? edge.top : edge.bottom, width: edge.width, height: edge.height } };
    }
    const slot=hit?.closest('.flow-canvas-page-slot');
    if(slot&&(context.canvas||!hit.closest('.flow-editor-page-surface'))){
        const index=Number(slot.dataset.blockIndex),target=state.blocks[index];if(!target)return null;
        const box=slot.getBoundingClientRect(),rtl=slot.dataset.direction==='rtl',before=(x<box.left+box.width/2)!==rtl,position=before?'before':'after';
        const result=moveAuthoringUnitInSpine(state.blocks,{sourceBlockId:context.id,targetBlockId:target.id,position});if(!result.changed)return null;
        return {kind:'spine',targetId:target.id,position,label:context.label,rect:{left:before!==rtl?box.left:box.right,top:box.top,width:box.width,height:box.height}};
    }
    const surface = hit?.closest('.flow-editor-page-surface');
    const page = surface?._flowPageEntry;
    if (!page || !isImage || page.isSourceFallback) return null;
    if (!projection || !projection.pages.some(entry => entry.runtimeKey === page.runtimeKey)) return null;
    try {
        const point = mapFlowClientPointToSource(surface, page.page, x, y, { writingMode: page.writingMode });
        if (!point) return null;
        const rect = getFlowSourcePointClientRect(surface, page.page, point, {writingMode: page.writingMode});
        return createEditorImageFlowDrop(page, point, context, rect, rect?.caretOrientation, t('flow_drag_insert_image'));
    } catch { return null; }
}

function createEditorImageFlowDrop(page, point, context, rect, orientation, label) {
    if (!page || !point || !rect || page.isSourceFallback) return null;
    const group = getFlowGroupById(page.groupId);
    if (!group || page.languageKey !== group.flow.document.sourceLanguage) return null;
    const boundary = moveAuthoringUnitInSpine(state.blocks, {sourceBlockId: context.id,
        targetBlockId: group.id, position: 'before'});
    if (!boundary.changed && boundary.reason !== 'no_change') return null;
    try {
        const session = createFlowDirectEditSession(group, {pageLanguageKey: page.languageKey,
            writingMode: page.writingMode, sourcePoint: point});
        return { kind: 'flow-text', session, point, rect, orientation, label };
    } catch { return null; }
}

bindEditorThumbnailDrag({
    root: document.getElementById('editor-room'),
    begin: thumb => {
        if (!canEditSharedStudio() || editorDragBlocked()) return null;
        hideContextMenu();
        const block = state.blocks.find(block => block.id === thumb.dataset.editorUnitId);
        if (!block || !['flow', 'page'].includes(block.kind)) return null;
        return { id: block.id, snapshot: JSON.stringify(state.blocks), projectId: state.projectId, uid: state.uid,
            language: state.activeLang, canvas:thumb.classList.contains('editor-canvas-drag-handle'), flowPageIndex: Number(thumb.dataset.flowPageIndex) || 0,
            label: t(block.kind === 'flow' ? 'flow_drag_whole_group' : 'flow_drag_image_or_page') };
    },
    resolve: resolveEditorThumbDrop,
    commit: (target, context) => {
        if (editorDragBlocked() || context.projectId !== state.projectId || context.uid !== state.uid
            || context.language !== state.activeLang || context.snapshot !== JSON.stringify(state.blocks)) return;
        try {
            if (target.kind === 'spine') {
                const result = moveAuthoringUnitInSpine(state.blocks, {sourceBlockId: context.id,
                    targetBlockId: target.targetId, position: target.position});
                if (result.changed) applyEditorSpineChange(result, context);
            } else {
                const result = moveExistingImageIntoFlow(state.blocks, target.session, {
                    imageBlockId: context.id, selectionStart: target.point.utf16Offset,
                    selectionEnd: target.point.utf16Offset, expectedText: target.session.expectedText });
                applyEditorSpineChange(result);
            }
            suppressThumbClickUntil = Date.now() + 350;
        } catch {
            alert(t('flow_drag_failed'));
        }
    },
    moveByKey: (thumb, key) => {
        if (editorDragBlocked()) return;
        const sourceIndex = state.blocks.findIndex(block => block.id === thumb.dataset.editorUnitId);
        const rtl = thumb.closest('#page-strip-thumbs, #thumb-container')?.dataset.dir === 'rtl';
        const forward = (key === 'ArrowRight') !== rtl;
        const target = state.blocks[sourceIndex + (forward ? 1 : -1)];
        if (!target) return;
        const result = moveAuthoringUnitInSpine(state.blocks, {sourceBlockId: thumb.dataset.editorUnitId,
            targetBlockId: target.id, position: forward ? 'after' : 'before'});
        if (result.changed) applyEditorSpineChange(result, {flowPageIndex:Number(thumb.dataset.flowPageIndex)||0});
    },
});

window.startThumbDrag = (e, idx) => {
    if (state.version === 6 && !isPersistedFixedPageIndex(idx)) return;
    thumbDragSourceIdx = idx;
    addThumbClassToSpreadPair(idx, 'drag-source');
    if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(idx));
    }
};
window.onThumbDragOver = (e, idx) => {
    if (!Number.isInteger(thumbDragSourceIdx)) return;
    if (state.version === 6 && !isPersistedFixedPageIndex(idx)) return;
    e.preventDefault();
    const el = getThumbElement(idx);
    if (!el) return;
    const position = getDropPositionByPoint(el, e.clientX, e.clientY);
    markThumbDropHint(idx, position);
};
window.onThumbDragLeave = () => {
    // no-op; keep hint until a new target is selected
};
window.onThumbDrop = (e, idx) => {
    if (!Number.isInteger(thumbDragSourceIdx)) return;
    if (state.version === 6 && !isPersistedFixedPageIndex(idx)) return;
    e.preventDefault();
    const el = getThumbElement(idx);
    if (!el) return;
    const position = getDropPositionByPoint(el, e.clientX, e.clientY);
    const changed = moveSectionWithHistory(thumbDragSourceIdx, idx, position);
    if (changed) suppressThumbClickUntil = Date.now() + 250;
    thumbDragSourceIdx = null;
    clearThumbDropHints();
};
window.endThumbDrag = () => {
    thumbDragSourceIdx = null;
    clearThumbDropHints();
};
window.startThumbTouchDrag = (e, idx) => {
    if (e.touches?.length !== 1) return;
    const touch = e.touches[0];
    thumbDragSourceIdx = idx;
    clearThumbDeleteDropzone();
    clearThumbDropHints();
    thumbTouchState = {
        sourceIndex: idx,
        mode: null,
        targetIndex: null,
        insertIndex: null,
        position: 'after',
        startX: touch.clientX,
        startY: touch.clientY,
        active: false,
        lastX: touch.clientX,
        lastY: touch.clientY
    };
    bindTouchDragListeners();
};
function deleteActiveFlowGroup(activeBlock) {
    if (activeBlock?.kind !== 'flow' || !isFlowSourceSelected(activeBlock.id)) return false;
    if (!window.confirm(t('confirm_delete_flow'))) return false;

    const removedIndex = state.activeBlockIdx;
    const nextBlocks = applyFlowAuthoringOperation(state.blocks || [], {
        type: 'removeGroup',
        groupId: activeBlock.id,
    });
    const nextBlockIndex = nextBlocks.length
        ? Math.max(0, Math.min(removedIndex, nextBlocks.length - 1))
        : 0;
    const nextBlock = nextBlocks[nextBlockIndex] || null;
    const nextPageIndex = nextBlock
        ? Math.max(0, getPageIndexFromBlockIndex(nextBlocks, nextBlockIndex))
        : 0;

    endHistoryGroup();
    pushState();
    resetFlowRuntimeAfterGroupRemoval(activeBlock.id);
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'blocks', value: nextBlocks } });
    dispatch({ type: actionTypes.SET_ACTIVE_BLOCK_INDEX, payload: nextBlockIndex });
    dispatch({ type: actionTypes.SET_ACTIVE_INDEX, payload: nextPageIndex });
    dispatch({ type: actionTypes.SET_ACTIVE_BUBBLE_INDEX, payload: null });
    if (nextBlock?.kind === 'flow') selectFlowSource(nextBlock.id);
    refresh();
    triggerAutoSave();
    return true;
}

window.deleteActive = () => {
    const activeBlock = state.blocks?.[state.activeBlockIdx];
    if (activeBlock?.kind === 'flow') {
        deleteActiveFlowGroup(activeBlock);
        return;
    }
    if (!canDeleteActive()) return;
    endHistoryGroup();
    pushState();
    const changed = deleteActive(refresh);
    if (changed) {
        if (state.version === 6) invalidateFlowRuntimePages({ preserveSelection: true });
        triggerAutoSave();
    }
};
window.update = update;
window.updateActiveText = updateActiveText;
window.updateBubbleShape = updateBubbleShape;
window.changeBubbleShapeFromMenu = (idx, shapeName) => {
    const s = getEditableActiveFixedSection();
    if (s?.bubbles?.[idx]) {
        pushState();
        s.bubbles[idx].shape = shapeName;
        refresh();
        triggerAutoSave();
        const menu = document.getElementById('context-menu');
        if (menu) menu.style.display = 'none';
    }
};
window.updateTitle = (v) => {
    const lang = state.activeLang || state.defaultLang || 'ja';
    const defaultLang = state.defaultLang || lang;
    const nextMeta = {
        ...(state.meta || {}),
        [lang]: {
            ...(state.meta?.[lang] || {}),
            title: v || ''
        }
    };
    const representativeTitle = nextMeta?.[defaultLang]?.title
        || (lang === defaultLang ? '' : (state.title || ''));
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'meta', value: nextMeta } });
    dispatch({ type: actionTypes.SET_TITLE, payload: representativeTitle });
    const headerGuideTitle = document.getElementById('header-guide-title');
    if (headerGuideTitle) headerGuideTitle.textContent = v || 'タイトル未設定';
    triggerAutoSave();
};
window.setThumbColumns = (cols) => {
    setCurrentDeviceThumbColumns(cols);
    refresh();
    triggerAutoSave();
};
window.setThumbSize = (sizeKey) => {
    const cols = MOBILE_THUMB_SIZE_MAP[sizeKey] || 2;
    setCurrentDeviceThumbColumns(cols);
    refresh();
    triggerAutoSave();
};
window.uploadToStorage = (input) => {
    if (!canEditActiveFixedPage()) {
        if (input) input.value = '';
        return;
    }
    uploadToStorage(input, () => { refresh(); updateHistoryButtons(); });
};

window.performUndo = performProjectUndo;
window.performRedo = performProjectRedo;

// FAB用
window.addBubbleFab = () => {
    if (!canEditActiveFixedPage()) return;
    objectToolbar.addText();
};

// バブル移動ハンドル用
window.onHandleDown = (e, i) => {
    if (!canEditActiveFixedPage()) return;
    startDrag(e, i, refresh);
};

// しっぽ移動ハンドル用
window.onTailHandleDown = (e, i) => {
    if (!canEditActiveFixedPage()) return;
    startTailDrag(e, i, refresh);
};

// ウニ・スパイク長ハンドル用
window.onSpikeHandleDown = (e, i) => {
    if (!canEditActiveFixedPage()) return;
    startSpikeDrag(e, i, refresh);
};

// ズーム・パン機能
let canvasScale = 1;
let canvasTranslate = { x: 0, y: 0 };

const CANVAS_ZOOM_PRESETS = [25, 33, 50, 67, 75, 90, 100, 110, 125, 150, 175, 200, 300, 400];

function syncCanvasZoomUI() {
    const select = document.getElementById('canvas-zoom-select');
    const percent = Math.round(canvasScale * 100);
    if (select) {
        const custom = select.querySelector('option[value="custom"]');
        if (CANVAS_ZOOM_PRESETS.includes(percent)) {
            if (custom) custom.hidden = true;
            select.value = String(percent);
        } else if (custom) {
            custom.hidden = false;
            custom.textContent = `${percent}%`;
            select.value = 'custom';
        }
    }

    const mobileRange = document.getElementById('mobile-canvas-zoom-range');
    if (mobileRange) {
        mobileRange.value = String(Math.min(Math.max(percent, 25), 300));
    }
    const mobileValue = document.getElementById('mobile-canvas-zoom-value');
    if (mobileValue) {
        mobileValue.textContent = `${percent}%`;
    }
}

window.setCanvasZoomPercent = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return;
    canvasScale = Math.min(Math.max(num / 100, 0.1), 5);
    updateCanvasTransform();
};

window.fitCanvasView = () => {
    canvasTranslate = { x: 0, y: 0 };
    if (_flowCanvasView && !_flowCanvasView.viewport.hidden) {
        _flowCanvasView.resize();
        _flowCompare?.resize();
        canvasScale = _flowCanvasView.getScale();
        syncCanvasZoomUI();
        return;
    }

    const container = document.getElementById('canvas-view');
    if (container) {
        const cw = container.clientWidth;
        const ch = container.clientHeight;
        const activeIdx = state.activeIdx ?? 0;
        const isSpreadPair = !!state.uiPrefs?.spreadView && getSpreadAdjacentPageIndex(activeIdx) >= 0;
        const isLanguageCompare = !!state.uiPrefs?.languageCompareView && !!getActiveCompareLang();
        const targetW = (isSpreadPair || isLanguageCompare) ? CANONICAL_PAGE_WIDTH * 2 : CANONICAL_PAGE_WIDTH;
        const targetH = CANONICAL_PAGE_HEIGHT;

        let s = Math.min(cw / targetW, ch / targetH) * 0.9;
        if (s > 1.2) s = 1.0;
        canvasScale = s;
    } else {
        canvasScale = 1;
    }

    updateCanvasTransform();
};

function updateCanvasTransform() {
    if (_flowCanvasView && !_flowCanvasView.viewport.hidden) {
        _flowCanvasView.resize({ scale: canvasScale });
        syncCanvasZoomUI();
        return;
    }
    // #canvas-stage を transform する（旧: #canvas-transform-layer）
    const stage = document.getElementById('canvas-stage');
    if (stage) {
        stage.style.transform = `translate(-50%, -50%) translate(${canvasTranslate.x}px, ${canvasTranslate.y}px) scale(${canvasScale})`;
    }
    syncCanvasZoomUI();
}

// キャンバスリセット（中央寄せ・初期サイズ）
window.resetCanvasView = () => {
    canvasTranslate = { x: 0, y: 0 };
    updateCanvasTransform();
};

function initCanvasZoom() {
    const view = document.getElementById('canvas-view');
    if (!view) return;

    // 初期化時にリセット（flex レイアウト確定後に実行）
    requestAnimationFrame(() => fitCanvasView());

    // #canvas-view のサイズ変化（ページストリップ開閉・パネル開閉・ウィンドウリサイズ等）
    // に対して自動的にキャンバススケールを再計算する
    if (typeof ResizeObserver !== 'undefined') {
        let _fitRaf = null;
        const ro = new ResizeObserver(() => {
            if (_fitRaf) cancelAnimationFrame(_fitRaf);
            _fitRaf = requestAnimationFrame(() => { fitCanvasView(); _fitRaf = null; });
        });
        ro.observe(view);
    }

    // Pan handling
    let isPanning = false;
    let startPan = { x: 0, y: 0 };
    let startTranslate = { x: 0, y: 0 };

    const onPanMove = (e) => {
        const dx = e.clientX - startPan.x;
        const dy = e.clientY - startPan.y;
        canvasTranslate.x = startTranslate.x + dx;
        canvasTranslate.y = startTranslate.y + dy;
        updateCanvasTransform();
    };

    const onPanEnd = () => {
        isPanning = false;
        view.style.cursor = 'default';
        window.removeEventListener('mousemove', onPanMove);
        window.removeEventListener('mouseup', onPanEnd);
    };

    view.addEventListener('mousedown', (e) => {
        // 画像調整中はCanvas全体のパンを無効化
        if (isImageAdjusting) return;

        // バブルやテキストレイヤー以外ならPan開始
        if (e.target.id === 'canvas-view'
            || e.target.id === 'content-render'
            || e.target.id === 'main-richtext-area'
            || e.target.classList.contains('text-layer')) {
            isPanning = true;
            startPan = { x: e.clientX, y: e.clientY };
            startTranslate = { ...canvasTranslate };
            view.style.cursor = 'grabbing';
            window.addEventListener('mousemove', onPanMove);
            window.addEventListener('mouseup', onPanEnd);
        }
    });

    // Touch Pan & Pinch (Simplified)
    // Hammer.js or similar recommended for robust pinch, but implementing basic logic here
    // For now, support single touch pan (if not on bubble)
    view.addEventListener('touchstart', (e) => {
        // 画像調整中はCanvasパン無効
        if (isImageAdjusting) return;

        if (e.touches.length === 1 && (
            e.target.id === 'canvas-view'
            || e.target.id === 'main-richtext-area'
            || e.target.classList.contains('text-layer')
        )) {
            isPanning = true;
            startPan = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            startTranslate = { ...canvasTranslate };
        }
    });

    view.addEventListener('touchmove', (e) => {
        if (isPanning && e.touches.length === 1) {
            const dx = e.touches[0].clientX - startPan.x;
            const dy = e.touches[0].clientY - startPan.y;
            canvasTranslate.x = startTranslate.x + dx;
            canvasTranslate.y = startTranslate.y + dy;
            updateCanvasTransform();
        }
    }, { passive: false });

    view.addEventListener('touchend', () => {
        isPanning = false;
    });

    // Wheel Zoom
    view.addEventListener('wheel', (e) => {
        if (e.target.closest?.('.flow-canvas-viewport, #flow-authoring-surface, #flow-canvas-translation-panel')) return;
        if (isImageAdjusting) return; // 画像調整中はCanvasズーム無効

        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        canvasScale *= delta;
        canvasScale = Math.min(Math.max(0.1, canvasScale), 5); // Limit scale
        updateCanvasTransform();
    }, { passive: false });
}

// プロジェクト名インライン編集
window.onProjectTitleInput = () => {
    const el = document.getElementById('project-title');
    if (el) {
        const name = (el.textContent || '').trim();
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'projectName', value: name === '新規プロジェクト' ? '' : name } });
    }
};
window.onProjectTitleKeydown = (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        e.target.blur();
    }
};
window.onProjectTitleBlur = () => {
    const el = document.getElementById('project-title');
    if (el) {
        const name = (el.textContent || '').trim();
        state.projectName = name === '新規プロジェクト' ? '' : name;
        triggerAutoSave();
    }
};
window.restoreCloudManuscript = async () => {
    if (!confirm(t('authoring_restore_confirm'))) return;
    try {
        await restorePreviousCloudAuthoring(() => {
            resetFlowRuntimeForProjectChange({keepSession:true}); clearHistory(); refresh(); renderLangSettings();
        });
        alert(t('authoring_restore_done'));
    } catch (error) { alert(`${t('authoring_restore_failed')}\n${error?.code || error?.message}`); }
};

window.saveProject = async () => {
    assertSharedStudioEdit();
    if(isLocalDraft())return saveDspFile();
    await persistProject();
    refresh();
};

window.importDSP = async (event, {external = false, handle = null} = {}) => {
    assertPersonalStudioOperation();
    const file = event.target.files[0];
    if (!file) return;

    if (typeof closeMobileSheet === 'function') {
        closeMobileSheet();
    }

    // Show loading? Optional since it might be fast, but let's just do it
    const originalCursor = document.body.style.cursor;
    document.body.style.cursor = 'wait';

    try {
        if(external)assertExternalDspOpenReady();
        await (external ? flushBeforeSafeResume() : flushPendingSave());
        const epoch=getProjectSessionEpoch();
        const before=external ? JSON.stringify(state) : '';
        const fingerprint=handle ? await fingerprintDspFile(file) : null;
        const loadedState = detachLocalProject(hydrateProjectFromPersistence(await parseAndLoadDSP(file)),createId('work'));
        if(external){assertExternalDspOpenReady();if(epoch!==getProjectSessionEpoch()||before!==JSON.stringify(state))throw Error('busy');}

        resetFlowRuntimeForProjectChange();
        clearHistory();
        dispatch({
            type: actionTypes.LOAD_PROJECT,
            payload: loadedState
        });
        if(handle&&fingerprint)dspFileSession.attach(handle,fingerprint);
        localDraftStatus.confirm(localDraftStatus.checkpoint());
        await flushSave(); // Keep the current local manuscript as the startup recovery copy too.

        // Update title UI
        const pt = document.getElementById('project-title');
        if (pt) pt.textContent = state.projectName || state.title || 'Untitled';
        const inputTitle = document.getElementById('prop-title');
        if (inputTitle) inputTitle.value = state.title || '';

        refresh();
        window.switchRoom('editor');
    } catch (e) {
        if(external)throw e;
        console.error("DSP Import failed", e);
        alert("読み込みエラー: " + e.message);
    } finally {
        document.body.style.cursor = originalCursor;
        event.target.value = ''; // Reset input
    }
};

let dspSaveBusy=false;
async function saveDspFile({saveAs=false,download=false}={}) {
    assertPersonalStudioOperation();
    if(dspSaveBusy||readStudioAIState().busy)return;
    dspSaveBusy=true;
    const buttons=[...document.querySelectorAll('[data-authoring-save],button[onclick="exportDSP()"],button[onclick="downloadDSP()"]')];
    const disabled=buttons.map(b=>b.disabled);buttons.forEach(b=>{b.disabled=true;b.setAttribute('aria-busy','true');});
    const epoch=getProjectSessionEpoch(),local=isLocalDraft();
    try {
        if(!download&&(typeof window.showSaveFilePicker==='function'||(!saveAs&&dspFileSession.read().name))){
            const result=await dspFileSession.save({saveAs,
                chooseHandle:()=>window.showSaveFilePicker({suggestedName:dspFilename(dspFileSession.read().name||state.projectName||state.title),types:DSP_FILE_TYPES,excludeAcceptAllOption:true}),
                buildBlob:async()=>{const token=localDraftStatus.checkpoint();const result=await buildDSP({returnBlob:true});return {...result,token};}
            });
            if(result.status==='saved'&&local&&isLocalDraft()&&epoch===getProjectSessionEpoch())localDraftStatus.confirm(result.token);
        } else {
            const token=localDraftStatus.checkpoint();
            const result=await buildDSP({chooseFilename:name=>chooseDspFilename(name,getUILang()==='en')});
            if(local&&result?.status==='download-started')confirmDspDownload({filename:result.filename,en:getUILang()==='en',onConfirm:()=>{if(!isLocalDraft()||!localDraftStatus.confirm(token))return false;dspFileSession.clear();return true;}});
        }
    } catch(error) {
        showDspSaveError({code:error.code||error.name,en:getUILang()==='en',
            onSaveAs:()=>saveDspFile({saveAs:true}),onDownload:()=>saveDspFile({download:true})});
    } finally {
        dspSaveBusy=false;buttons.forEach((b,i)=>{b.disabled=disabled[i];b.removeAttribute('aria-busy');});
    }
}
window.exportDSP=()=>saveDspFile({saveAs:true});
window.downloadDSP=()=>saveDspFile({download:true});

let _dsfExportInProgress = false;

window.exportDSF = async () => {
    assertPersonalStudioOperation();
    if (_dsfExportInProgress) return;
    _dsfExportInProgress = true;
    const btnDataList = document.querySelectorAll('button[onclick="exportDSF()"]');
    const buttonSnapshots = Array.from(btnDataList, (btn) => ({
        btn,
        innerHTML: btn.innerHTML,
        disabled: btn.disabled,
    }));
    buttonSnapshots.forEach(({ btn }) => {
        btn.textContent = '⏳ ZIP確認中...';
        btn.disabled = true;
        btn.setAttribute('aria-busy', 'true');
    });
    try {
        await buildDSF({chooseFilename:name=>chooseDspFilename(name,getUILang()==='en','dsf')});
    } catch (e) {
        console.error("Export DSF failed:", e);
        if (e?.code === 'PRESS_RENDER_CANCELLED') {
            alert(t('press_render_cancelled'));
        } else if (e?.code === 'FLOW_PORTABLE_DOWNLOAD_NOT_READY'
            || e?.code === 'FLOW_PORTABLE_DOWNLOAD_STALE'
            || e?.code === 'FLOW_PORTABLE_DOWNLOAD_PACKAGE_UNVERIFIED'
            || e?.code === 'FLOW_PORTABLE_DOWNLOAD_BLOB_INVALID') {
            alert('Flow portable .dsfの検証結果が現在の原稿と一致しません。PressのZIP検証完了後にもう一度実行してください。');
        } else {
            alert("エクスポート中にエラーが発生しました。\n" + e.message);
        }
    } finally {
        _dsfExportInProgress = false;
        buttonSnapshots.forEach(({ btn, innerHTML, disabled }) => {
            btn.innerHTML = innerHTML;
            btn.disabled = disabled;
            btn.removeAttribute('aria-busy');
        });
    }
};

window.shareProject = async () => {
    assertPersonalStudioOperation();
    if (!state.projectId) {
        alert("プロジェクトが保存されていません。");
        return;
    }
    if (!state.workId) {
        alert("作品IDがまだありません。保存してからもう一度共有してください。");
        return;
    }
    if (!state.uid) {
        alert("ログインしてください。");
        return;
    }

    await flushSave();

    const visibility = state.visibility || 'private';
    if (visibility === 'private') {
        alert('現在の状態は「非公開」です。\nこのままでは作品を共有できません。上部メニューから「限定公開」か「公開」に変更してください。');
        return;
    }
    let url = '';
    try {
        url = buildPublicViewerUrl(window.location.origin, state.workId, state.releaseId || '');
    } catch (error) {
        console.warn('[Studio] Viewer URL could not be created:', error?.code || error?.name || 'unknown');
        alert('ビューワーURLを作成できませんでした。作品を保存し直してから再試行してください。');
        return;
    }

    try {
        await navigator.clipboard.writeText(url);
        alert(`スマホ用URLをコピーしました！\n\n${url}`);
    } catch (e) {
        prompt("ビューワー用URL (コピーしてください):", url);
    }
};

window.updateVisibility = async (val) => {
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'visibility', value: val } });
    await flushSave();
    const map = {
        'private': '非公開（自分だけの状態）',
        'unlisted': '限定公開（URLを知っている人のみ閲覧可能）',
        'public': '公開（ポータルに掲載され誰でも閲覧可能）'
    };
    console.log(`[DSF] Visibility updated to ${val}`);
};

// 吹き出し直接編集（多言語対応）
let directEditPushTimer = null;
window.onBubbleTextInput = (e, i) => {
    const text = (e.target.innerText || '').replace(/\n+$/, '');
    const s = getEditableActiveFixedSection('image');
    if (s?.bubbles && s.bubbles[i]) {
        if (!directEditPushTimer) {
            pushState();
        } else {
            clearTimeout(directEditPushTimer);
        }
        directEditPushTimer = setTimeout(() => { directEditPushTimer = null; }, 500);

        setBubbleText(s.bubbles[i], text);
        document.getElementById('prop-text').value = text;
        triggerAutoSave();
    }
};
window.onBubbleTextBlur = () => {
    setTimeout(() => refresh(), 10);
};

// 言語切替
window.switchLang = (code) => {
    if(!state.languages.includes(code)||code===state.activeLang)return;
    if(!canSwitchEditorLanguage()){ const note=document.getElementById('ribbon-status');if(note)note.textContent=t('language_busy');return; }
    clearFlowDirectEditRuntime();endHistoryGroup();
    state.activeLang = code;
    refresh();refreshEditorLanguagePresentation();
};

// lang-add-select を現在の追加済み言語を除いて生成する
function renderLangAddSelect() {
    const select = document.getElementById('lang-add-select');
    if (!select) return;
    const draft = _getPsSettingsSource();
    const added = new Set(draft.languages || ['ja']);
    const allLangs = getAllLangs();
    const options = [];
    allLangs.forEach(({ code, label, directions }) => {
        if (added.has(code)) return; // 既追加はスキップ
        directions.forEach(({ value: dir, label: dirLabel }) => {
            const suffix = dirLabel ? ` — ${dirLabel}` : '';
            const dirStr = dir.toUpperCase();
            options.push(`<option value="${code}:${dir}">${label}${suffix} (${dirStr})</option>`);
        });
    });
    select.innerHTML = options.length
        ? options.join('')
        : '<option value="">— 追加できる言語がありません —</option>';
}

// 言語追加（セレクト値は "code:dir" 形式）
window.addLang = () => {
    const select = document.getElementById('lang-add-select');
    if (!select || !select.value || select.value.startsWith('—')) return;
    const [code, dir] = select.value.split(':');
    _capturePsInputsToDraft();
    const draft = _ensurePsDraft();
    if (!code || draft.languages.includes(code)) return;
    draft.languages.push(code);
    if (!draft.languageConfigs) draft.languageConfigs = {};
    draft.languageConfigs[code] = { pageDirection: dir || 'ltr' };
    renderLangSettings();
    renderLangAddSelect();
    renderProjectSettingsTable();
};

// 言語削除
window.removeLang = (code) => {
    _capturePsInputsToDraft();
    const draft = _ensurePsDraft();
    if (draft.languages.length <= 1) return;
    const sourceFlowGroups = getFlowSourceLanguageGroupIds(state.blocks || [], code);
    if (sourceFlowGroups.length) {
        alert(`「${getLangProps(code).label}」は${sourceFlowGroups.length}件のFlow原稿の原稿言語です。先に原稿言語を移行する必要があります。`);
        return;
    }
    if (!confirm(t('confirm_remove_lang', { lang: getLangProps(code).label }))) return;
    draft.languages = draft.languages.filter(c => c !== code);
    if (draft.defaultLang === code) draft.defaultLang = draft.languages[0] || 'ja';
    if (draft.activeLang === code) draft.activeLang = draft.defaultLang || draft.languages[0];
    renderLangSettings();
    renderLangAddSelect();
    renderProjectSettingsTable();
};

// プロジェクトモーダル
window.openProjectModal = () => openProjectModal(async (pid) => {
    if (!await onLoadProject(pid)) return false;
    await cacheLocalRecentProject(JSON.parse(JSON.stringify(state)), window.localImageMap).catch((e) => {
        console.warn('[Home] Failed to cache cloud project locally:', e);
    });
    window.switchRoom('editor');
    return true;
});
window.closeProjectModal = closeProjectModal;

// Works Room
window.openWorksRoom = openWorksRoom;
window.closeWorksRoom = closeWorksRoom;
window.loadWorksRoom  = () => openWorksRoom(true); // true = ルームモード
window.loadAndOpenProject = async (pid) => {
    closeWorksRoom();
    if (!await onLoadProject(pid)) return;
    window.switchRoom('editor');
};
window.copyViewerUrl = async (pid) => {
    const row = document.querySelector(`.works-row[data-pid="${CSS.escape(pid)}"]`);
    const projectWorkId = row?.dataset.workId || pid;
    const releaseId = row?.dataset.releaseId || '';
    let url = '';
    try {
        url = buildPublicViewerUrl(window.location.origin, projectWorkId, releaseId);
    } catch (error) {
        console.warn('[Works] Viewer URL could not be created:', error?.code || error?.name || 'unknown');
        alert(t('works_copy_url_failed'));
        return;
    }
    try {
        await navigator.clipboard.writeText(url);
        alert('URLをコピーしました:\n' + url);
    } catch {
        prompt('ビューワーURL:', url);
    }
};
window.openDraftViewer = (pid) => {
    const url = buildOwnerDraftViewerUrl(window.location.origin, pid);
    window.open(url, '_blank', 'noopener,noreferrer');
};
window.loadAndRepress = async (pid) => {
    closeWorksRoom();
    if (!await onLoadProject(pid)) return;
    window.switchRoom('press');
};

// 新規プロジェクト
window.newProject = async () => {
    assertPersonalStudioOperation();
    if (state.projectId && !confirm('現在のプロジェクトを閉じて新しいプロジェクトを作成しますか？')) return false;
    const choice=await chooseSourceLanguage({initial:state.defaultLang,configs:state.languageConfigs,project:true});
    if(!choice)return false;
    await flushPendingSave();
    return initializeNewProject(choice);
};

function initializeNewProject(choice, draft = null, {autosave=true} = {}) {
    assertPersonalStudioOperation();
    resetFlowRuntimeForProjectChange();
    state.projectAssets = [];
    state.localProjectId = null;
    clearCloudMetadata(state);
    state.dsfPages = [];
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'projectId', value: null } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'version', value: draft ? PROJECT_SCHEMA_VERSION : 5 } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'workId', value: createId('work') } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'releaseId', value: null } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'projectName', value: draft?.projectName || '' } });
    dispatch({ type: actionTypes.SET_TITLE, payload: draft?.title || '' });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'publicationThumbnailUrl', value: '' } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'labelName', value: '' } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'rating', value: 'all' } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'license', value: 'all-rights-reserved' } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'textPaperPreset', value: 'white' } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'meta', value: draft ? { [choice.languageKey]: { title: draft.title } } : {} } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'languages', value: [choice.languageKey] } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'defaultLang', value: choice.languageKey } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'languageConfigs', value: { [choice.languageKey]: { pageDirection: choice.pageDirection } } } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'bookMode', value: 'simple' } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'book', value: { mode: 'simple', covers: { c1: { pageIndex: 0 }, c4: { pageIndex: 0 } } } } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'uiPrefs', value: { desktop: { thumbColumns: 2 }, mobile: { thumbColumns: 2 } } } });
    applyThumbColumnsFromPrefs();
    dispatch({ type: actionTypes.SET_ACTIVE_LANGUAGE, payload: choice.languageKey });
    const initialSections = draft ? [] : [{
        type: 'image',
        background: '',
        backgrounds: {},
        bubbles: []
    }];
    const initialBlocks = draft?.blocks || migrateSectionsToBlocks(initialSections, [choice.languageKey]);
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'sections', value: initialSections } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'blocks', value: initialBlocks } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'pages', value: blocksToPages(initialBlocks) } });
    dispatch({ type: actionTypes.SET_ACTIVE_INDEX, payload: 0 });
    dispatch({ type: actionTypes.SET_ACTIVE_BLOCK_INDEX, payload: Math.max(0, getBlockIndexFromPageIndex(initialBlocks, 0)) });
    dispatch({ type: actionTypes.SET_ACTIVE_BUBBLE_INDEX, payload: null });
    clearHistory();
    if (draft) selectFlowSource(initialBlocks[0].id);
    if(!autosave)state.workId=null;
    refresh();
    renderLangSettings();
    closeProjectModal();
    if(autosave)triggerAutoSave();
    return true;
};

function setRibbonTab(tabName) {
    document.querySelectorAll('.ribbon-tab').forEach((tab) => {
        const active = tab.dataset.ribbonTab === tabName;
        tab.classList.toggle('active', active); tab.setAttribute('role','tab');
        tab.setAttribute('aria-selected',String(active)); tab.tabIndex = active ? 0 : -1;
    });
    document.querySelectorAll('.ribbon-panel').forEach((panel) => {
        panel.classList.toggle('active', panel.dataset.ribbonPanel === tabName);
    });
}

function syncDesktopToggleButtons() {
    const drawerOpen = document.body.classList.contains('drawer-open');
    const rightCollapsed = document.body.classList.contains('right-collapsed');
    const leftBtn = document.getElementById('btn-toggle-sidebar');
    const rightBtn = document.getElementById('btn-toggle-panel');
    if (leftBtn && !leftBtn.classList.contains('studio-ribbon-icon')) leftBtn.textContent = drawerOpen ? '🖼 Assetsを閉じる' : '🖼 Assets';
    if (rightBtn && !rightBtn.classList.contains('studio-ribbon-icon')) rightBtn.textContent = rightCollapsed ? '⚙ Editを開く' : '⚙ Edit';
    syncRibbonDrawerButtons(drawerOpen ? activeDrawer : null);
    const handle = document.getElementById('edit-drawer-handle');
    if (handle) {
        const labelKey = rightCollapsed ? 'edit_properties_open' : 'edit_properties_close';
        handle.setAttribute('aria-expanded', String(!rightCollapsed));
        handle.dataset.i18nTitle = labelKey;
        handle.dataset.i18nAria = labelKey;
        handle.title = t(labelKey);
        handle.setAttribute('aria-label', t(labelKey));
        handle.querySelector('.edit-drawer-chevron').textContent = rightCollapsed ? 'chevron_left' : 'chevron_right';
    }
    const panel = document.getElementById('panel-right');
    if (panel) panel.inert = window.innerWidth >= 1024 && rightCollapsed;
}

window.toggleDesktopPanel = (side) => {
    if (side === 'right') {
        const panel = document.getElementById('panel-right');
        if (!document.body.classList.contains('right-collapsed') && panel?.contains(document.activeElement)) {
            document.getElementById('edit-drawer-handle')?.focus({ preventScroll: true });
        }
        document.body.classList.toggle('right-collapsed');
    }
    syncDesktopToggleButtons();
};

window.togglePagesPanel = () => {
    if (window.innerWidth < 1024) {
        closeMobileSheet();
        return;
    }
    window.toggleDrawer('pages');
};

window.toggleEditPanel = () => {
    if (window.innerWidth < 1024) {
        closeMobileSheet();
        return;
    }
    toggleDesktopPanel('right');
};

let activeDrawer = null;

window.toggleDrawer = (drawerName) => {
    if (window.innerWidth < 1024) return;
    if (activeDrawer === drawerName && document.body.classList.contains('drawer-open')) {
        window.closeDrawer();
        return;
    }
    activeDrawer = drawerName;
    document.body.classList.add('drawer-open');
    document.querySelectorAll('.sidebar-assets, .sidebar-pages, .sidebar-toc').forEach((el) => {
        el.style.display = 'none';
    });
    const target = document.querySelector(`.sidebar-${drawerName}`);
    if (target) target.style.display = 'flex';
    document.querySelectorAll('.icon-bar-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.drawer === drawerName);
    });
    syncDesktopToggleButtons();
};

window.closeDrawer = () => {
    activeDrawer = null;
    document.body.classList.remove('drawer-open');
    document.querySelectorAll('.icon-bar-btn').forEach((btn) => btn.classList.remove('active'));
    syncDesktopToggleButtons();
};

// ===== Project Settings Modal =====

const PS_META_FIELDS = [
    { key: 'title',       get label() { return t('field_title'); },       type: 'input'    },
    { key: 'author',      get label() { return t('field_author'); },      type: 'input'    },
    { key: 'description', get label() { return t('field_description'); }, type: 'textarea' },
    { key: 'linerNotes',  get label() { return t('field_liner_notes'); }, type: 'textarea' },
    { key: 'copyright',   get label() { return t('field_copyright'); },   type: 'input'    },
];

// ── PS テーブル列ドラッグ ──
let _psDragLang = null;
let _psDraft = null;
let _psPublicationThumbnailFile = null;
let _psPublicationThumbnailPreviewUrl = '';
let _psPublicationThumbnailSaving = false;

function _getProjectBookSettingsPageCount() {
    return getEditorCanvasProjection()?.totalPageCount ?? (state.sections || []).length;
}

function _cloneProjectSettingsDraft() {
    const languages = [...(state.languages && state.languages.length ? state.languages : ['ja'])];
    const defaultLang = languages.includes(state.defaultLang) ? state.defaultLang : languages[0];
    const activeLang = languages.includes(state.activeLang) ? state.activeLang : defaultLang;
    const pageCount = _getProjectBookSettingsPageCount();
    const bookMode = state.bookMode || state.book?.mode || 'simple';
    const book = normalizeBookSettings(state.book || { mode: bookMode }, bookMode, pageCount);
    return {
        projectName: state.projectName || '',
        publicationThumbnailUrl: state.publicationThumbnailUrl || '',
        labelName: state.labelName || '',
        rating: state.rating || 'all',
        license: state.license || 'all-rights-reserved',
        textPaperPreset: _getProjectTextPaperPresetKey(state),
        bookMode: book.mode,
        book,
        languages,
        defaultLang,
        activeLang,
        languageConfigs: state.languageConfigs ? JSON.parse(JSON.stringify(state.languageConfigs)) : {},
        meta: state.meta ? JSON.parse(JSON.stringify(state.meta)) : {}
    };
}

function _ensurePsDraft() {
    if (!_psDraft) _psDraft = _cloneProjectSettingsDraft();
    return _psDraft;
}

function _getPsSettingsSource() {
    return _psDraft || {
        languages: state.languages || ['ja'],
        defaultLang: state.defaultLang || 'ja',
        activeLang: state.activeLang || state.defaultLang || 'ja',
        publicationThumbnailUrl: state.publicationThumbnailUrl || '',
        labelName: state.labelName || '',
        rating: state.rating || 'all',
        license: state.license || 'all-rights-reserved',
        textPaperPreset: _getProjectTextPaperPresetKey(state),
        bookMode: state.bookMode || state.book?.mode || 'simple',
        book: normalizeBookSettings(state.book || {}, state.bookMode || state.book?.mode || 'simple', _getProjectBookSettingsPageCount()),
        languageConfigs: state.languageConfigs || {},
        meta: state.meta || {}
    };
}

function _capturePsInputsToDraft() {
    const draft = _ensurePsDraft();

    const nameEl = document.getElementById('ps-project-name');
    if (nameEl) draft.projectName = nameEl.value.trim();

    const labelEl = document.getElementById('ps-label-name');
    if (labelEl) draft.labelName = labelEl.value.trim();

    ['rating', 'license'].forEach(key => {
        const el = document.getElementById(`ps-${key}`);
        if (el) draft[key] = el.value;
    });

    const bookModeEl = document.getElementById('ps-book-mode');
    if (bookModeEl) {
        const requestedMode = bookModeEl.value === 'none' ? 'none' : 'cover';
        const normalizedBook = normalizeBookSettings({ ...draft.book, mode: requestedMode }, requestedMode, _getProjectBookSettingsPageCount());
        draft.bookMode = normalizedBook.mode;
        draft.book = normalizedBook;
    }

    document.querySelectorAll('#ps-meta-table .ps-meta-input').forEach(input => {
        const lang = input.dataset.lang;
        const key  = input.dataset.key;
        if (lang && key) {
            if (!draft.meta[lang]) draft.meta[lang] = {};
            draft.meta[lang][key] = input.value;
        }
    });

    document.querySelectorAll('#ps-meta-table .ps-font-select').forEach(sel => {
        const lang = sel.dataset.lang;
        if (lang) {
            if (!draft.languageConfigs[lang]) draft.languageConfigs[lang] = {};
            draft.languageConfigs[lang].fontPreset = sel.value;
        }
    });

    return draft;
}

window.psColDragStart = (e, lang) => {
    _psDragLang = lang;
    e.dataTransfer.effectAllowed = 'move';
    e.currentTarget.classList.add('ps-col-dragging');
};

window.psColDragEnd = (e) => {
    e.currentTarget.classList.remove('ps-col-dragging');
};

window.psColDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    e.currentTarget.classList.add('ps-col-drag-over');
};

window.psColDragLeave = (e) => {
    e.currentTarget.classList.remove('ps-col-drag-over');
};

window.psColDrop = (e, targetLang) => {
    e.preventDefault();
    e.currentTarget.classList.remove('ps-col-drag-over');
    if (!_psDragLang || _psDragLang === targetLang) { _psDragLang = null; return; }

    const draft = _capturePsInputsToDraft();

    // Reorder languages
    const langs = [...draft.languages];
    const fromIdx = langs.indexOf(_psDragLang);
    const toIdx   = langs.indexOf(targetLang);
    if (fromIdx === -1 || toIdx === -1) { _psDragLang = null; return; }
    langs.splice(fromIdx, 1);
    langs.splice(toIdx, 0, _psDragLang);
    draft.languages = langs;
    _psDragLang = null;

    renderProjectSettingsTable();
    renderLangSettings();
};

function renderProjectSettingsTable() {
    const container = document.getElementById('ps-meta-table');
    if (!container) return;

    const draft = _getPsSettingsSource();
    const langs = draft.languages || ['ja'];
    const meta = draft.meta || {};
    const configs = draft.languageConfigs || {};
    const isMobile = window.innerWidth < 768 || document.body.dataset.device === 'mobile';

    if (isMobile) {
        const cards = langs.map((lang, idx) => {
            const props = getLangProps(lang);
            const dir = (configs?.[lang]?.pageDirection || 'ltr').toUpperCase();
            const code = lang.toUpperCase();
            const isDefault = lang === draft.defaultLang;
            const defaultBadge = isDefault
                ? `<span class="ps-default-badge">${t('ps_default_badge')}</span>`
                : '';
            const fields = PS_META_FIELDS.map(field => {
                const val = escapeStudioHtml(meta[lang]?.[field.key] || '');
                const ph = escapeStudioHtml(getLangProps(lang).placeholders?.[field.key] || '');
                const control = field.type === 'textarea'
                    ? `<textarea class="ps-meta-input" data-lang="${lang}" data-key="${field.key}" placeholder="${ph}">${val}</textarea>`
                    : `<input type="text" class="ps-meta-input" data-lang="${lang}" data-key="${field.key}" value="${val}" placeholder="${ph}">`;
                return `
                    <div class="ps-meta-mobile-field">
                        <label class="ps-meta-mobile-label">${field.label}</label>
                        ${control}
                    </div>
                `;
            }).join('');
            return `
                <section class="ps-meta-mobile-card">
                    <header class="ps-meta-mobile-head${isDefault ? ' ps-meta-header--default' : ''}">
                        <div class="ps-meta-mobile-head-main">
                            <div class="ps-meta-mobile-lang">${props.label}</div>
                            <div class="ps-meta-mobile-sub">${code} / ${dir}</div>
                        </div>
                        ${defaultBadge}
                    </header>
                    <div class="ps-meta-mobile-body">${fields}</div>
                </section>
            `;
        }).join('');
        container.innerHTML = `<div class="ps-meta-mobile-list">${cards}</div>`;
        return;
    }

    // grid-template-columns: label col (fixed) + one col per language (fixed 180px each → horizontal scroll)
    const colTemplate = `120px ${langs.map(() => '320px').join(' ')}`;

    let html = `<div class="ps-meta-grid" style="grid-template-columns:${colTemplate};">`;

    // Header row: empty label cell + draggable language headers
    html += `<div class="ps-meta-cell ps-meta-header ps-meta-corner"></div>`;
    langs.forEach((lang, idx) => {
        const props = getLangProps(lang);
        const dir  = (configs?.[lang]?.pageDirection || 'ltr').toUpperCase();
        const code = lang.toUpperCase();
        const isDefault = lang === draft.defaultLang;
        const defaultBadge = isDefault
            ? `<span class="ps-default-badge">${t('ps_default_badge')}</span>`
            : '';
        html += `<div class="ps-meta-cell ps-meta-header${isDefault ? ' ps-meta-header--default' : ''}"
            draggable="true"
            data-lang="${lang}"
            ondragstart="psColDragStart(event,'${lang}')"
            ondragend="psColDragEnd(event)"
            ondragover="psColDragOver(event)"
            ondragleave="psColDragLeave(event)"
            ondrop="psColDrop(event,'${lang}')">
            <span class="ps-meta-header-drag">⠿</span>
            ${props.label}
            <span class="ps-meta-header-sub">${code} / ${dir}</span>
            ${defaultBadge}
        </div>`;
    });

    // Data rows
    PS_META_FIELDS.forEach(field => {
        html += `<div class="ps-meta-cell ps-meta-row-label">${field.label}</div>`;
        langs.forEach(lang => {
            const val = escapeStudioHtml(meta[lang]?.[field.key] || '');
            const ph  = escapeStudioHtml(getLangProps(lang).placeholders?.[field.key] || '');
            if (field.type === 'textarea') {
                html += `<div class="ps-meta-cell"><textarea class="ps-meta-input" data-lang="${lang}" data-key="${field.key}" placeholder="${ph}">${val}</textarea></div>`;
            } else {
                html += `<div class="ps-meta-cell"><input type="text" class="ps-meta-input" data-lang="${lang}" data-key="${field.key}" value="${val}" placeholder="${ph}"></div>`;
            }
        });
    });

    // フォントプリセット行
    const fontOptions = getFontPresetOptions();
    html += `<div class="ps-meta-cell ps-meta-row-label">${t('field_font')}</div>`;
    langs.forEach(lang => {
        const current = configs?.[lang]?.fontPreset || 'gothic';
        const opts = fontOptions.map(o =>
            `<option value="${o.value}"${o.value === current ? ' selected' : ''}>${o.label}</option>`
        ).join('');
        html += `<div class="ps-meta-cell"><select class="ps-font-select" data-lang="${lang}">${opts}</select></div>`;
    });

    html += `</div>`;
    container.innerHTML = html;
}

function renderProjectBookSettings() {
    const container = document.getElementById('ps-book-settings');
    if (!container) return;
    const draft = _getPsSettingsSource();
    releaseBookSpineEditor(draft, container);
    const pageCount = _getProjectBookSettingsPageCount();
    if (!pageCount) {
        container.innerHTML = `<p class="press-book-empty">${escapeStudioHtml(t('press_book_no_pages'))}</p>`;
        return;
    }

    const settings = normalizeBookSettings(draft.book || {}, draft.bookMode || 'simple', pageCount);
    const coverRow = (key, labelKey) => {
        const pageIndex = settings.covers[key]?.pageIndex;
        if (pageIndex === undefined) return '';
        return `<div class="press-book-cover-fixed">
            <span>${escapeStudioHtml(t(labelKey))}</span>
            <strong>${escapeStudioHtml(t('press_cover_page', { page: pageIndex + 1 }))}</strong>
        </div>`;
    };

    container.innerHTML = `
        <div class="press-book-mode-row">
            <span>${escapeStudioHtml(t('press_book_layout'))}</span>
            <select id="ps-book-mode">
                <option value="none" ${settings.mode === 'none' ? 'selected' : ''}>${escapeStudioHtml(t('press_book_none'))}</option>
                <option value="cover" ${settings.mode !== 'none' ? 'selected' : ''}>${escapeStudioHtml(t('press_book_cover_auto'))}</option>
            </select>
        </div>
        <div class="press-book-fixed-hint">${escapeStudioHtml(t('press_book_fixed_hint'))}</div>
        <div class="press-book-covers-fixed">
            ${coverRow('c1', 'press_cover_c1')}
            ${coverRow('c2', 'press_cover_c2')}
            ${coverRow('c3', 'press_cover_c3')}
            ${coverRow('c4', 'press_cover_c4')}
        </div>
    `;

    if (settings.mode !== 'none') {
        const projectId = state.projectId, uid = state.uid;
        const isCurrent = () => _psDraft === draft && state.projectId === projectId && state.uid === uid;
        mountBookSpineEditor(container, draft, getUILang() === 'en', {
            isCurrent,
            loadPublisher: () => readSharedStudioAccess()
                ? Promise.resolve({name: draft.book?.spineDesign?.publisherName || '', icon: draft.book?.spineDesign?.publisherIcon || '', saved: true})
                : loadBookSpinePublisher({projectId, uid, request: requestPublishingSpaces, isCurrent}),
            readMeta: () => { _capturePsInputsToDraft(); return draft.meta?.[draft.activeLang] || draft.meta?.[draft.defaultLang] || {}; },
        });
    }
    const modeEl = container.querySelector('#ps-book-mode');
    if (modeEl) modeEl.addEventListener('change', () => window.updateProjectBookMode(modeEl.value));
}

window.updateProjectBookMode = (mode) => {
    _capturePsInputsToDraft();
    const draft = _ensurePsDraft();
    const requestedMode = mode === 'none' ? 'none' : 'cover';
    const normalizedBook = normalizeBookSettings({ ...draft.book, mode: requestedMode }, requestedMode, _getProjectBookSettingsPageCount());
    draft.bookMode = normalizedBook.mode;
    draft.book = normalizedBook;
    renderProjectBookSettings();
};

function renderProjectTextPaperSettings() {
    const draft = _getPsSettingsSource();
    const activeKey = _getProjectTextPaperPresetKey(draft);
    document.querySelectorAll('[data-project-text-paper-preset]').forEach((button) => {
        const isActive = button.dataset.projectTextPaperPreset === activeKey;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
}

window.updateProjectTextPaperPreset = (key) => {
    if (!TEXT_PAPER_PRESETS[key]) return;
    const draft = _ensurePsDraft();
    draft.textPaperPreset = key;
    renderProjectTextPaperSettings();
};

function _clearProjectThumbnailTemporaryPreview() {
    if (_psPublicationThumbnailPreviewUrl) URL.revokeObjectURL(_psPublicationThumbnailPreviewUrl);
    _psPublicationThumbnailPreviewUrl = '';
    _psPublicationThumbnailFile = null;
    const input = document.getElementById('ps-publication-thumbnail-input');
    if (input) input.value = '';
}

function renderProjectPublicationThumbnailSettings() {
    const draft = _getPsSettingsSource();
    const image = document.getElementById('ps-publication-thumbnail-image');
    const placeholder = document.getElementById('ps-publication-thumbnail-placeholder');
    const choose = document.getElementById('ps-publication-thumbnail-choose');
    const reset = document.getElementById('ps-publication-thumbnail-reset');
    const status = document.getElementById('ps-publication-thumbnail-status');
    const custom = Boolean(_psPublicationThumbnailFile || draft.publicationThumbnailUrl);
    const source = _psPublicationThumbnailPreviewUrl
        || draft.publicationThumbnailUrl
        || selectProjectAuthoringCoverThumbnail(state, { allowLocal: true });

    if (image) {
        if (source) {
            image.src = source;
            image.hidden = false;
        } else {
            image.removeAttribute('src');
            image.hidden = true;
        }
    }
    if (placeholder) placeholder.hidden = Boolean(source);
    if (reset) reset.disabled = !custom;
    if (status) {
        status.textContent = t(custom
            ? 'ps_publication_thumbnail_custom_status'
            : 'ps_publication_thumbnail_default_status');
    }
    const chooseLabel = choose?.querySelector('span:last-child');
    if (chooseLabel) {
        chooseLabel.textContent = t(custom
            ? 'ps_publication_thumbnail_change'
            : 'ps_publication_thumbnail_choose');
    }
}

function bindProjectPublicationThumbnailSettings() {
    const choose = document.getElementById('ps-publication-thumbnail-choose');
    const reset = document.getElementById('ps-publication-thumbnail-reset');
    const input = document.getElementById('ps-publication-thumbnail-input');
    if (choose && !choose.dataset.bound) {
        choose.dataset.bound = 'true';
        choose.addEventListener('click', () => input?.click());
    }
    if (reset && !reset.dataset.bound) {
        reset.dataset.bound = 'true';
        reset.addEventListener('click', () => {
            _clearProjectThumbnailTemporaryPreview();
            const draft = _ensurePsDraft();
            draft.publicationThumbnailUrl = '';
            if (input) input.value = '';
            renderProjectPublicationThumbnailSettings();
        });
    }
    if (input && !input.dataset.bound) {
        input.dataset.bound = 'true';
        input.addEventListener('change', () => {
            if (_psPublicationThumbnailSaving) return;
            const file = input.files?.[0];
            if (!file) return;
            if (!String(file.type || '').startsWith('image/')) {
                alert(t('ps_publication_thumbnail_invalid_file'));
                input.value = '';
                return;
            }
            _clearProjectThumbnailTemporaryPreview();
            _psPublicationThumbnailFile = file;
            _psPublicationThumbnailPreviewUrl = URL.createObjectURL(file);
            renderProjectPublicationThumbnailSettings();
        });
    }
}

let editorCopyDeleteRevision=0;
async function refreshEditorCopyDelete() {
    const button=document.getElementById('ps-browser-copy-delete'),status=document.getElementById('ps-browser-copy-status');
    if(!button||!status)return;
    const en=getUILang()==='en',revision=++editorCopyDeleteRevision,epoch=getProjectSessionEpoch(),id=localRecentId(state);
    document.getElementById('ps-browser-copy-heading').textContent=en?'Recovery copy in this browser':'このブラウザーの復元用コピー';
    document.getElementById('ps-browser-copy-note').textContent=en?'Delete this manuscript’s recovery copy. Cloud manuscripts and saved DSP files are unchanged.':'この原稿の復元用コピーを削除します。クラウド原稿・保存済みDSPファイルには影響しません。';
    button.textContent=en?'Delete recovery copy':'復元用コピーを削除';button.disabled=true;button.onclick=null;
    if(readSharedStudioAccess()){status.textContent=en?'Shared editing recovery is managed separately.':'共有編集中の復元データは別に管理されます。';return;}
    status.textContent=en?'Checking the recovery copy…':'復元用コピーを確認しています…';
    const current=()=>revision===editorCopyDeleteRevision&&epoch===getProjectSessionEpoch()&&id===localRecentId(state);
    try {
        const copy=(await listLocalRecentProjects()).find(project=>project.id===id);
        if(!current())return;
        status.textContent=copy?(en?'Deleting closes this manuscript. Undo is available on the Dashboard.':'削除するとこの原稿を閉じます。ダッシュボードで元に戻せます。'):(en?'There is no recovery copy for this manuscript.':'この原稿の復元用コピーはありません。');
        button.disabled=!copy;
        if(copy)button.onclick=async()=>{if(!current()||_psPublicationThumbnailSaving)return;button.disabled=true;await deleteHomeLocalCopy(copy,{fromEditor:true});void refreshEditorCopyDelete();};
    } catch {if(current())status.textContent=en?'Could not check the recovery copy. Reopen these settings to retry.':'復元用コピーを確認できませんでした。設定を開き直してお試しください。';}
}
window.openProjectSettings = () => {
    const modal = document.getElementById('project-settings-modal');
    if (!modal) return;
    _clearProjectThumbnailTemporaryPreview();
    _psDraft = _cloneProjectSettingsDraft();
    const draft = _ensurePsDraft();

    // Project name
    const nameEl = document.getElementById('ps-project-name');
    if (nameEl) nameEl.value = draft.projectName || '';

    const labelEl = document.getElementById('ps-label-name');
    if (labelEl) labelEl.value = draft.labelName || '';

    // Global settings
    const ratingEl = document.getElementById('ps-rating');
    if (ratingEl) ratingEl.value = draft.rating || 'all';

    const licenseEl = document.getElementById('ps-license');
    if (licenseEl) licenseEl.value = draft.license || 'all-rights-reserved';

    // Language settings
    renderLangSettings();
    renderLangAddSelect();

    // Per-language meta table
    renderProjectSettingsTable();
    bindProjectPublicationThumbnailSettings();
    renderProjectPublicationThumbnailSettings();
    renderProjectBookSettings();
    renderProjectTextPaperSettings();

    modal.style.display = 'flex';
    void refreshEditorCopyDelete();
};

window.closeProjectSettings = (e) => {
    if (_psPublicationThumbnailSaving) return;
    if (e && e.currentTarget !== e.target) return;
    const modal = document.getElementById('project-settings-modal');
    if (modal) modal.style.display = 'none';
    _clearProjectThumbnailTemporaryPreview();
    _psDraft = null;
};

function _assertProjectSettingsPersistenceCompleted() {
    const expectedTarget = state.projectId && state.uid ? 'Cloud' : 'Local';
    const indicator=document.getElementById('save-status');
    if (indicator?.dataset.saveStatus==='saved' && indicator.dataset.saveTarget===expectedTarget) return;
    const error = new Error('プロジェクト設定を保存できませんでした。接続状態を確認して、もう一度保存してください。');
    error.code = 'PROJECT_SETTINGS_PERSISTENCE_FAILED';
    throw error;
}

window.saveProjectSettings = async () => {
    assertSharedStudioEdit();
    if (_psDraft?.book?.mode !== 'none' && !bookSpineSettingsReady(_psDraft)) return;
    if (_psPublicationThumbnailSaving) return;
    const draft = _capturePsInputsToDraft();
    const nextLanguages = draft.languages && draft.languages.length ? [...draft.languages] : ['ja'];
    const missingFlowSourceLanguages = [...new Set((state.blocks || [])
        .filter((block) => block?.kind === 'flow')
        .map((block) => String(block.flow?.document?.sourceLanguage || ''))
        .filter((languageKey) => languageKey && !nextLanguages.includes(languageKey)))];
    if (missingFlowSourceLanguages.length) {
        alert(`Flow原稿の原稿言語 ${missingFlowSourceLanguages.map((code) => code.toUpperCase()).join(', ')} は作品言語から削除できません。`);
        return;
    }
    const nextDefaultLang = nextLanguages.includes(draft.defaultLang) ? draft.defaultLang : nextLanguages[0];
    const nextActiveLang = nextLanguages.includes(draft.activeLang) ? draft.activeLang : nextDefaultLang;
    const nextBook = normalizeBookSettings(draft.book || {}, draft.bookMode || 'simple', _getProjectBookSettingsPageCount());
    const compositionIssues = getBookCompositionIssues({
        pageCount: _getProjectBookSettingsPageCount(),
        book: nextBook,
        bookMode: nextBook.mode,
        sections: state.sections || []
    });
    if (compositionIssues.includes('spread_image_requires_covers')) {
        alertCompositionIssues(compositionIssues);
        return;
    }

    const dialog = document.querySelector('#project-settings-modal .ps-dialog');
    const saveButton = document.querySelector('#project-settings-modal .ps-footer .btn-primary');
    _psPublicationThumbnailSaving = true;
    dialog?.setAttribute('aria-busy', 'true');
    dialog?.setAttribute('inert', '');
    if (saveButton) saveButton.disabled = true;
    let persistenceCompleted = false;
    try {
        if (_psPublicationThumbnailFile) {
            draft.publicationThumbnailUrl = await storePublicationThumbnailFile(_psPublicationThumbnailFile);
            _clearProjectThumbnailTemporaryPreview();
            renderProjectPublicationThumbnailSettings();
        }

        // Project name
        const newName = draft.projectName || '';
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'projectName', value: newName } });
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'publicationThumbnailUrl', value: draft.publicationThumbnailUrl || '' } });
        const titleDisplay = document.getElementById('project-title');
        if (titleDisplay) titleDisplay.textContent = newName || '新規プロジェクト';

        // Global settings
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'labelName', value: draft.labelName || '' } });
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'rating', value: draft.rating || 'all' } });
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'license', value: draft.license || 'all-rights-reserved' } });
        const nextTextPaperPreset = _getProjectTextPaperPresetKey(draft);
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'textPaperPreset', value: nextTextPaperPreset } });
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'bookMode', value: nextBook.mode } });
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'book', value: nextBook } });

        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'languages', value: nextLanguages } });
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'defaultLang', value: nextDefaultLang } });
        dispatch({ type: actionTypes.SET_ACTIVE_LANGUAGE, payload: nextActiveLang });
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'meta', value: draft.meta || {} } });
        dispatch({ type: actionTypes.SET_TITLE, payload: draft.meta?.[nextDefaultLang]?.title || '' });
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'languageConfigs', value: draft.languageConfigs || {} } });

        const nextSections = _applyTextPaperStyleToSections(state.sections, nextTextPaperPreset);
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'sections', value: nextSections } });

        const syncedBlocks = syncBlocksWithSections(
            state.blocks,
            nextSections,
            nextLanguages,
            { strictSpine: state.version === 6 },
        );
        const nextBlocks = _applyTextPaperStyleToBlocks(syncedBlocks, nextTextPaperPreset);
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'blocks', value: nextBlocks } });
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'pages', value: blocksToPages(nextBlocks) } });

        // Project Settings は確定操作なので、2秒後のautosaveへ委ねない。
        // 進行中の保存があっても flushSave の直列化ループがこのstateを次のsnapshotへ含める。
        await flushSave();
        _assertProjectSettingsPersistenceCompleted();
        persistenceCompleted = true;
    } catch (error) {
        console.error('[Project Settings] Save failed:', error);
        alert(error?.message || String(error));
    } finally {
        _psPublicationThumbnailSaving = false;
        dialog?.removeAttribute('aria-busy');
        dialog?.removeAttribute('inert');
        if (saveButton) saveButton.disabled = false;
    }

    if (!persistenceCompleted) return;

    const modal = document.getElementById('project-settings-modal');
    if (modal) modal.style.display = 'none';
    _clearProjectThumbnailTemporaryPreview();
    _psDraft = null;

    renderLangSettings();
    renderLangTabs();
    refresh();
};

// ===== Room Navigation（body.dataset.room の単一入口。各 room の「中身」は下記のみ委譲） =====
window.switchRoom = (room) => {
    const targetRoom = getValidStudioRoom(room);
    if (targetRoom === 'press' && readSharedStudioAccess()) return;
    const previousRoom = getCurrentRoom();
    if (targetRoom !== 'editor') studioAI?.disable();
    if (previousRoom === 'press' && targetRoom !== 'press') {
        leavePressRoom();
    }
    if (previousRoom === 'editor' && targetRoom !== 'editor') {
        if (_flowAuthoringReflowTimer) clearTimeout(_flowAuthoringReflowTimer);
        _flowAuthoringReflowTimer = null;
        _editorFlowProjectionController?.abort();
        _editorFlowProjectionController = null;
        _editorFlowProjectionRequestKey = '';
        _editorFlowProjectionRequestId += 1;
    }
    document.body.dataset.room = targetRoom;
    syncStudioRoomUrl(targetRoom);
    syncStudioShell();
    if (targetRoom === 'editor' && previousRoom !== 'editor') {
        refresh();
    }
    if (targetRoom === 'home') {
        renderHomeDashboard().catch((e) => console.warn('[Home] render failed:', e));
    }
    // press / works は専用モジュールが DOM・イベントを持つ
    if (targetRoom === 'press') {
        enterPressRoom();
    }
    if (targetRoom === 'works') {
        loadWorksRoom(); // openWorksRoom(true) と同義（ルームモード）
    }
};

window.togglePageStrip = () => {
    document.body.classList.toggle('strip-collapsed');
    const chevron = document.getElementById('page-strip-chevron');
    if (chevron) {
        chevron.textContent = document.body.classList.contains('strip-collapsed') ? 'expand_less' : 'expand_more';
    }
    // #page-strip の CSS transition（200ms）完了後にキャンバスサイズを再計算
    setTimeout(() => fitCanvasView(), 220);
};

window.handleMobileHeaderNav = () => {
    const navBtn = document.getElementById('mobile-header-nav');
    const targetRoom = navBtn?.dataset.targetRoom;
    if (targetRoom) {
        window.switchRoom(targetRoom);
    }
};


const MOBILE_ROOM_ACTIONS = {
    home: [
        {
            key: 'new-project',
            icon: 'add_circle',
            labelKey: 'bottom_new_project',
            onClick: async () => {
                if (await window.newSpaceProject()) {
                    window.switchRoom('editor');
                }
            }
        },
        {
            key: 'open-local',
            icon: 'folder_open',
            labelKey: 'bottom_open_local',
            onClick: () => window.openDSP()
        },
        {
            key: 'menu',
            icon: 'menu',
            labelKey: 'bottom_menu',
            sheet: 'menu'
        }
    ],
    editor: [
        { key: 'pages', icon: 'view_carousel', labelKey: 'bottom_pages', sheet: 'pages' },
        { key: 'add', icon: 'add_circle', labelKey: 'bottom_add', sheet: 'add' },
        { key: 'edit', icon: 'tune', labelKey: 'bottom_edit', sheet: 'edit' },
        { key: 'export', icon: 'ios_share', labelKey: 'bottom_export', sheet: 'export' },
        { key: 'menu', icon: 'menu', labelKey: 'bottom_menu', sheet: 'menu' }
    ],
    press: [
        { key: 'menu', icon: 'menu', labelKey: 'bottom_menu', sheet: 'menu' }
    ],
    works: [
        { key: 'menu', icon: 'menu', labelKey: 'bottom_menu', sheet: 'menu' }
    ]
};

let activeMobileSheet = null;
let lastDeviceKey = getDeviceKey();

function getMobileActionConfigs(room = getCurrentRoom()) {
    return MOBILE_ROOM_ACTIONS[room] || [];
}

function setBottomBarActive(actionName) {
    document.querySelectorAll('.bottom-item').forEach((item) => {
        item.classList.toggle('active', item.dataset.mobileAction === actionName);
    });
}

function syncMobileMenuSheet() {
    const room = getCurrentRoom();
    document.querySelectorAll('[data-mobile-room-only]').forEach((el) => {
        el.hidden = el.dataset.mobileRoomOnly !== room;
    });
    document.querySelectorAll('[data-mobile-room-nav]').forEach((el) => {
        el.classList.toggle('active', el.dataset.mobileRoomNav === room);
    });
    document.querySelectorAll('[data-studio-room-nav]').forEach((el) => {
        el.classList.toggle('active', el.dataset.studioRoomNav === room);
    });
}

function setStudioLogoMenuOpen(open) {
    const menu = document.getElementById('studio-logo-menu');
    const btn = document.getElementById('studio-logo-menu-btn');
    if (!menu) return;
    menu.hidden = !open;
    btn?.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) syncMobileMenuSheet();
}

window.closeStudioLogoMenu = () => {
    setStudioLogoMenuOpen(false);
};

window.toggleStudioLogoMenu = (event) => {
    event?.stopPropagation();
    const menu = document.getElementById('studio-logo-menu');
    setStudioLogoMenuOpen(!!menu?.hidden);
};

function setMobileStudioNavOpen(open) {
    const menu = document.getElementById('mobile-studio-nav-menu');
    const btn = document.getElementById('mobile-studio-logo-btn');
    if (!menu) return;
    menu.hidden = !open;
    document.body.classList.toggle('mobile-studio-nav-open', open);
    btn?.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
        syncMobileMenuSheet();
    }
}

window.closeMobileStudioNavMenu = () => {
    setMobileStudioNavOpen(false);
};

window.toggleMobileStudioNavMenu = (event) => {
    event?.stopPropagation();
    if (window.innerWidth >= 1024) return;
    const menu = document.getElementById('mobile-studio-nav-menu');
    const shouldOpen = !!menu?.hidden;
    closeMobileSheet();
    setMobileStudioNavOpen(shouldOpen);
};

function handleMobileBottomAction(actionKey) {
    const action = getMobileActionConfigs().find((item) => item.key === actionKey);
    if (!action) return;
    closeMobileStudioNavMenu();
    if (action.sheet) {
        openMobileSheet(action.sheet);
        return;
    }
    closeMobileSheet();
    action.onClick?.();
}

function renderMobileBottomBar() {
    const bottomBar = document.getElementById('bottom-bar');
    if (!bottomBar) return;
    const device = getDeviceKey();
    const actions = device === 'mobile' ? getMobileActionConfigs() : [];

    document.body.classList.toggle('mobile-bottom-visible', actions.length > 0);

    if (!actions.length) {
        bottomBar.innerHTML = '';
        setBottomBarActive(null);
        return;
    }

    bottomBar.style.setProperty('--mobile-bottom-columns', String(actions.length));
    bottomBar.innerHTML = actions.map((action) => `
        <button class="bottom-item" data-mobile-action="${action.key}">
            <span class="material-icons">${action.icon}</span><span>${t(action.labelKey)}</span>
        </button>
    `).join('');

    bottomBar.querySelectorAll('.bottom-item').forEach((item) => {
        item.addEventListener('click', () => handleMobileBottomAction(item.dataset.mobileAction));
    });

    if (activeMobileSheet && !actions.some((action) => action.key === activeMobileSheet || action.sheet === activeMobileSheet)) {
        closeMobileSheet();
    } else {
        setBottomBarActive(activeMobileSheet);
    }
}

window.closeMobileSheet = () => {
    activeMobileSheet = null;
    document.body.classList.remove('mobile-sheet-active');
    ['sidebar', 'panel-right', 'mobile-action-sheet'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('mobile-sheet-open');
    });
    document.querySelectorAll('.mobile-sheet-content').forEach((el) => el.classList.remove('active'));
    setBottomBarActive(null);
};

window.closeMobileOverlays = () => {
    closeMobileStudioNavMenu();
    closeMobileSheet();
};

function openMobileActionSheet(contentId) {
    const actionSheet = document.getElementById('mobile-action-sheet');
    if (!actionSheet) return;
    actionSheet.classList.add('mobile-sheet-open');
    document.querySelectorAll('.mobile-sheet-content').forEach((el) => {
        el.classList.toggle('active', el.id === contentId);
    });
}

window.openMobileSheet = (sheetName) => {
    if (window.innerWidth >= 1024) return;
    if (activeMobileSheet === sheetName) {
        closeMobileSheet();
        return;
    }

    closeMobileStudioNavMenu();
    closeMobileSheet();
    activeMobileSheet = sheetName;
    document.body.classList.add('mobile-sheet-active');
    setBottomBarActive(sheetName);

    if (sheetName === 'pages') {
        document.getElementById('sidebar')?.classList.add('mobile-sheet-open');
        return;
    }
    if (sheetName === 'edit') {
        document.getElementById('panel-right')?.classList.add('mobile-sheet-open');
        return;
    }

    const map = {
        menu: 'mobile-sheet-menu',
        add: 'mobile-sheet-add',
        export: 'mobile-sheet-export',
        lang: 'mobile-sheet-lang'
    };
    openMobileActionSheet(map[sheetName] || 'mobile-sheet-menu');
};

function initUIChrome() {
    initFlowRibbon();
    _flowCompare = createFlowTranslationCompare({
        container: document.getElementById('canvas-view'), createView: createEditorFlowCanvas,
        model: () => ({state, group:getActiveBlock()}),
        review: operation => {
            clearFlowDirectEditRuntime(); endHistoryGroup();
            applyFlowAuthoringEdit({type:'confirmTranslationUnit', ...operation}, {rerender:true, immediate:true});
        },
        openTranslation: openCanvasTranslationPanel,
        canSwitch: () => !_flowAuthoringComposing && _flowDirectEditProxy?.dataset.flowReflowPending !== 'true',
        activate: (language, view) => {
            if (view && getActiveBlock()?.kind === 'page') {
                parkFixedCanvasStage();
                _flowCanvasView?.refreshFixedPreviews(() => true);
            }
            clearFlowDirectEditRuntime(); endHistoryGroup();
            state.activeLang = language;
            if (view) _flowCanvasView = view;
            const group = getActiveBlock();
            if (group?.kind === 'flow') selectFlowGeneratedPage(group.id);
            renderLangTabs(); renderThumbs(); syncFlowDirectFormatControls();
        },
        changed: (enabled) => {
            clearFlowDirectEditRuntime(); endHistoryGroup();
            _flowCanvasView?.setVisible(false); _flowCanvasView = null;
            const group = getActiveBlock();
            if (enabled && group?.kind === 'flow') selectFlowGeneratedPage(group.id);
            refresh();
        },
    });
    document.querySelectorAll('.ribbon-tab').forEach((tab) => {
        tab.addEventListener('click', () => setRibbonTab(tab.dataset.ribbonTab));
    });

    document.getElementById('btn-toggle-sidebar')?.addEventListener('click', () => window.toggleDrawer('assets'));
    document.getElementById('btn-toggle-panel')?.addEventListener('click', () => toggleDesktopPanel('right'));

    window.addEventListener('dsf-auth-signed-in', (event) => {
        const user = event.detail?.user || firebaseAuth.currentUser || null;
        if (user) {
            applyStudioAuthUser(user);
            closeAllStudioAuthDropdowns();
            renderHomeDashboard().catch((e) => console.warn('[Home] render failed after auth event:', e));
        }
    });
    window.addEventListener('online',()=>{if(state.uid&&getCurrentRoom()==='home')void renderHomeDashboard({forceRefresh:true});});
    window.addEventListener('dsf-auth-error', (event) => {
        const error = event.detail?.error;
        console.error('[Auth] Google credential sign-in error:', error);
        alert(t('auth_google_failed', { message: error?.message || String(error || '') }));
    });

    document.addEventListener('click', (event) => {
        const desktopMenu = document.getElementById('studio-logo-menu');
        const desktopBtn = document.getElementById('studio-logo-menu-btn');
        if (desktopMenu && !desktopMenu.hidden && !desktopMenu.contains(event.target) && !desktopBtn?.contains(event.target)) {
            closeStudioLogoMenu();
        }

        const menu = document.getElementById('mobile-studio-nav-menu');
        const btn = document.getElementById('mobile-studio-logo-btn');
        if (!menu || menu.hidden) return;
        if (menu.contains(event.target) || btn?.contains(event.target)) return;
        closeMobileStudioNavMenu();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeStudioLogoMenu();
            closeMobileStudioNavMenu();
        }
    });

    window.addEventListener('resize', () => {
        const currentDeviceKey = getDeviceKey();
        if (currentDeviceKey !== lastDeviceKey) {
            lastDeviceKey = currentDeviceKey;
            applyThumbColumnsFromPrefs();
            refresh();
            updateAuthUI();
        }
        syncStudioShell();
        syncDesktopToggleButtons();
    });

    setRibbonTab('home');
    syncDesktopToggleButtons();
    syncStudioShell();
}

function finishInitialRoomBoot() {
    document.body.removeAttribute('data-booting');
    syncStudioShell();
}

// 後方互換: 旧モバイルナビAPI
window.toggleMobilePanel = (panelName) => {
    if (panelName === 'sidebar') return openMobileSheet('pages');
    if (panelName === 'properties') return openMobileSheet('edit');
    return closeMobileSheet();
};

window.toggleAuth = async () => {
    try {
        if (state.uid) {
            await signOutUser(firebaseAuth);
        } else {
            const result = await signInWithGoogle({ authInstance: firebaseAuth });
            if (result?.user) applyStudioAuthUser(result.user);
        }
    } catch (e) {
        console.error('[Auth] toggleAuth error:', e);
        alert(t('auth_google_failed', { message: e?.message || String(e) }));
    }
};

// Firebase Auth → state.user / uid。ログイン後にだけ URL ?id= のクラウドプロジェクトを開く。
onAuthChanged((user) => {
    applyStudioAuthUser(user);
    if (getCurrentRoom() === 'works') {
        void openWorksRoom(true);
    }
    renderHomeDashboard().catch((e) => console.warn('[Home] render failed after auth:', e));
    if (user) {
        void hydrateStudioAccount(user);
        const pid = new URLSearchParams(window.location.search).get('id');
        if (pid && !new URLSearchParams(location.search).has('sharedWork')) void onLoadProject(pid);
    } else {
        studioAccount = null;
    }
}, firebaseAuth);

// ── UI言語スイッチャー（windowに公開） ──────────────────────────
window.previewEditorInViewer = openEditorViewerPreview;
window.setStudioUILang = (lang) => {
    setUILang(lang);
    const currentRoom = getCurrentRoom();
    getPublishingSpaceUI().render();
    // 動的レンダリング済みコンポーネントを再描画
    renderLangTabs();
    updateAuthUI();
    if (currentRoom === 'home') {
        renderHomeDashboard().catch((e) => console.warn('[Home] render failed after language switch:', e));
    }
    if (document.getElementById('project-settings-modal')?.style.display !== 'none') {
        _capturePsInputsToDraft();
        renderProjectSettingsTable();
        renderLangSettings();
        renderLangAddSelect();
        renderProjectBookSettings();
        renderProjectPublicationThumbnailSettings();
        void refreshEditorCopyDelete();
    }
    if (currentRoom === 'press') {
        enterPressRoom();
    }
    if (currentRoom === 'works') {
        void refreshWorksRoomLanguage(true);
    }
    syncStudioShell();
    refreshFlowRibbon();refreshEditorLanguagePresentation();
    // Update labels in place; keep text DOM, caret, selection, zoom and scroll intact.
    _flowNormalCanvasView?.refreshLabels();
    _flowCanvasView?.refreshLabels();
    _flowCompare?.refreshLabels();
    _flowManuscriptCompare?.refreshLabels();
    const active = state.blocks?.[state.activeBlockIdx];
    const note = document.getElementById('page-lock-note');
    if (active?.kind === 'flow' && !isFlowSourceSelected(active.id) && note?._flowStatus) {
        note.textContent = formatFlowPageStatus(note._flowStatus, getUILang());
    }
};

// --- 初回描画: UI 骨組み → リダイレクト認証結果 → GIS 初期化 → ローカル復元 → ?room= ---
async function bootstrapApp() {
    const initialSession = getProjectSessionIdentity();
    initUIChrome();
    normalizeStudioRouteUrl();
    const urlParams = new URLSearchParams(window.location.search);
    const targetRoom = getValidStudioRoom(urlParams.get('room'));

    ensureUiPrefs();
    applyThumbColumnsFromPrefs();
    applyTheme();
    bindThemePreferenceListener(() => {
        updateStudioThemeSwitchers();
    });
    applyI18n(); // UI言語を適用
    window.switchRoom(targetRoom);
    finishInitialRoomBoot();

    await authReady;

    // Prevent local restore if we are explicitly loading a cloud project via URL
    const sharedTarget = urlParams.has('sharedWork') ? {spaceId:urlParams.get('sharedSpace'),workId:urlParams.get('sharedWork')} : null;
    const hasCloudId = urlParams.has('id') || !!sharedTarget;
    const fileLaunchStartup = urlParams.get('fileLaunch') === 'dsp' && !hasCloudId;

    const redirectOutcome = navigator.onLine ? await handleRedirectResult(firebaseAuth) : null;
    if (redirectOutcome?.error) {
        alert(t('auth_google_failed', { message: redirectOutcome.error?.message || String(redirectOutcome.error) }));
    }
    if (redirectOutcome?.result?.user) {
        applyStudioAuthUser(redirectOutcome.result.user);
        await hydrateStudioAccount(redirectOutcome.result.user);
    } else if (firebaseAuth.currentUser && navigator.onLine) {
        applyStudioAuthUser(firebaseAuth.currentUser);
        await hydrateStudioAccount(firebaseAuth.currentUser);
    }
    if(navigator.onLine) void initGIS({ authInstance: firebaseAuth, autoPrompt: false });

    if (!hasCloudId) {
        try {
            const backup = await idbGet('dsf_autosave');
            if (backup && backup.state && initialSession === getProjectSessionIdentity() && !openingProject) {
                console.log("[DSF] Found local auto-save backup. Restoring...");
                if(backup.state.projectId)await safeResume.protect(backup);

                // Restore object URLs for unsaved guest images
                let stateStr = JSON.stringify(backup.state);
                const restoredMap = {};

                if (backup.imageMap) {
                    for (const [oldUrl, localId] of Object.entries(backup.imageMap)) {
                        const blob = await idbGet(localId);
                        if (blob) {
                            const newUrl = URL.createObjectURL(blob);
                            restoredMap[newUrl] = localId; // keep the new mapping alive
                            stateStr = stateStr.split(oldUrl).join(newUrl);
                        }
                    }
                }

                if(initialSession === getProjectSessionIdentity() && !openingProject) {
                const restoredState = hydrateProjectFromPersistence(JSON.parse(stateStr));
                if(fileLaunchStartup){
                    // Preserve the previous draft before a new file can replace the startup backup.
                    try{await cacheLocalRecentProject(restoredState,restoredMap);}
                    finally{Object.keys(restoredMap).forEach(url=>URL.revokeObjectURL(url));}
                } else {
                window.localImageMap = restoredMap;
                // Only dispatch state keys that exist in our actual store
                resetFlowRuntimeForProjectChange();
                clearHistory();
                dispatch({ type: actionTypes.LOAD_PROJECT, payload: restoredState });
                if(restoredState.projectId){markRestoredCloudCopy();setLocalCloudTransitionPending(true);}
                noteLocalDraftEdit();
                console.log("[DSF] Auto-save restored successfully.");
                }
                } else { Object.keys(restoredMap).forEach(url=>URL.revokeObjectURL(url)); }
            }
        } catch (err) {
            console.warn("[DSF] Error restoring local auto-save:", err);
            if(fileLaunchStartup)throw err;
        }
    }

    if (sharedTarget) {
        try {
            resetFlowRuntimeForProjectChange();
            await loadSharedProject(sharedTarget,()=>{resetFlowRuntimeForProjectChange({keepSession:true});clearHistory();ensureUiPrefs();applyThumbColumnsFromPrefs();refresh();renderLangSettings();});
            window.switchRoom('editor');
        } catch(error) {
            console.warn('[Shared Studio] Open failed:',error.code || 'UNAVAILABLE');
            alert(getUILang()==='en'?'Could not open the shared manuscript. Check your account and invitation.':'共有原稿を開けません。ログイン中のアカウントと招待の承諾状態を確認してください。');
            window.switchRoom('home');
        }
    }
    if (import.meta.env.DEV && urlParams.get('flowTranslationVerification') === '1') {
        installFlowTranslationVerificationProvider({
            delayMs: Number(urlParams.get('flowTranslationDelayMs')) || 25,
            expansionFactor: Number(urlParams.get('flowTranslationExpansionFactor')) || 1,
            failUnitIndex: urlParams.has('flowTranslationFailUnitIndex')
                ? Number(urlParams.get('flowTranslationFailUnitIndex'))
                : -1,
        });
    }
    refresh();
    renderLangSettings();
    updateAuthUI();
    if (getCurrentRoom() === 'press') {
        enterPressRoom();
    }
    if (getCurrentRoom() === 'home') {
        renderHomeDashboard().catch((e) => console.warn('[Home] initial render failed:', e));
    }
}

if (import.meta.env.MODE !== 'production') {
    Object.defineProperty(window, '__flowAuthoringLab', {
        configurable: true,
        value: Object.freeze({
            getSourceSnapshot() {
                const active = getActiveBlock();
                return active?.kind === 'flow'
                    ? Object.freeze(JSON.parse(JSON.stringify(active.flow.document)))
                    : null;
            },
            getRuntimeState() {
                const root = getFlowAuthoringSurface();
                const active = getActiveBlock();
                const projection = getEditorPageProjection();
                const groupProjection = active?.kind === 'flow'
                    ? getFlowAuthoringGroupProjection(projection, active.id)
                    : null;
                const languageKey = active?.kind === 'flow' ? getFlowAuthoringLanguage(active) : '';
                const translationStatus = active?.kind === 'flow'
                    ? deriveFlowTranslationStatus(active, languageKey)
                    : null;
                return Object.freeze({
                    groupId: active?.kind === 'flow' ? active.id : '',
                    mode: active?.kind === 'flow' ? getFlowEditorSelection(active.id).mode : '',
                    reflowState: root?.dataset.reflowState || '',
                    sourceRevision: Number(root?.dataset.sourceRevision || 0),
                    renderedRevision: Number(root?.dataset.renderedRevision || 0),
                    pageCount: Number(root?.dataset.pageCount || groupProjection?.pageCount || 0),
                    changeMode: root?.dataset.changeMode || '',
                    prefixPageCount: Number(root?.dataset.prefixPageCount || 0),
                    measuredPageCount: Number(root?.dataset.measuredPageCount || 0),
                    composing: root?.dataset.composing === 'true',
                    sourceFallback: root?.dataset.sourceFallback === 'true',
                    translationStatus: translationStatus?.status || '',
                    outlineIssues: translationStatus?.hasOutlineIssues === true,
                });
            },
            getTranslationStatus() {
                const active = getActiveBlock();
                if (active?.kind !== 'flow') return null;
                return Object.freeze(JSON.parse(JSON.stringify(
                    deriveFlowTranslationStatus(active, getFlowAuthoringLanguage(active)),
                )));
            },
            getTranslationStateSnapshot() {
                const active = getActiveBlock();
                if (active?.kind !== 'flow') return null;
                return active.flow.translationState === undefined
                    ? null
                    : Object.freeze(JSON.parse(JSON.stringify(active.flow.translationState)));
            },
            installDeterministicTranslationProvider(options = {}) {
                return installFlowTranslationVerificationProvider(options);
            },
            getTranslationJob() {
                if (!_flowTranslationJob) return null;
                const { controller, ...snapshot } = _flowTranslationJob;
                return Object.freeze(JSON.parse(JSON.stringify(snapshot)));
            },
            awaitTranslationSettled() {
                return new Promise((resolve, reject) => {
                    const startedAt = Date.now();
                    const check = () => {
                        const snapshot = this.getTranslationJob();
                        if (snapshot && snapshot.state !== 'running') {
                            resolve(snapshot);
                            return;
                        }
                        if (Date.now() - startedAt > 30000) {
                            reject(new Error('Timed out waiting for Flow translation.'));
                            return;
                        }
                        setTimeout(check, 25);
                    };
                    check();
                });
            },
            getHistoryInfo() {
                return Object.freeze({ ...getHistoryInfo() });
            },
            awaitSettled(revision = _flowAuthoringSourceRevision) {
                const target = Number(revision) || 0;
                return new Promise((resolve, reject) => {
                    const startedAt = Date.now();
                    const check = () => {
                        const snapshot = this.getRuntimeState();
                        if (snapshot.reflowState === 'error') {
                            reject(new Error('Flow authoring reflow failed.'));
                            return;
                        }
                        if (
                            snapshot.reflowState === 'idle'
                            && snapshot.renderedRevision >= target
                            && !_editorFlowProjectionController
                            && !_flowAuthoringReflowTimer
                        ) {
                            resolve(snapshot);
                            return;
                        }
                        if (Date.now() - startedAt > 30000) {
                            reject(new Error('Timed out waiting for Flow authoring reflow.'));
                            return;
                        }
                        setTimeout(check, 25);
                    };
                    check();
                });
            },
        }),
    });
}

const studioBootReady = bootstrapApp();
// File launches wait for recovery/auth startup to finish before switching documents.
void studioBootReady.catch(error => console.warn('[Studio] Startup failed:', error));

// --- 右サイドバーリサイザー初期化 ---
function initSidebarResizer() {
    const resizer = document.getElementById('resizer-right');
    if (!resizer) return;

    const doResize = (e) => {
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        let newWidth = window.innerWidth - clientX;
        if (newWidth < 200) newWidth = 200;
        if (newWidth > 800) newWidth = 800;
        document.body.style.setProperty('--right-panel-expanded-width', `${newWidth}px`);
    };

    const stopResize = () => {
        resizer.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('mousemove', doResize);
        window.removeEventListener('touchmove', doResize);
        window.removeEventListener('mouseup', stopResize);
        window.removeEventListener('touchend', stopResize);
    };

    const startResize = (e) => {
        resizer.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        if (e.type === 'mousedown') e.preventDefault();
        window.addEventListener('mousemove', doResize);
        window.addEventListener('touchmove', doResize, { passive: true });
        window.addEventListener('mouseup', stopResize);
        window.addEventListener('touchend', stopResize);
    };

    resizer.addEventListener('mousedown', startResize);
    resizer.addEventListener('touchstart', startResize, { passive: true });
}

initCanvasZoom(); // Initialize zoom/pan
initImageAdjustment(); // Initialize image adjustment events
initSidebarResizer(); // Initialize sidebar resizer
initContextMenu(); // Initialize right-click context menu

// ============================================================
// Context Menu (Right-Click) Logic
// ============================================================
function openThumbnailContextMenu(event, thumb, initialPosition = null) {
    event.preventDefault();
    if (editorDragBlocked(false)) return;
    const index = Number(thumb.dataset.blockIndex);
    const block = state.blocks?.[index];
    if (!block || !['page', 'flow'].includes(block.kind)) return;
    const flowPageIndex = Number(thumb.dataset.flowPageIndex) || 0;
    if (block.kind === 'flow') {
        selectFlowGeneratedPage(block.id);
        setSelectedFlowRuntimePageIndex(block.id, flowPageIndex);
    }
    changeBlock(index, refreshForThumbSelection);
    dispatch({type: actionTypes.SET_ACTIVE_BUBBLE_INDEX, payload: null});
    const snapshot = JSON.stringify(state.blocks);
    const projectId = state.projectId, uid = state.uid, language = state.activeLang;
    const valid = () => !editorDragBlocked(false) && state.projectId === projectId && state.uid === uid
        && state.activeLang === language && state.blocks[state.activeBlockIdx]?.id === block.id
        && JSON.stringify(state.blocks) === snapshot;
    const menu = document.getElementById('context-menu');
    const show = items => {
        showContextMenuAt(event.clientX, event.clientY, '');
        for (const item of items) {
            const button = document.createElement('button');
            button.type = 'button'; button.className = 'context-menu-item';
            button.textContent = item.label; button.disabled = !!item.disabled;
            if (item.reason) button.title = item.reason;
            button.onclick = e => { e.stopPropagation(); if (!valid()) { hideContextMenu(); return; } item.run(); };
            menu.appendChild(button);
        }
        showContextMenuAt(event.clientX, event.clientY, null);
        menu.querySelector('button:not(:disabled)')?.focus({preventScroll: true});
    };
    const add = (position, kind) => {
        hideContextMenu();
        const spreadId = block.content?.spreadImage?.groupId;
        const indices = spreadId ? state.blocks.map((b,i) => b.content?.spreadImage?.groupId === spreadId ? i : -1).filter(i=>i>=0) : [index];
        const targetIndex = position === 'before' ? indices[0] : indices.at(-1);
        if (kind === 'flow' || kind === 'title') { insertFlowGroupAt(targetIndex + (position === 'after' ? 1 : 0), kind === 'title'); return; }
        if (block.kind === 'flow') {
            const pages = getEditorPageProjection()?.pages.filter(p => p.kind === 'flow' && p.groupId === block.id) || [];
            const page = pages.find(p => p.flowPageIndex === flowPageIndex);
            const inside = position === 'before' ? flowPageIndex > 0 : flowPageIndex < pages.length - 1;
            if (!page) return;
            if (inside) {
                const point = resolveEditorFlowPageBoundary(page, position);
                if (!point || page.languageKey !== block.flow.document.sourceLanguage) return;
                try {
                    const session = createFlowDirectEditSession(block, {pageLanguageKey:page.languageKey, writingMode:page.writingMode, sourcePoint:point});
                    const imageBlock = createPageBlockFromSection({type:'image', background:'', backgrounds:{}, bubbles:[]});
                    const result = createFlowImageInsertion(state.blocks, session, {imageBlock,
                        selectionStart:point.utf16Offset, selectionEnd:point.utf16Offset, expectedText:session.expectedText});
                    applyEditorSpineChange(result);
                } catch { alert(t('flow_drag_failed')); }
                return;
            }
        }
        endHistoryGroup(); pushState();
        insertPageNearBlock(targetIndex, position, refresh, 'image');
        triggerAutoSave();
    };
    const addMenu = position => {
        const page = getEditorPageProjection()?.pages.find(p => p.groupId === block.id && p.flowPageIndex === flowPageIndex);
        const imageDisabled = block.kind === 'flow' && (!page || page.isSourceFallback || page.languageKey !== block.flow.document.sourceLanguage);
        show([
            {label:t('thumb_add_image'), disabled:imageDisabled, run:()=>add(position,'image')},
            {label:t('flow_title_page'), run:()=>add(position,'title')},
            {label:t(block.kind === 'flow' ? (position === 'before' ? 'thumb_add_flow_before_group' : 'thumb_add_flow_after_group') : 'thumb_add_flow'), run:()=>add(position,'flow')},
        ]);
    };
    if(initialPosition){addMenu(initialPosition);return;}
    const joinOptions = {languageConfigs:state.languageConfigs};
    const joinStatus = inspectFlowJoin(state.blocks, block.id, joinOptions);
    const unifiedStatus = inspectFlowJoin(state.blocks, block.id, {...joinOptions,usePreviousLayout:true});
    const reasonText = status => t(status.reason === 'metadata' && status.detail
        ? 'flow_join_detail_' + status.detail : 'flow_join_reason_' + status.reason);
    const blockedStatus = joinStatus.reason === 'layout' && !unifiedStatus.eligible ? unifiedStatus : joinStatus;
    const performJoin = (mergeParagraphs, usePreviousLayout=false) => {
        hideContextMenu();
        try {
            const result = joinFlowWithPrevious(state.blocks, block.id, {...joinOptions,mergeParagraphs,usePreviousLayout});
            applyEditorSpineChange(result);
            const group = result.blocks[result.activeBlockIndex];
            const languageKey = getFlowAuthoringLanguage(group);
            const target = group.flow.document.sections.find(s=>s.id===result.focusPoint.sectionId)?.blocks.find(b=>b.id===result.focusPoint.blockId);
            const offset = languageKey === group.flow.document.sourceLanguage ? result.focusPoint.utf16Offset : 0;
            const point = {...result.focusPoint, languageKey, blockType:target?.type,
                ...mapFlowTextUtf16OffsetToGrapheme(target?.texts?.[languageKey] || '', offset, languageKey)};
            selectFlowSource(group.id, point); refresh(); restoreMappedFlowSourceCaret(group.id, point);
        } catch { alert(t('flow_join_reason_invalid')); }
    };
    const joinMenu = () => {
        if (!joinStatus.eligible) {
            const currentIndex = state.blocks.findIndex(item=>item.id===block.id);
            let differences;
            try {
                differences = getFlowJoinLayoutDifferences(state.blocks[currentIndex-1].flow.layout,
                    state.blocks[currentIndex].flow.layout,joinOptions);
            } catch { alert(t('flow_join_reason_invalid')); return; }
            const summary = differences.map(item => (item.language ? item.language + ': ' : '') + t('flow_join_field_' + item.field)).join('、');
            show([{label:t('flow_join_unify'), run:()=>{
                hideContextMenu();
                if (confirm(summary + '\n\n' + t('flow_join_unify_confirm'))) performJoin(false,true);
            }}]);
            const note = document.createElement('div'); note.className='context-menu-note';
            note.textContent = summary; menu.appendChild(note); showContextMenuAt(event.clientX,event.clientY,null);
            return;
        }
        const paragraphStatus = inspectFlowJoin(state.blocks, block.id, {...joinOptions,mergeParagraphs:true});
        show([
            {label:t('flow_join_keep'), run:()=>performJoin(false)},
            {label:t('flow_join_paragraphs'), disabled:!paragraphStatus.eligible,
                reason:paragraphStatus.eligible?'':reasonText(paragraphStatus), run:()=>performJoin(true)},
        ]);
        const note = document.createElement('div'); note.className='context-menu-note';
        note.textContent = t('flow_join_translation_note') + (!paragraphStatus.eligible ? '\n' + reasonText(paragraphStatus) : '');
        menu.appendChild(note); showContextMenuAt(event.clientX,event.clientY,null);
    };
    show([
        {label:t('thumb_add_before'), run:()=>addMenu('before')},
        {label:t('thumb_add_after'), run:()=>addMenu('after')},
        ...(block.kind === 'flow' ? [
            {label:t('flow_join_previous'), disabled:!joinStatus.eligible && !unifiedStatus.eligible, reason:joinStatus.eligible?'':reasonText(blockedStatus), run:joinMenu},
            {label:t('flow_open_source'), run:()=>{hideContextMenu();window.changeFlowSourceBlock(index);}},
            {label:t('thumb_delete_flow'), run:()=>{hideContextMenu();selectFlowSource(block.id);if (!deleteActiveFlowGroup(block)) { selectFlowGeneratedPage(block.id); refreshForThumbSelection(); }}},
        ] : [{label:t('thumb_delete_page'), disabled:!canDeleteActive(), run:()=>{hideContextMenu();window.deleteActive();}}]),
    ]);
    if (block.kind === 'flow' && !joinStatus.eligible) {
        const note = document.createElement('div'); note.className='context-menu-note'; note.textContent=reasonText(blockedStatus);
        menu.appendChild(note); showContextMenuAt(event.clientX,event.clientY,null);
    }
}

function initContextMenu() {
    const contextMenu = document.getElementById('context-menu');
    if (!contextMenu) return;

    // キャンバスおよび吹き出し上の右クリックをフック
    document.addEventListener('contextmenu', (e) => {
        const thumb = e.target.closest('#editor-room .thumb-wrap[data-block-index]');
        if (thumb) { openThumbnailContextMenu(e, thumb); return; }
        // Only intercept if we are in the editor area
        const canvasView = document.getElementById('canvas-view');
        if (!canvasView || !canvasView.contains(e.target)) return;

        e.preventDefault(); // デフォルトメニューを禁止
        if (!canEditActiveFixedPage()) {
            hideContextMenu();
            return;
        }

        // どこがクリックされたか判定
        const bubbleSvg = e.target.closest('.bubble-svg');
        const bubbleText = e.target.closest('.bubble-text');
        const isBubble = bubbleSvg || bubbleText;

        // メニュー内容を動的に生成
        contextMenu.innerHTML = '';

        if (isBubble) {
            // 吹き出しの上で右クリックした場合
            // 要素IDからインデックスを逆引き
            let bubbleIndex = -1;
            const targetEl = bubbleSvg || bubbleText;
            if (targetEl && targetEl.id) {
                const match = targetEl.id.match(/^bubble-(?:svg|text)-(\d+)$/);
                if (match) bubbleIndex = parseInt(match[1], 10);
            }

            if (bubbleIndex !== -1) {
                // select it first (pass refresh so UI updates)
                selectBubble(e, bubbleIndex, refresh);

                const currentShape = (() => {
                    const s2 = state.sections[state.activeIdx];
                    return s2?.bubbles?.[bubbleIndex]?.shape || 'speech';
                })();

                const shapeOptions = [
                    ['speech', '角丸'], ['oval', '楕円'], ['rect', '四角'],
                    ['cloud', '雲'], ['wave', '波'], ['thought', '思考'],
                    ['explosion', '💥 爆発'], ['digital', '📡 電子音'],
                    ['shout', '⚡ ギザギザ'], ['flash', '✨ フラッシュ'], ['urchin', '🦔 ウニフラッシュ']
                ].map(([v, l]) =>
                    `<option value="${v}"${v === currentShape ? ' selected' : ''}>${l}</option>`
                ).join('');

                contextMenu.innerHTML = `
                    <div class="context-menu-item context-menu-shape">
                        <span class="material-icons">auto_fix_high</span>
                        <select class="context-shape-select" onchange="changeBubbleShapeFromMenu(${bubbleIndex}, this.value)" onclick="event.stopPropagation()">
                            ${shapeOptions}
                        </select>
                    </div>
                    <div class="context-menu-item" onclick="duplicateSelectedBubble(${bubbleIndex})">
                        <span class="material-icons">content_copy</span> 複製
                    </div>
                    <div class="context-menu-item" onclick="deleteSelectedBubble(${bubbleIndex})" style="color: #d32f2f;">
                        <span class="material-icons">delete</span> 削除
                    </div>
                `;
            }
        } else {
            // キャンバス（何もない場所）で右クリックした場合
            contextMenu.innerHTML = `
                <div class="context-menu-item" onclick="addBubbleAtPointer(event)">
                    <span class="material-icons">text_fields</span> ここにテキストを追加
                </div>
            `;
            // ポインター座標を一時保存（addBubbleAtPointerで使う）
            contextMenu.dataset.pointerX = e.clientX;
            contextMenu.dataset.pointerY = e.clientY;
        }

        showContextMenuAt(e.clientX, e.clientY, contextMenu.innerHTML);
    });

    document.addEventListener('keydown', e => { if (e.key === 'Escape') hideContextMenu(); });
    // 画面のどこかをクリックしたらコンテキストメニューを閉じる
    document.addEventListener('click', (e) => {
        if (!contextMenu.contains(e.target)) {
            hideContextMenu();
        }
    });
}

// Global functions for context menu actions
window.addBubbleAtPointer = function (e) {
    const contextMenu = document.getElementById('context-menu');
    if (!contextMenu) return;
    hideContextMenu();
    if (!canEditActiveFixedPage()) return;

    const clientX = parseFloat(contextMenu.dataset.pointerX);
    const clientY = parseFloat(contextMenu.dataset.pointerY);

    if (isNaN(clientX) || isNaN(clientY)) return;

    const layer = document.getElementById('canvas-transform-layer');
    if (!layer) return;

    const rect = layer.getBoundingClientRect();

    // Convert screen coordinates to canvas % coordinates
    let x = ((clientX - rect.left) / rect.width) * 100;
    let y = ((clientY - rect.top) / rect.height) * 100;

    // Clamp
    x = Math.max(5, Math.min(95, x));
    y = Math.max(5, Math.min(95, y));

    pushState();
    const newBubble = {
        id: 'bubble_' + Date.now(),
        shape: 'rect',
        text: 'テキスト',
        x: x.toFixed(1),
        y: y.toFixed(1),
        tailX: 0,
        tailY: 20
    };

    if (!state.sections[state.activeIdx].bubbles) {
        state.sections[state.activeIdx].bubbles = [];
    }
    state.sections[state.activeIdx].bubbles.push(newBubble);

    // Select the newly created bubble
    state.activeBubbleIdx = state.sections[state.activeIdx].bubbles.length - 1;

    refresh();
    triggerAutoSave();
};

window.duplicateSelectedBubble = function (bubbleIndex) {
    const contextMenu = document.getElementById('context-menu');
    if (contextMenu) hideContextMenu();

    const section = getEditableActiveFixedSection();
    if (!section || !section.bubbles || !section.bubbles[bubbleIndex]) return;

    pushState();
    const source = section.bubbles[bubbleIndex];
    const clone = JSON.parse(JSON.stringify(source));
    clone.id = 'bubble_' + Date.now();
    clone.x = (parseFloat(source.x) + 5).toFixed(1); // slightly offset
    clone.y = (parseFloat(source.y) + 5).toFixed(1);

    section.bubbles.push(clone);
    state.activeBubbleIdx = section.bubbles.length - 1;

    refresh();
    triggerAutoSave();
};

window.deleteSelectedBubble = function (bubbleIndex) {
    const contextMenu = document.getElementById('context-menu');
    if (contextMenu) hideContextMenu();

    const section = getEditableActiveFixedSection();
    if (!section || !section.bubbles || !section.bubbles[bubbleIndex]) return;

    pushState();
    section.bubbles.splice(bubbleIndex, 1);
    state.activeBubbleIdx = null;

    refresh();
    triggerAutoSave();
};

initStudioHelp();
initHistoryPanel({ getUILang, undo: performProjectUndo, redo: performProjectRedo, canStep: () => getCurrentRoom() === 'editor' && !readStudioAIState().busy });
studioAI = initStudioWebMCP({ readSaveStatus: getEditorSaveStatus, getUILang, subscribeProjectSession, readState: readStudioAIState,
    history: { list: listHistoryEntries, read: readHistoryEntry, guard: getHistoryGuard,
        step: direction => { if(readStudioAIState().busy) return false; return direction === 'undo' ? performProjectUndo() : performProjectRedo(); } },
    readComposition: languageKey => ({ direction: getEditorLangDirection(languageKey),
        projection: hasFlowGroups(state)
            ? getCachedFlowRuntimePageProjection(state, languageKey, state.sections || [], document, editorFlowScope())
            : buildFlowPageProjection({ blocks: state.blocks || [], fixedPages: state.sections || [], requestedLanguageKey: languageKey }) }),
    selectPage: ({ blockId, flowPageIndex }) => {
        if (readStudioAIState().busy) throw Error('AI_EDIT_BUSY');
        const index = state.blocks.findIndex(block => block.id === blockId);
        if (index < 0) throw Error('INVALID_PAGE_TARGET');
        endHistoryGroup();
        if (state.blocks[index].kind === 'flow') {
            const count = getEditorPageProjection()?.pages?.filter(page => page.groupId === blockId).length || 1;
            selectFlowGeneratedPage(blockId);
            setSelectedFlowRuntimePageIndex(blockId, flowPageIndex, count);
        }
        changeBlock(index, refreshForThumbSelection);
    },
    applyPageChange: result => {
        if (readStudioAIState().busy) throw Error('AI_EDIT_BUSY');
        applyEditorSpineChange(result, { history: { actor: 'ai' } });
    },
    prepareImage: prepareAuthoringImage, discardImage: discardPreparedAuthoringImage,
    applyImagePage: result => {
        if (readStudioAIState().busy) throw Error('AI_EDIT_BUSY');
        applyEditorSpineChange(result, { history: { actor: 'ai' } });
    },
    createProject: (draft, guard) => createProjectWithBackup(draft, guard, {
        readProject: () => state, flushPendingSave,
        backup: snapshot => cacheLocalRecentProject(snapshot, window.localImageMap),
        commit: next => initializeNewProject({ languageKey: next.languageKey, pageDirection: next.writingMode === 'vertical-rl' ? 'rtl' : 'ltr' }, next),
    }),
    applyEdit: result => {
        if (readStudioAIState().busy || _editorFlowProjectionController) throw new Error('AI_EDIT_BUSY');
        const active = state.blocks[state.activeBlockIdx];
        applyEditorSpineChange({ ...result, activeBlockIndex: state.activeBlockIdx }, {
            history: { actor: 'ai' }, flowPageIndex: getSelectedFlowRuntimePageIndex(active.id), preserveFlowSource: isFlowSourceSelected(active.id),
        });
    },
});

// Snapshot existing semantic selection only; never focus, commit, reflow or navigate.
function readStudioAIState() {
    if (!canReadSharedStudio()) return {room:'unavailable',workIdentity:null,blocks:[],projectAssets:[],busy:true};
    // getActiveBlock() repairs invalid indices by dispatching; tools must not do so.
    const group = Number.isInteger(state.activeBlockIdx) ? state.blocks?.[state.activeBlockIdx] : null;
    const languageKey = state.activeLang || state.defaultLang;
    const session = _flowDirectEditSession, proxy = _flowDirectEditProxy;
    const busy = Boolean(editorDragBlocked(false) || _editorFlowProjectionController || _flowAuthoringReflowTimer
        || proxy?.dataset.flowReflowPending === 'true'
        || (session && proxy?.isConnected && proxy.value !== session.expectedText));
    let selection = _flowTextSelection;
    if (!selection && !busy && group?.kind === 'flow' && session?.groupId === group.id
        && session.languageKey === languageKey && proxy?.isConnected) {
        const block = group.flow.document.sections.find(s => s.id === session.sectionId)?.blocks.find(b => b.id === session.blockId);
        if (block?.texts?.[languageKey] === session.expectedText) {
            const point = offset => ({ sectionId: session.sectionId, blockId: session.blockId,
                languageKey, utf16Offset: offset });
            selection = createFlowTextSelection(group, point(proxy.selectionStart), point(proxy.selectionEnd));
        }
    }
    return { room: getCurrentRoom(), workIdentity: getProjectSessionIdentity(), blocks: state.blocks,
        languageKeys: state.languages, languageKey, sourceLanguage: group?.flow?.document?.sourceLanguage || state.defaultLang,
        projectAssets: state.projectAssets, activeBlockId: group?.id || null,
        activeFlowPageIndex: group?.kind === 'flow' ? getSelectedFlowRuntimePageIndex(group.id) : null,
        book: state.book, bookMode: state.bookMode,
        activeGroupId: group?.kind === 'flow' ? group.id : null, selection, busy };
}

// Pasted image bytes share the same WebP conversion and image-page command as imported assets.
let imagePasteStatusTimer;
function showImagePasteStatus(code) {
    let note = document.getElementById('image-paste-status');
    if (!note) { note = document.createElement('div'); note.id = 'image-paste-status'; note.setAttribute('role', 'status'); document.body.append(note); }
    const messages = {
        converting: ['画像をWebPに変換中…', 'Converting image to WebP…'],
        added: ['画像ページを追加しました。元に戻す操作で取り消せます。', 'Image page added. Undo is available.'],
        busy: ['入力・組版・画像取り込みの完了後に貼り付けてください。', 'Wait for editing, layout or image import to finish.'],
        cancelled: ['編集対象が変わったため、画像の追加を中止しました。貼り付け直してください。', 'The editor changed. Image import was cancelled; paste again.'],
        invalid: ['画像を1〜20枚指定してください。', 'Choose 1–20 images.'],
        empty: ['クリップボードに画像がありません。画像自体をコピーしてください。', 'No image on the clipboard. Copy the image itself.'],
        clipboard: ['画像をコピーして、本文ページ上でCtrl+V（Macは⌘V）を押してください。', 'Copy an image, then press Ctrl+V (⌘V on Mac) over the page.'],
        failed: ['画像を取り込めませんでした。形式と容量を確認してください。', 'Could not import the image. Check its format and size.'],
    };
    note.textContent = (messages[code] || messages.failed)[getUILang() === 'en' ? 1 : 0];
    note.hidden = false; clearTimeout(imagePasteStatusTimer);
    if (code !== 'converting') imagePasteStatusTimer = setTimeout(() => { note.hidden = true; }, 7000);
}
const imagePageImporter = createImagePageImporter({ readState: readStudioAIState, prepareImage: prepareAuthoringImage,
    discardImage: discardPreparedAuthoringImage, applyImagePage: result => applyEditorSpineChange(result), onStatus: showImagePasteStatus });
const recoveryUI=installSharedRecoveryUI({vault:sharedDraftRecovery,getUid:()=>firebaseAuth.currentUser?.uid===state.uid?state.uid:null,getLocale:getUILang});
installSharedStudioUI({getUILang,openRecovery:()=>recoveryUI.open(),checkAccess:checkSharedStudioAccess,lockAction:action=>sharedStudioLockAction(action,()=>{resetFlowRuntimeForProjectChange({keepSession:true});clearHistory();refresh();})});
window.addEventListener('shared-studio-unavailable',()=>{
    clearHistory();resetFlowRuntimeForProjectChange({keepSession:true});queueMicrotask(()=>refresh());
});
window.pasteImagePage = installImagePagePaste({ importer: imagePageImporter,
    inEditor: () => getCurrentRoom() === 'editor' && canEditSharedStudio(), onStatus: showImagePasteStatus });

installStudioPwa({getLocale:getUILang,updateBlocked:()=>{
    if(isLocalDraft())return localDraftStatus.read().dirty;
    if(!state.projectId&&!readSharedStudioAccess())return false;
    return !getEditorSaveStatus().cloudCurrent;
}});
installHomeStart({root:document.getElementById('home-room'),getLocale:getUILang,readState:()=>state,readShared:readSharedStudioAccess,onResume:()=>window.switchRoom('editor'),onConnectivity:()=>{if(getCurrentRoom()==='home')void renderHomeDashboard({refreshSpaces:navigator.onLine});}});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&isLocalDraft())void flushPendingSave().catch(()=>{});});

const locationNote=document.createElement('span');locationNote.id='authoring-location-status';document.querySelector('#project-title')?.after(locationNote);
const localFileNote=document.createElement('span');localFileNote.id='local-dsp-status';localFileNote.setAttribute('role','status');localFileNote.style.cssText='font-size:12px;margin-inline:8px';document.querySelector('#project-title')?.after(localFileNote);
const syncLocalFileNote=()=>{const en=getUILang()==='en';locationNote.textContent=!state.projectId?(en?'Creating on this device':'この端末で制作中'):(isLocalDraft()?(en?'Cloud save needs confirmation':'クラウド保存の確認が必要'):(en?'Cloud manuscript':'クラウドの原稿'));document.querySelectorAll('[data-authoring-save]').forEach(b=>{b.title=isLocalDraft()?(en?'Save DSP file':'DSPファイルを保存'):(en?'Save to cloud':'クラウド保存');});localFileNote.hidden=!isLocalDraft();localFileNote.textContent=localDraftStatus.read().dirty?(getUILang()==='en'?'DSP file: unsaved changes':'DSPファイル：未保存の変更あり'):(localDraftStatus.read().fileSaved?(getUILang()==='en'?'DSP file: saved':'DSPファイル：保存済み'):(getUILang()==='en'?'DSP file: not saved':'DSPファイル：未保存'));};
window.addEventListener('local-draft-status',syncLocalFileNote);document.addEventListener('studio-ui-language-change',syncLocalFileNote);syncLocalFileNote();

window.addEventListener('local-recents-updated',()=>{
    if(document.getElementById('project-settings-modal')?.style.display==='flex')void refreshEditorCopyDelete();
    if(getCurrentRoom()!=='home')return;
    void refreshRecentWorks();
    const revision=homeDashboardRenderRevision,uid=state.uid;
    void listLocalRecentProjects().then(projects=>{if(getCurrentRoom()==='home'&&revision===homeDashboardRenderRevision&&uid===state.uid)renderHomeLocalProjects(document.getElementById('home-local-grid'),document.getElementById('home-local-count'),projects);}).catch(()=>{});
});

// Protected versions are independent of the recent-12 list and the cloud trash.

subscribeProjectSession(()=>{protectedDialog?.close();protectedDialog=null;queueMicrotask(()=>void refreshProtectedCopies());});
async function openProtectedCopy(id){
    const epoch=getProjectSessionEpoch(),uid=firebaseAuth.currentUser?.uid||'';
    const current=()=>epoch===getProjectSessionEpoch()&&uid===(firebaseAuth.currentUser?.uid||'');
    const kept=await safeResume.read(id);if(!current())throw Error('RESUME_SCOPE_CHANGED');
    protectedDialog?.close();
    protectedDialog=showSafeResume({name:kept.name,locale:getUILang(),compare:()=>safeResume.compare(id),
        onFork:async()=>{
            if(!current())throw Error('RESUME_SCOPE_CHANGED');await flushBeforeSafeResume();
            if(!current())throw Error('RESUME_SCOPE_CHANGED');const copy=await safeResume.fork(id);
            if(!current())throw Error('RESUME_SCOPE_CHANGED');
            const loaded=hydrateProjectFromPersistence(await loadLocalRecentProject(localRecentId(copy)));
            if(!current())throw Error('RESUME_SCOPE_CHANGED');
            resetFlowRuntimeForProjectChange();clearHistory();dispatch({type:actionTypes.LOAD_PROJECT,payload:loaded});
            noteLocalDraftEdit();refresh();updateAuthUI();triggerAutoSave();window.switchRoom('editor');
        },
        onCloud:kept.projectId&&uid&&kept.sourceOwner===uid&&navigator.onLine?async()=>{
            if(!current())throw Error('RESUME_SCOPE_CHANGED');
            if(!await onLoadProject(kept.projectId))throw Error('RESUME_LOAD_FAILED');window.switchRoom('editor');
        }:null});
}
async function refreshProtectedCopies(){
    const host=document.getElementById('home-protected-copies'),button=document.getElementById('editor-resume-copy');
    const en=getUILang()==='en';
    if(button){button.hidden=!isCloudResumeBlocked();button.textContent=en?'Review browser version':'端末版を確認';}
    if(!host)return;const revision=++protectedListRevision,uid=firebaseAuth.currentUser?.uid||'';
    try{const rows=await safeResume.list();if(revision!==protectedListRevision||uid!==(firebaseAuth.currentUser?.uid||''))return;
        const expanded=!!host.querySelector('details')?.open;host.replaceChildren();if(!rows.length)return;
        const node=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;return e;};
        const details=node('details',''),summary=node('summary',(en?'Protected browser versions':'保護した端末版')+' ('+rows.length+')');details.open=expanded;details.append(summary);
        details.append(node('p',en?'Kept on this browser until you delete them. Separate from the cloud trash.':'このブラウザーに、削除するまで保持します。クラウドのゴミ箱とは別です。'));
        for(const r of rows){const card=node('article',''),name=node('strong',r.name),date=node('span',new Date(r.createdAt).toLocaleString(en?'en':'ja'));
            const open=node('button',en?'Compare / resume':'比較して再開');open.type='button';open.className='home-action-btn';open.onclick=()=>void openProtectedCopy(r.id).catch(()=>alert(en?'This version is unavailable.':'この端末版を開けませんでした。'));
            const remove=node('button',en?'Delete':'削除');remove.type='button';remove.className='home-action-btn';remove.onclick=async()=>{
                if(!confirm(en?'Delete this protected browser version? The cloud manuscript is unchanged.':'この保護した端末版を削除しますか？ クラウドの原稿は変わりません。'))return;
                remove.disabled=true;try{const token=await safeResume.remove(r.id);await refreshProtectedCopies();
                    if(token)showLocalCopyUndo({host:document.getElementById('home-local-copy-feedback'),name:r.name,en,restore:async()=>{await safeResume.restore(token);await refreshProtectedCopies();}});
                }catch{remove.disabled=false;alert(en?'Could not delete this version.':'この端末版を削除できませんでした。');}
            };card.append(name,date,open,remove);details.append(card);
        }host.append(details);
    }catch{if(revision===protectedListRevision)host.textContent=en?'Could not read protected browser versions.':'保護した端末版を読み込めませんでした。';}
}
document.getElementById('editor-resume-copy')?.addEventListener('click',async()=>{
    try{await flushBeforeSafeResume();
        const kept=await protectCloudBrowserCopy(state.projectId);if(!kept)throw Error('LOCAL_COPY_MISSING');await openProtectedCopy(kept.id);
    }catch{alert(getUILang()==='en'?'Could not protect this version. Save a DSP file first.':'端末版を保護できませんでした。先にDSPファイルへ保存してください。');}
});
window.addEventListener('safe-resume-change',()=>void refreshProtectedCopies());
window.addEventListener('local-recents-updated',()=>void refreshProtectedCopies());
window.addEventListener('home-start-refresh',()=>void refreshProtectedCopies());
document.addEventListener('studio-ui-language-change',()=>void refreshProtectedCopies());

window.addEventListener('shared-recovery-account',()=>{protectedDialog?.close();protectedDialog=null;void refreshProtectedCopies();});

const dspFileSession=createDspFileSession({
    readScope:()=>JSON.stringify([getProjectSessionEpoch(),state.projectId,state.uid,!!readSharedStudioAccess()]),
    canBind:()=>!state.projectId&&!readSharedStudioAccess(),
    onChange:()=>window.dispatchEvent(new Event('dsp-file-change'))
});
subscribeProjectSession(()=>dspFileSession.clear());
window.addEventListener('dsp-file-change',()=>{syncLocalFileNote();if(dspFileSession.read().name)localFileNote.textContent+=' · '+dspFileSession.read().name;});
const appendDspFilename=()=>{if(dspFileSession.read().name)localFileNote.textContent+=' · '+dspFileSession.read().name;};
window.addEventListener('local-draft-status',appendDspFilename);
document.addEventListener('studio-ui-language-change',appendDspFilename);
window.openDspInput=async event=>{try{await studioBootReady;await window.importDSP(event,{external:true});}catch(error){alert(dspOpenErrorMessage(error,getUILang()==='en'));}finally{if(event.target)event.target.value='';}};
window.openDSP=async()=>{
    try{
        assertExternalDspOpenReady();
        if(typeof window.showOpenFilePicker!=='function'){document.getElementById('dsp-upload').click();return;}
        const [handle]=await window.showOpenFilePicker({types:DSP_FILE_TYPES,multiple:false,excludeAcceptAllOption:true});
        await studioBootReady;
        const file=await handle.getFile();
        await window.importDSP({target:{files:[file],value:''}},{external:true,handle});
    }catch(error){if(error.name!=='AbortError')alert(dspOpenErrorMessage(error,getUILang()==='en'));}
};
document.addEventListener('keydown',event=>{
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'&&getCurrentRoom()==='editor'){
        event.preventDefault();event.stopImmediatePropagation();
        if(document.querySelector('dialog[open]'))return;
        void (event.shiftKey?window.exportDSP():window.saveProject()).catch(error=>alert(error.message));
    }
},{capture:true});
// DSP contains canonical authoring data; preview pagination is not an authoring lock.
// A cancelled preview may leave flowReflowPending on a connected, hidden proxy.
function readDspOpenBlockReason() {
    if(dspSaveBusy)return 'saving';
    if(openingProject)return 'opening';
    if(editorDragBlocked(false))return 'editing';
    if(_flowDirectEditSession && _flowDirectEditProxy?.isConnected
        && _flowDirectEditProxy.value!==_flowDirectEditSession.expectedText)return 'uncommitted';
    return '';
}
// Incoming files require an explicit Open action and never replace unsaved work.
function assertExternalDspOpenReady() {
    assertPersonalStudioOperation();
    const reason=readDspOpenBlockReason();
    if(reason)throw Object.assign(Error('busy'),{reason});
    if(isLocalDraft() ? localDraftStatus.read().dirty : state.projectId && !getEditorSaveStatus().cloudCurrent)throw Error('unsaved');
}
installFileLaunch({extension:'.dsp',getLocale:getUILang,beforeOpen:async()=>{
    try{await studioBootReady;}catch{throw Error('not-ready');}
    assertExternalDspOpenReady();
},openFile:async (file,handle)=>{
    assertExternalDspOpenReady();
    await window.importDSP({target:{files:[file],value:''}},{external:true,handle});
}});
