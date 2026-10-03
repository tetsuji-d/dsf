// Update-only permission to replay the exact startup backup. Never evidence of cloud/DSP saving.
export function createRestoredReloadGuard({read,readBackup,readAsset}) {
    let restored=null,verified=null;
    function hasAssetMappings(value,map){
        if(typeof value==='string')return !value.startsWith('blob:') || typeof map[value]==='string';
        if(value&&typeof value==='object')return Object.values(value).every(child=>hasAssetMappings(child,map));
        return true;
    }
    const signature=value=>JSON.stringify([value.identity,value.checkpoint]);
    function eligible(){const value=read();return !!restored && value.local && !value.shared && value.status==='restored' && !value.busy && signature(value)===restored.signature;}
    return {
        remember(backup){restored={signature:signature(read()),backup:JSON.stringify(backup),assets:Object.values(backup.imageMap||{}),mapped:hasAssetMappings(backup.state,backup.imageMap||{})};verified=null;},
        eligible,
        async verify(){
            verified=null;
            if(!eligible())throw Error('RECOVERY_UNCONFIRMED');
            const expected=restored;
            if(!expected.mapped)throw Error('RECOVERY_UNCONFIRMED');
            const backup=await readBackup();
            if(JSON.stringify(backup)!==expected.backup)throw Error('RECOVERY_UNCONFIRMED');
            for(const id of new Set(expected.assets)){
                const asset=await readAsset(id);
                if(!(asset instanceof Blob)||!asset.size)throw Error('RECOVERY_UNCONFIRMED');
            }
            if(JSON.stringify(await readBackup())!==expected.backup)throw Error('RECOVERY_UNCONFIRMED');
            if(restored!==expected||!eligible())throw Error('UNSAVED_CHANGES');
            verified=expected.signature;
        },
        permit(){return eligible() && verified===signature(read());},
    };
}
