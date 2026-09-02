import { doc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { createProjectSummaryForPatch } from './project-summary.js';

export function projectSummaryDocRef(db, uid, projectId) {
    if (!uid || !projectId) throw new TypeError('Project summary reference requires uid and projectId.');
    return doc(db, 'users', uid, 'project_summaries', projectId);
}

export function stageProjectSummaryWrite(batch, db, uid, projectId, currentProject, projectPatch, options = {}) {
    if (!batch || typeof batch.set !== 'function') throw new TypeError('Project summary write requires a Firestore batch.');
    const summary = createProjectSummaryForPatch(currentProject, projectPatch, {
        ...options,
        projectId,
    });
    batch.set(projectSummaryDocRef(db, uid, projectId), summary);
    return summary;
}

export function stageProjectSummaryDelete(batch, db, uid, projectId) {
    if (!batch || typeof batch.delete !== 'function') throw new TypeError('Project summary delete requires a Firestore batch.');
    batch.delete(projectSummaryDocRef(db, uid, projectId));
}
