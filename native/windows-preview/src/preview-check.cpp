#include <windows.h>
#include <shobjidl.h>
#include <shlwapi.h>
#include <cstdio>
#include <stdexcept>

static const CLSID clsid={0xdae45ce1,0x7334,0x4911,{0xae,0x3a,0x79,0x61,0xa4,0xe7,0x38,0x9d}};
static void need(bool ok,const char* message){if(!ok)throw std::runtime_error(message);}
int wmain(int argc,wchar_t** argv){
    if(argc!=4){fputs("Usage: dsf-preview-check provider.dll input.dsf --check|--show|--surrogate\n",stderr);return 2;}
    // Match Explorer's per-monitor-aware host before creating a parent window.
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    if(FAILED(CoInitializeEx(nullptr,COINIT_APARTMENTTHREADED)))return 3;
    HMODULE dll=nullptr;IClassFactory* factory=nullptr;IPreviewHandler* preview=nullptr;
    IInitializeWithStream* init=nullptr;IOleWindow* ole=nullptr;IPreviewHandlerVisuals* visuals=nullptr;
    IObjectWithSite* site=nullptr;IStream* stream=nullptr;HWND parent=nullptr;int result=0;
    const bool show=!wcscmp(argv[3],L"--show"), surrogate=!wcsncmp(argv[3],L"--surrogate",11);
    try{
        if(surrogate){
            CLSID target=clsid;
            if(argv[3][11]==L':')need(SUCCEEDED(CLSIDFromString(argv[3]+12,&target)),"INVALID_TEST_CLASS");
            HRESULT hr=CoCreateInstance(target,nullptr,CLSCTX_LOCAL_SERVER,IID_PPV_ARGS(&preview));
            fprintf(stderr,"Preview surrogate activation: 0x%08lx\n",static_cast<unsigned long>(hr));
            need(SUCCEEDED(hr),"SURROGATE_FAILED");
        }else{
            dll=LoadLibraryExW(argv[1],nullptr,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_SYSTEM32);
            need(dll!=nullptr,"DLL_LOAD_FAILED");
            auto getClass=reinterpret_cast<HRESULT(__stdcall*)(REFCLSID,REFIID,void**)>(GetProcAddress(dll,"DllGetClassObject"));
            need(getClass && SUCCEEDED(getClass(clsid,IID_PPV_ARGS(&factory))),"FACTORY_FAILED");
            need(SUCCEEDED(factory->CreateInstance(nullptr,IID_PPV_ARGS(&preview))),"PREVIEW_CREATE_FAILED");
        }
        need(SUCCEEDED(preview->QueryInterface(IID_PPV_ARGS(&init))),"INIT_INTERFACE");
        need(SUCCEEDED(preview->QueryInterface(IID_PPV_ARGS(&ole))),"WINDOW_INTERFACE");
        need(SUCCEEDED(preview->QueryInterface(IID_PPV_ARGS(&visuals))),"VISUAL_INTERFACE");
        need(SUCCEEDED(preview->QueryInterface(IID_PPV_ARGS(&site))),"SITE_INTERFACE");
        parent=CreateWindowExW(0,L"STATIC",L"DSF 表紙プレビューの確認",WS_OVERLAPPEDWINDOW,100,100,560,800,nullptr,nullptr,GetModuleHandleW(nullptr),nullptr);
        need(parent!=nullptr,"HOST_WINDOW");
        need(preview->DoPreview()==E_UNEXPECTED,"REQUIRES_INITIALIZATION");
        // A marshalled call may reject the null reference before it reaches the provider.
        need(FAILED(preview->SetRect(nullptr)),"NULL_RECT");
        RECT rect{12,12,480,700};need(SUCCEEDED(preview->SetWindow(parent,&rect)),"SET_WINDOW");
        need(SUCCEEDED(SHCreateStreamOnFileEx(argv[2],STGM_READ|STGM_SHARE_DENY_WRITE,0,FALSE,nullptr,&stream)),"INPUT_STREAM");
        need(init->Initialize(stream,STGM_READWRITE)==STG_E_ACCESSDENIED,"READ_ONLY");
        need(SUCCEEDED(init->Initialize(stream,STGM_READ)),"INITIALIZE");
        need(FAILED(init->Initialize(stream,STGM_READ)),"DUPLICATE_INIT");
        stream->Release();stream=nullptr;
        need(SUCCEEDED(preview->DoPreview()),"DO_PREVIEW");
        need(SUCCEEDED(preview->DoPreview()),"REPEAT_PREVIEW");
        HWND child=nullptr;need(SUCCEEDED(ole->GetWindow(&child)) && IsWindow(child),"PREVIEW_WINDOW");
        wchar_t caption[512]{};GetWindowTextW(child,caption,512);
        char utf8[2048]{};WideCharToMultiByte(CP_UTF8,0,caption,-1,utf8,sizeof(utf8),nullptr,nullptr);
        printf("PANE_TEXT: %s\n",utf8);
        // The preview must not retain a source-file lock after decoding.
        HANDLE exclusive=CreateFileW(argv[2],GENERIC_READ,0,nullptr,OPEN_EXISTING,FILE_ATTRIBUTE_NORMAL,nullptr);
        need(exclusive!=INVALID_HANDLE_VALUE,"SOURCE_LOCK_RELEASED");CloseHandle(exclusive);
        RECT resized{5,8,325,408};need(SUCCEEDED(preview->SetRect(&resized)),"RESIZE");
        // The system preview host can have a different DPI context from this test host.
        auto previousDpi=SetThreadDpiAwarenessContext(GetWindowDpiAwarenessContext(child));
        RECT actual{};GetClientRect(child,&actual);
        if(previousDpi)SetThreadDpiAwarenessContext(previousDpi);
        fprintf(stderr,"Resized preview: %ld x %ld\n",actual.right,actual.bottom);
        need(actual.right==320 && actual.bottom==400,"RESIZE_BOUNDS");
        RECT tiny{0,0,1,1};need(SUCCEEDED(preview->SetRect(&tiny)),"TINY_PANE");
        need(SUCCEEDED(preview->SetRect(&rect)),"RESTORE_BOUNDS");
        need(SUCCEEDED(visuals->SetBackgroundColor(RGB(255,255,255))) && SUCCEEDED(visuals->SetTextColor(RGB(20,30,45))),"COLORS");
        LOGFONTW font{};font.lfHeight=-18;wcscpy_s(font.lfFaceName,L"Yu Gothic UI");
        need(SUCCEEDED(visuals->SetFont(&font)),"FONT");
        if(show || surrogate){
            ShowWindow(parent,SW_SHOW);UpdateWindow(parent);
            const ULONGLONG until=GetTickCount64()+(show?120000:1000);
            MSG msg{};while(IsWindow(parent) && GetTickCount64()<until){
                while(PeekMessageW(&msg,nullptr,0,0,PM_REMOVE)){TranslateMessage(&msg);DispatchMessageW(&msg);}
                MsgWaitForMultipleObjects(0,nullptr,FALSE,50,QS_ALLINPUT);
            }
        }
        need(SUCCEEDED(preview->Unload()),"UNLOAD");
        need(!IsWindow(child),"WINDOW_RELEASED");
        need(preview->DoPreview()==E_UNEXPECTED,"REINIT_REQUIRED");
        need(SUCCEEDED(preview->Unload()),"REPEAT_UNLOAD");
        // Same COM instance can be reused by the host for another selection.
        need(SUCCEEDED(SHCreateStreamOnFileEx(argv[2],STGM_READ|STGM_SHARE_DENY_WRITE,0,FALSE,nullptr,&stream)),"REOPEN");
        need(SUCCEEDED(init->Initialize(stream,STGM_READ)),"REINITIALIZE");
        stream->Release();stream=nullptr;
        need(SUCCEEDED(preview->SetWindow(parent,&rect)) && SUCCEEDED(preview->DoPreview()),"REUSED_INSTANCE");
        preview->Unload();puts("PREVIEW_LIFECYCLE_OK");
    }catch(const std::exception& e){fprintf(stderr,"%s\n",e.what());result=1;}
    if(preview)preview->Unload();if(parent && IsWindow(parent))DestroyWindow(parent);
    if(stream)stream->Release();if(site)site->Release();if(visuals)visuals->Release();if(ole)ole->Release();if(init)init->Release();
    if(preview)preview->Release();if(factory)factory->Release();
    if(dll){
        auto unload=reinterpret_cast<HRESULT(__stdcall*)()>(GetProcAddress(dll,"DllCanUnloadNow"));
        if(!unload || unload()!=S_OK){fputs("DLL_STILL_REFERENCED\n",stderr);result=1;}
        FreeLibrary(dll);
    }
    CoUninitialize();return result;
}
