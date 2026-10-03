#include "archive.hpp"
#include <shobjidl.h>
#include <commctrl.h>
#include <algorithm>
#include <cstring>
#include <new>

// A separate, read-only cover pane. Existing thumbnail registration is untouched.
const CLSID CLSID_DsfCoverPreview = {0xdae45ce1,0x7334,0x4911,{0xae,0x3a,0x79,0x61,0xa4,0xe7,0x38,0x9d}};
const CLSID CLSID_DsfCoverPreviewTest = {0xa502f180,0x21af,0x4762,{0x99,0xb7,0x7b,0x3d,0x91,0x2a,0x57,0xfd}};
static LONG objects = 0, locks = 0;
class Preview final : public IPreviewHandler, public IInitializeWithStream,
                      public IObjectWithSite, public IOleWindow, public IPreviewHandlerVisuals {
    LONG refs = 1;
    IStream* stream = nullptr;
    IUnknown* site = nullptr;
    IPreviewHandlerFrame* frame = nullptr;
    HWND parent = nullptr, pane = nullptr;
    RECT bounds{};
    HBITMAP bitmap = nullptr;
    HFONT font = nullptr;
    COLORREF background = GetSysColor(COLOR_WINDOW), foreground = GetSysColor(COLOR_WINDOWTEXT);
    const wchar_t* heading = L"表紙プレビュー";
    const wchar_t* message = L"";

    static LRESULT CALLBACK procedure(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp, UINT_PTR, DWORD_PTR data) {
        auto self = reinterpret_cast<Preview*>(data);
        if (msg == WM_PAINT) { self->paint(); return 0; }
        if (msg == WM_ERASEBKGND) return 1;
        if (msg == WM_SIZE) InvalidateRect(hwnd, nullptr, FALSE);
        if (msg == WM_NCDESTROY) { RemoveWindowSubclass(hwnd, procedure, 1); self->pane = nullptr; }
        return DefSubclassProc(hwnd, msg, wp, lp);
    }
    void paint() {
        PAINTSTRUCT ps{}; HDC dc = BeginPaint(pane, &ps);
        RECT area{}; GetClientRect(pane, &area);
        HBRUSH brush = CreateSolidBrush(background); FillRect(dc, &area, brush); DeleteObject(brush);
        const int dpi = GetDeviceCaps(dc, LOGPIXELSY);
        const LONG margin = MulDiv(16, dpi, 96), line = MulDiv(28, dpi, 96);
        auto oldFont = SelectObject(dc, font ? font : GetStockObject(DEFAULT_GUI_FONT));
        SetBkMode(dc, TRANSPARENT); ::SetTextColor(dc, foreground);
        RECT title{margin, margin, std::max(margin, area.right-margin), margin+line};
        DrawTextW(dc, heading, -1, &title, DT_CENTER|DT_SINGLELINE|DT_END_ELLIPSIS|DT_NOPREFIX);
        RECT body{margin, margin+line+margin/2, std::max(margin, area.right-margin), std::max(margin+line, area.bottom-margin-line*2)};
        if (bitmap && body.right > body.left && body.bottom > body.top) {
            BITMAP info{}; GetObject(bitmap, sizeof(info), &info);
            double scale = std::min({1.0, double(body.right-body.left)/info.bmWidth, double(body.bottom-body.top)/info.bmHeight});
            int w = std::max(1, int(info.bmWidth*scale)), h = std::max(1, int(info.bmHeight*scale));
            HDC source = CreateCompatibleDC(dc); auto old = SelectObject(source, bitmap);
            BLENDFUNCTION blend{AC_SRC_OVER,0,255,AC_SRC_ALPHA};
            AlphaBlend(dc, body.left+(body.right-body.left-w)/2, body.top+(body.bottom-body.top-h)/2, w,h,
                       source,0,0,info.bmWidth,info.bmHeight,blend);
            SelectObject(source,old); DeleteDC(source);
        } else if (!bitmap) {
            DrawTextW(dc,message,-1,&body,DT_CENTER|DT_WORDBREAK|DT_NOPREFIX);
        }
        RECT footer{margin, std::max(body.top,area.bottom-margin-line*2), std::max(margin,area.right-margin),area.bottom-margin};
        DrawTextW(dc,L"表紙のみの表示です。\n本文はDSF Studio / Viewerで開いてください。",-1,&footer,DT_CENTER|DT_WORDBREAK|DT_NOPREFIX);
        SelectObject(dc,oldFont); EndPaint(pane,&ps);
    }
    void resize() { if(pane) MoveWindow(pane,bounds.left,bounds.top,std::max(0L,bounds.right-bounds.left),std::max(0L,bounds.bottom-bounds.top),TRUE); }
    void invalidate() { if(pane) InvalidateRect(pane,nullptr,FALSE); }
public:
    Preview() { InterlockedIncrement(&objects); }
    ~Preview() { Unload(); SetSite(nullptr); if(font) DeleteObject(font); InterlockedDecrement(&objects); }
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id,void** out) override {
        if(!out) return E_POINTER; *out=nullptr;
        if(id==IID_IUnknown || id==__uuidof(IPreviewHandler)) *out=static_cast<IPreviewHandler*>(this);
        else if(id==__uuidof(IInitializeWithStream)) *out=static_cast<IInitializeWithStream*>(this);
        else if(id==IID_IObjectWithSite) *out=static_cast<IObjectWithSite*>(this);
        else if(id==IID_IOleWindow) *out=static_cast<IOleWindow*>(this);
        else if(id==__uuidof(IPreviewHandlerVisuals)) *out=static_cast<IPreviewHandlerVisuals*>(this);
        else return E_NOINTERFACE;
        AddRef(); return S_OK;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return InterlockedIncrement(&refs); }
    ULONG STDMETHODCALLTYPE Release() override { ULONG n=InterlockedDecrement(&refs); if(!n) delete this; return n; }
    HRESULT STDMETHODCALLTYPE Initialize(IStream* input,DWORD mode) override {
        if(stream || pane) return HRESULT_FROM_WIN32(ERROR_ALREADY_INITIALIZED);
        if(!input) return E_POINTER;
        if((mode&3)!=STGM_READ) return STG_E_ACCESSDENIED;
        stream=input; stream->AddRef(); return S_OK;
    }
    HRESULT STDMETHODCALLTYPE SetSite(IUnknown* input) override {
        if(input) input->AddRef();
        if(frame) {frame->Release();frame=nullptr;}
        if(site) site->Release(); site=input;
        if(site) site->QueryInterface(IID_PPV_ARGS(&frame));
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE GetSite(REFIID id,void** out) override {
        if(!out) return E_POINTER; *out=nullptr; return site?site->QueryInterface(id,out):E_FAIL;
    }
    HRESULT STDMETHODCALLTYPE GetWindow(HWND* out) override { if(!out)return E_POINTER; *out=pane; return pane?S_OK:E_FAIL; }
    HRESULT STDMETHODCALLTYPE ContextSensitiveHelp(BOOL) override { return E_NOTIMPL; }
    HRESULT STDMETHODCALLTYPE SetWindow(HWND input,const RECT* rect) override {
        if(!rect)return E_POINTER;
        if(!IsWindow(input) || rect->right<rect->left || rect->bottom<rect->top)return E_INVALIDARG;
        parent=input; bounds=*rect; if(pane)::SetParent(pane,parent); resize(); return S_OK;
    }
    HRESULT STDMETHODCALLTYPE SetRect(const RECT* rect) override {
        if(!rect)return E_POINTER;
        if(rect->right<rect->left || rect->bottom<rect->top)return E_INVALIDARG;
        bounds=*rect; resize(); return S_OK;
    }
    HRESULT STDMETHODCALLTYPE DoPreview() override {
        if(pane)return S_OK;
        if(!stream || !IsWindow(parent))return E_UNEXPECTED;
        heading=L"表紙プレビュー"; message=L"";
        try {
            auto cover=dsf::readCover(stream);
            bitmap=dsf::renderCover(cover,1024);
            heading=cover.path=="preview/cover.png"?L"DSP · 原稿の表紙":L"DSF · 作品の表紙";
        } catch(const std::bad_alloc&) {
            message=L"表示に必要なメモリを確保できませんでした。";
        } catch(const std::exception& error) {
            if(!strcmp(error.what(),"DSP_SNAPSHOT_REQUIRED"))
                message=L"このDSPには確認用の表紙画像がありません。\nDSF Studioで原稿を開いて確認してください。";
            else if(!strcmp(error.what(),"FIXED_TEXT_COVER_UNSUPPORTED"))
                message=L"この形式の表紙は、まだプレビューに対応していません。\nDSF Viewerで確認してください。";
            else message=L"表紙を表示できません。\n未対応の形式、またはファイルの整合性を確認できない状態です。\nDSF Studio / Viewerで確認してください。";
        } catch(...) { message=L"表紙を表示できません。DSF Studio / Viewerで確認してください。"; }
        // Decode once; release the read handle even while the pane stays open.
        stream->Release(); stream=nullptr;
        pane=CreateWindowExW(0,L"STATIC",bitmap?heading:message,WS_CHILD|WS_VISIBLE|WS_TABSTOP,
            bounds.left,bounds.top,std::max(0L,bounds.right-bounds.left),std::max(0L,bounds.bottom-bounds.top),parent,nullptr,GetModuleHandleW(nullptr),nullptr);
        if(!pane) {if(bitmap){DeleteObject(bitmap);bitmap=nullptr;}return E_FAIL;}
        if(!SetWindowSubclass(pane,procedure,1,reinterpret_cast<DWORD_PTR>(this))) {Unload();return E_FAIL;}
        invalidate(); return S_OK;
    }
    HRESULT STDMETHODCALLTYPE Unload() override {
        if(pane) {DestroyWindow(pane);pane=nullptr;}
        if(bitmap){DeleteObject(bitmap);bitmap=nullptr;}
        if(stream){stream->Release();stream=nullptr;}
        parent=nullptr; message=L""; return S_OK;
    }
    HRESULT STDMETHODCALLTYPE SetFocus() override {if(!pane)return E_FAIL; ::SetFocus(pane);return S_OK;}
    HRESULT STDMETHODCALLTYPE QueryFocus(HWND* out) override {if(!out)return E_POINTER; *out=::GetFocus();return S_OK;}
    HRESULT STDMETHODCALLTYPE TranslateAccelerator(MSG* msg) override {if(!msg)return E_POINTER; return frame?frame->TranslateAccelerator(msg):S_FALSE;}
    HRESULT STDMETHODCALLTYPE SetBackgroundColor(COLORREF color) override {background=color;invalidate();return S_OK;}
    HRESULT STDMETHODCALLTYPE SetTextColor(COLORREF color) override {foreground=color;invalidate();return S_OK;}
    HRESULT STDMETHODCALLTYPE SetFont(const LOGFONTW* value) override {
        if(!value)return E_POINTER; HFONT next=CreateFontIndirectW(value);if(!next)return E_OUTOFMEMORY;
        if(font)DeleteObject(font);font=next;invalidate();return S_OK;
    }
};
class Factory final:public IClassFactory {
    LONG refs=1;
public:
    Factory(){InterlockedIncrement(&objects);} ~Factory(){InterlockedDecrement(&objects);}
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id,void** out) override {
        if(!out)return E_POINTER;*out=nullptr;if(id!=IID_IUnknown && id!=IID_IClassFactory)return E_NOINTERFACE;
        *out=static_cast<IClassFactory*>(this);AddRef();return S_OK;
    }
    ULONG STDMETHODCALLTYPE AddRef() override{return InterlockedIncrement(&refs);}
    ULONG STDMETHODCALLTYPE Release() override{ULONG n=InterlockedDecrement(&refs);if(!n)delete this;return n;}
    HRESULT STDMETHODCALLTYPE CreateInstance(IUnknown* outer,REFIID id,void** out) override{
        if(!out)return E_POINTER;*out=nullptr;if(outer)return CLASS_E_NOAGGREGATION;
        auto object=new(std::nothrow) Preview();if(!object)return E_OUTOFMEMORY;
        HRESULT hr=object->QueryInterface(id,out);object->Release();return hr;
    }
    HRESULT STDMETHODCALLTYPE LockServer(BOOL lock) override{if(lock)InterlockedIncrement(&locks);else InterlockedDecrement(&locks);return S_OK;}
};
extern "C" HRESULT __stdcall DllGetClassObject(REFCLSID clsid,REFIID id,void** out){
    if(!out)return E_POINTER;*out=nullptr;if(clsid!=CLSID_DsfCoverPreview && clsid!=CLSID_DsfCoverPreviewTest)return CLASS_E_CLASSNOTAVAILABLE;
    auto factory=new(std::nothrow) Factory();if(!factory)return E_OUTOFMEMORY;
    HRESULT hr=factory->QueryInterface(id,out);factory->Release();return hr;
}
extern "C" HRESULT __stdcall DllCanUnloadNow(){return objects==0 && locks==0?S_OK:S_FALSE;}
