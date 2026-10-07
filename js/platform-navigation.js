// Await recovery checks before leaving; concurrent clicks cannot bypass them.
export function createPlatformNavigator({beforeNavigate=()=>true,assign=href=>location.assign(href),onError=error=>console.error('Platform navigation blocked',error)}) {
    let pending=false;
    return async href=>{
        if(pending)return false;
        pending=true;
        try{
            if(await beforeNavigate(href)!==true)return false;
            assign(href);return true;
        }catch(error){onError(error);return false;}
        finally{pending=false;}
    };
}
