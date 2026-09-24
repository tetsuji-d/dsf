import {auth} from './firebase-core.js';
import {onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {createAccountNotifications} from './account-notifications.js';
// Independent of GIS/feed loading: the bell responds even while those are pending.
const inbox=createAccountNotifications({getUser:()=>auth.currentUser});
onAuthStateChanged(auth,()=>inbox.update());
