import assert from 'node:assert/strict';
import {canAccessPublishingSpace as can,canManageSpaceMember,visibleSpaceWorks,describeAccessChange,validSpaceMember} from '../js/publishing-space-access.js';
const space={id:'s1',ownerUid:'owner'},work={id:'w1',spaceId:'s1',labelId:'l1'};
const ctx=(grants, extra={})=>({space,actorUid:'u1',member:{uid:'u1',spaceId:'s1',status:'active',role:'member',grants,...extra}});
const grant=(role,scope,targetId)=>({role,scope,...(targetId?{targetId}:{})});
const viewer=ctx([grant('viewer','work','w1')]),editor=ctx([grant('editor','label','l1')]);
const owner={space,actorUid:'owner'},admin=ctx([],{role:'admin'});
assert(can(viewer,'readWork',work));assert(!can(viewer,'editWork',work));assert(!can(viewer,'readWork',{...work,id:'w2'}));
assert(can(editor,'editWork',work));assert(can(editor,'editWork',{...work,id:'future-work'}));
assert(!can(editor,'readWork',{...work,labelId:'l2'}));assert(!can(editor,'readWork',{...work,spaceId:'s2'}));
assert(can(editor,'createWork',{spaceId:'s1',labelId:'l1'}));assert(!can(editor,'createWork',{spaceId:'s1'}));
assert(!can(ctx([grant('editor','work','w1')]),'createWork',work));
const mixed=ctx([grant('viewer','space'),grant('editor','work','w1')]);
assert(can(mixed,'editWork',work));assert(!can(mixed,'editWork',{...work,id:'w2'}));assert(can(mixed,'readWork',{...work,id:'w2'}));
for(const action of ['publishWork','moveWork','manageSpace','manageMembers']){assert(!can(editor,action,work));assert(can(admin,action,work));assert(can(owner,action,work));}
for(const action of ['billing','deleteSpace','transferOwnership','manageAdmins']){assert(!can(admin,action));assert(can(owner,action));}
for(const context of [{...editor,actorUid:'other'},ctx(editor.member.grants,{status:'revoked'}),ctx(editor.member.grants,{spaceId:'s2'}),ctx([{role:'owner',scope:'space'}]),ctx([{role:'editor',scope:'work'}]),ctx([{role:'editor',scope:'unknown'}]),ctx([{role:'editor',scope:'space',targetId:'w1'}]),ctx([]),ctx(editor.member.grants,{role:'owner'}),{space,actorUid:''}]) assert(!can(context,'readWork',work));
assert(!can(null,'readWork',work));assert(!canManageSpaceMember(null,null,viewer.member));
assert(!can(owner,'unknown',work));assert(!can(owner,'editWork',null));assert(!can(owner,'editWork',{...work,spaceId:'s2'}));
assert.deepEqual(visibleSpaceWorks(viewer,[work,{...work,id:'secret'},{...work,spaceId:'s2'}]),[work]);
assert.deepEqual(describeAccessChange(viewer,editor,[work,{...work,id:'w2'}]),[{workId:'w1',from:'viewer',to:'editor'},{workId:'w2',from:'none',to:'editor'}]);
const target={...viewer.member,uid:'target'};
assert(canManageSpaceMember(owner,null,target));assert(canManageSpaceMember(admin,null,target));
assert(!canManageSpaceMember(admin,null,{...target,role:'admin',grants:[]}));assert(!canManageSpaceMember(admin,{...target,role:'admin',grants:[]},target));
assert(!canManageSpaceMember(admin,{...target,role:'admin',grants:[]},null));assert(!canManageSpaceMember(owner,null,{...target,uid:'owner'}));
assert(!canManageSpaceMember(editor,null,target));assert(!canManageSpaceMember(owner,{...target,spaceId:'other'},null));
assert(!validSpaceMember({...target,grants:Array(101).fill(grant('viewer','space'))},'s1'));
console.log('Scoped access: role matrix, label inheritance, per-work scope, overlaps, revocation, cross-space/identity rejection, filtering and member-management escalation checks passed.');
