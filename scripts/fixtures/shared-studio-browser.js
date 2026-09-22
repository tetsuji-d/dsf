// Imported only by the loopback-only shared Studio fixture, never by studio.html.
import '../../js/app.js';
import {state,dispatch,actionTypes} from '../../js/state.js';
import * as persistence from '../../js/firebase.js';
import * as history from '../../js/history.js';
import {get} from 'idb-keyval';
window.fixtureStudio={state,dispatch,actionTypes,persistence,history,getBackup:()=>get('dsf_autosave')};
