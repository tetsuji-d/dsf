import assert from 'node:assert/strict';
import {formatEditorPreviewFailure, selectEditorPreviewLanguages} from '../js/editor-preview-diagnostics.js';
const project={activeLang:'ja',defaultLang:'ja',languages:['ja','en-GB'],blocks:[{kind:'image',id:'image'},{kind:'flow',id:'flow'}]};
assert.deepEqual(selectEditorPreviewLanguages(project),['ja']);
assert.deepEqual(selectEditorPreviewLanguages({...project,activeLang:'en-GB'}),['en-GB']);
const error={previewIssues:[{code:'FLOW_PUBLICATION_TRANSLATION_NOT_READY',groupId:'flow',message:'token=SECRET',details:{url:'https://secret'}}]};
for(const en of [false,true]){
 const output=formatEditorPreviewFailure(error,{project,language:'en-GB',en});
 assert.ok(output.includes('EN-GB'));
 assert.ok(output.includes(en?'Flow manuscript 1':'Flow原稿 1'));
 assert.ok(output.includes(en?'Translation is missing':'翻訳が未作成'));
 assert.ok(!output.includes('SECRET'));
 const unsafe=formatEditorPreviewFailure({issues:[{code:'UNKNOWN_SECRET',message:'token=SECRET',groupId:'https://secret'}]},{project,language:'<script>SECRET',en});
 assert.ok(!unsafe.includes('SECRET'));assert.ok(!unsafe.includes('https://'));
 assert.ok(formatEditorPreviewFailure(new Error('PREVIEW_CHANGED'),{project,language:'ja',en}).includes(en?'changed':'変更'));
}
console.log('Preview language selection and redacted JA/EN diagnostics passed');
